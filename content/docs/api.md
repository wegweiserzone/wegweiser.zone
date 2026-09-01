+++
title = "The API"
description = "The interface both clients are built on: authentication, what a write gives back, the live query stream, and every endpoint there is."
weight = 170
group = "Reference"
+++

The web interface and `weg` are clients of this API, and neither reaches the database any
other way. There is no privileged path they take that something you write cannot. That is
architecture invariant 1 in the server repository, and it is enforced by the fact that
breaking it would mean writing a second data path nobody has written.

The spec is the authority. It lives at
[`internal/api/openapi.yaml`](https://github.com/wegweiserzone/wegweiser/blob/main/internal/api/openapi.yaml),
the Go client and the interface's TypeScript types are generated from it, and the build fails
if the committed copies drift from it. An endpoint not written down there does not exist.

Every response below was captured from a running server. Identifiers and timestamps are as
they came out.

## Reaching it

Everything is under `/api/v1`, on the address `api.listen` names, which is loopback until you
change it.

```console
$ curl -H "Authorization: Bearer $WEG_TOKEN" http://127.0.0.1:8053/api/v1/zones
```

The scope a request needs comes from its method. `GET` needs `read`, anything that changes
something needs `write`. Tokens, TSIG keys and the secondary's configuration are the
exception and need `admin` whatever the method: a `write` token able to mint an `admin` token
would not be a `write` token, and a key that may transfer may take every zone. Scopes are
ordered, so `admin` satisfies a requirement for `read`.

Two endpoints need no credential. `GET /healthz`, because a load balancer has nowhere to put
one, and `POST /auth/session`, because handing over a token is what it is for.

```json
{ "status": "serving", "version": "v0.2.0", "zones": 2, "records": 7 }
```

### From a browser

A page cannot hold a bearer token safely, so it does not. `POST /auth/session` takes the
token once and sets an httpOnly cookie; nothing a script can read holds the credential
afterwards. A second cookie, `weg_csrf`, is readable, and its value goes back in the
`X-Wegweiser-CSRF` header on anything that changes state. A write without it is refused with
403, whatever the cookie says.

Safe methods skip the check, because `GET`, `HEAD` and `OPTIONS` do not change anything here
(RFC 9110 §9.2.1).

## Names are absolute

The API takes the name you send. It does not qualify it against the zone:

```console
$ curl ... -d '{"name":"www","type":"A","data":"192.0.2.10"}'
```
```json
{
  "type": "/problems/invalid-request",
  "title": "The request could not be used",
  "status": 400,
  "detail": "\"www.\" does not lie inside the zone \"example.com.\"; did you mean \"www.example.com.\"?"
}
```

The command line does qualify a short name, which is a convenience of the client rather than
a behaviour of the server. Send `www.example.com.` and the trailing dot with it.

## What a write gives back

The most useful thing to understand about this API. A write does not answer with the record
you sent; it answers with everything that happened, and some of that happened in another
zone.

Adding an address record where a reverse zone covers the address:

```console
$ curl ... -d '{"name":"www.example.com.","type":"A","data":"192.0.2.10"}' \
    .../zones/{id}/records
```
```json
{
  "record": {
    "id": "01M1EPEQW3EN3M9RK2K5QRB4F4",
    "zoneId": "01M1EPDVX83PDK1T40C1GPF0YH",
    "name": "www.example.com.", "type": "A", "class": "IN",
    "data": "192.0.2.10", "ttl": 3600, "disabled": false,
    "createdAt": "2026-09-01T14:37:30.884Z",
    "updatedAt": "2026-09-01T14:37:30.884Z"
  },
  "generated": [
    {
      "id": "01M1EPEQW46TXQAAZ21ZDRG82F",
      "zoneId": "01M1EPE7BT848XB55NQF54HGD8",
      "name": "10.2.0.192.in-addr.arpa.", "type": "PTR", "class": "IN",
      "data": "www.example.com.", "ttl": 3600, "disabled": false,
      "managedBy": "01M1EPEQW3EN3M9RK2K5QRB4F4",
      "managedKind": "ptr",
      "createdAt": "2026-09-01T14:37:30.884Z",
      "updatedAt": "2026-09-01T14:37:30.884Z"
    }
  ]
}
```

`generated` is what the server wrote alongside. `managedBy` names the record that caused it,
which is how the server knows to keep the two in step and how a client can show the link.
[Reverse zones](/docs/reverse-zones/) covers when this happens and how to turn it off.

Three fields report on the reverse half, and **all three arrive on a `201`**. A client that
looks only at the status code will not see them.

| | |
| --- | --- |
| `generated` | Records the server wrote as a consequence |
| `conflicts` | The write went in, but a reverse entry did not, and here is why |
| `missingZones` | The reverse zone that would have held an entry does not exist |

A second name for an address that already reverses:

```json
{
  "record": { "name": "mail.example.com.", "data": "192.0.2.10", "…": "…" },
  "conflicts": [
    {
      "address": "192.0.2.10",
      "existingName": "www.example.com.",
      "requestedName": "mail.example.com.",
      "policy": "first-wins"
    }
  ]
}
```

The forward record exists. There is no second `PTR`, because the policy in force said the
first name wins. Nothing failed, and nothing silently vanished either: the report is in the
response.

Under `reverseConflictPolicy: "reject"` the same request is refused outright, and the client
has to handle both:

```json
{
  "type": "/problems/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "store: conflict: 192.0.2.10 already reverses to \"www.example.com.\", and this server is set to refuse a second name for one address; remove that entry, detach it, or change the reverse policy"
}
```

An address no reverse zone covers is not an error at all, only a note:

```json
{
  "record": { "name": "far.example.com.", "data": "198.51.100.9", "…": "…" },
  "missingZones": [
    { "address": "198.51.100.9", "zoneName": "100.51.198.in-addr.arpa." }
  ]
}
```

Create that zone later and `POST /zones/{id}/reconcile` writes the entries the existing
records imply. Nothing has to be entered twice.

Every write-shaped response carries these fields, not just this one: importing a zonefile,
replacing RRsets, rolling back and reconciling all report the same way.

## Desired state

`PUT /zones/{id}/rrsets` makes the RRsets you name exactly what you send, and leaves every
other name in the zone alone. It is the shape anything reconciling from a file needs, and the
one endpoint with no client behind it yet.

```console
$ curl -X PUT ... -d '{
    "rrsets": [
      { "name": "www.example.com.", "type": "A", "ttl": 300,
        "records": [ { "data": "192.0.2.11" }, { "data": "192.0.2.12" } ] }
    ]
  }' .../zones/{id}/rrsets
```

The single `192.0.2.10` that was there is gone, both new addresses are in, the TTL moved to
300 for the whole set, and the reverse zone was brought along:

```json
{
  "records": [
    { "name": "www.example.com.", "data": "192.0.2.12", "ttl": 300, "…": "…" },
    { "name": "www.example.com.", "data": "192.0.2.11", "ttl": 300, "…": "…" }
  ],
  "generated": [
    { "name": "12.2.0.192.in-addr.arpa.", "type": "PTR", "managedKind": "ptr", "…": "…" },
    { "name": "11.2.0.192.in-addr.arpa.", "type": "PTR", "managedKind": "ptr", "…": "…" }
  ]
}
```

One TTL for the set is not the API being opinionated. RFC 2181 §5.2 says the records of an
RRset share one, so there is nowhere to put a second.

## History

Every write is a commit, and the commit is the audit entry, the diff, the thing a rollback is
computed from and what an incremental transfer is replayed out of. One structure, not four.

That one `PUT` produced two of them:

```json
{
  "items": [
    {
      "id": "01M1EPQRVPZMY0MMJ91Q3KMC3H",
      "zoneName": "example.com.", "kind": "edit", "source": "api",
      "actor": "bootstrap", "comment": "replace RRsets",
      "serialFrom": 4, "serialTo": 5,
      "createdAt": "2026-09-01T14:42:26.806Z"
    },
    {
      "id": "01M1EPQRVPPWST8AE61Z5AE3Q1",
      "zoneName": "2.0.192.in-addr.arpa.", "kind": "edit", "source": "system",
      "actor": "bootstrap", "comment": "reverse entries kept in step with example.com.",
      "serialFrom": 2, "serialTo": 3,
      "createdAt": "2026-09-01T14:42:26.806Z"
    }
  ],
  "nextCursor": "eyJrIjoiYyIsIm0iOjE3ODgyNzM0NjkwMjUsImkiOiIwMU0xRVBGOUsxTjVHQThXTUpQV1NKUEpUOCJ9"
}
```

`source` separates what a client asked for from what the server did about it. `actor` is the
token or session behind it. A change to one zone's addresses that moves a second zone's
serial is visible as exactly that.

`GET /commits/{id}` adds the records the commit touched. So does a rollback, which is worth
looking at closely:

```console
$ curl ... -d '{"serial":3,"comment":"back out the rrset replacement"}' \
    .../zones/{id}/rollback
```
```json
{
  "commit": {
    "kind": "rollback", "revertsTo": 3,
    "serialFrom": 5, "serialTo": 6,
    "comment": "back out the rrset replacement",
    "events": [
      { "seq": 0, "op": "del", "name": "www.example.com.", "type": "A", "ttl": 300,  "data": "192.0.2.11" },
      { "seq": 1, "op": "del", "name": "www.example.com.", "type": "A", "ttl": 300,  "data": "192.0.2.12" },
      { "seq": 2, "op": "del", "name": "far.example.com.", "type": "A", "ttl": 3600, "data": "198.51.100.9" },
      { "seq": 3, "op": "add", "name": "www.example.com.", "type": "A", "ttl": 3600, "data": "192.0.2.10" }
    ]
  }
}
```

The serial went from 5 to **6**, not back to 3. A rollback is a new commit that happens to
restore an old state, so a secondary sees it as an ordinary change and follows it. Rewinding
the serial would make every copy of the zone look newer than the original, which is the
failure RFC 1982 §3.2 describes and the reason this is done the way it is.

## Watching queries

`GET /queries/stream` is Server-Sent Events, one per query answered.

```console
$ curl -sN -H "Authorization: Bearer $WEG_TOKEN" \
    "http://127.0.0.1:8053/api/v1/queries/stream?name=example.com."
```
```
event: status
data: {"matched":0,"sent":0,"sampled":0,"dropped":0,"ratio":1}

event: query
data: {"at":"2026-09-01T16:41:06.639630941+02:00","client":"127.0.0.1","port":33899,
       "name":"www.example.com.","type":"A","class":"IN","rcode":"NOERROR",
       "transport":"udp","size":75,"latencyUs":67,"truncated":false,"dropped":false}

event: query
data: {"at":"2026-09-01T16:41:06.655307929+02:00","client":"127.0.0.1","port":49382,
       "name":"nope.example.com.","type":"A","class":"IN","rcode":"NXDOMAIN",
       "transport":"udp","size":129,"latencyUs":27,"truncated":false,"dropped":false}
```

Each `data:` is one line on the wire; they are wrapped above to fit the page.

Four filters, all applied on the server so that watching one name stays complete however busy
the rest of the server is:

| | |
| --- | --- |
| `name` | That name and everything below it. `example.com.` is the whole zone |
| `type` | Repeatable. `?type=A&type=AAAA` |
| `rcode` | Repeatable. `?rcode=NXDOMAIN&rcode=SERVFAIL` |
| `client` | One address, or a network in CIDR form |

`name` is a suffix match, so `example.com.` catches `www.example.com.` and does not catch the
reverse zone's `PTR` traffic, even though the same record write produced both.

The `status` event is the honest part. Under load the stream samples rather than blocking
the query path, and `ratio` says how heavily: 1 means you are seeing everything, 50 means
one query in fifty. `matched` counts what passed your filter and `sent` what reached you.
The gap between them is `sampled` plus `dropped`, and the two mean different things:
`sampled` is the server's cap, `dropped` is your own client not reading fast enough. It
arrives first, before any query, so a watcher on a quiet server knows where it stands
without waiting, and again whenever the picture changes, at most once a second.

A heartbeat every ten seconds keeps a proxy from deciding the connection is dead. There is a
cap on watchers, because each one costs the query path a filter per query; over it the answer
is `503`, meaning come back, not you did something wrong.

## Checking a zone

`GET /zones/{id}/check` applies every rule the write path enforces to the zone as it stands.
It reports; it never changes anything.

```json
{
  "records": 4,
  "truncated": false,
  "findings": [
    {
      "severity": "warning",
      "scope": "nameserver",
      "name": "example.com.",
      "detail": "ns1.example.com. has no address in this zone, so a resolver referred to it is told the name does not exist. Add ns1.example.com. A <address>, or point the delegation somewhere off-site (RFC 1912 §2.8)."
    }
  ]
}
```

`?reverse=true` extends it to the reverse half: entries the forward records imply and the
reverse zone does not have. A finding that names a record carries its id, which is what the
interface turns into a button. [Checking a zone](/docs/checking/) has the full list of rules.

## Zonefiles

`POST /zones/import` takes the file itself as the body, as `text/dns`, not wrapped in JSON.
The zone is wherever its `SOA` sits, so the name is not sent separately and cannot be sent
inconsistently.

```console
$ curl -H "Authorization: Bearer $WEG_TOKEN" -H "Content-Type: text/dns" \
    --data-binary @test.example.zone .../zones/import
```
```json
{
  "zone": { "name": "test.example.", "kind": "forward", "…": "…" },
  "records": 5,
  "missingZones": [
    { "address": "203.0.113.1",  "zoneName": "113.0.203.in-addr.arpa." },
    { "address": "203.0.113.20", "zoneName": "113.0.203.in-addr.arpa." },
    { "address": "203.0.113.21", "zoneName": "113.0.203.in-addr.arpa." }
  ]
}
```

The serial in the file is the serial the zone starts at, deliberately. A migrated zone
restarted at 1 looks older than itself to every secondary that has already seen it.
`$INCLUDE` is refused: a file arriving over the network that could pull in a path would read
this server's filesystem out loud.

`GET /zones/{id}/export` writes it back out as `text/dns`, in the presentation format of
RFC 1035 §5, with the SOA's fields commented.

## Listings

Cursor-based. A page carries `nextCursor` when there is more to fetch, and omits the field
when there is not. Pass it back as `cursor`. `limit` goes to 1000.

```console
$ curl -sH "Authorization: Bearer $WEG_TOKEN" \
    "http://127.0.0.1:8053/api/v1/zones?limit=50&cursor=eyJrIjoieiIs…"
```

No page numbers, because a page number is wrong the moment something is inserted ahead of it.

Zones, records and commits page, and each takes filters of its own:

| | |
| --- | --- |
| `/zones` | `name`, `kind`, `disabled`, `search` |
| `/zones/{id}/records` | `name`, `type`, `search` |
| `/commits` | `zoneId`, `kind`, `actor`, `since`, `until` |

`since` and `until` on the history are what an audit export is built from, and `actor`
narrows it to one token.

Tokens and TSIG keys return a bare array with no cursor, since a server with enough of either
to need a second page has a different problem.

## Errors

RFC 7807, as `application/problem+json`:

```json
{
  "type": "/problems/invalid-request",
  "title": "The request was understood but cannot be carried out",
  "status": 422,
  "instance": "/api/v1/zones/01M1EPDVX83PDK1T40C1GPF0YH/records",
  "detail": "invalid: \"sub.example.com.\" delegates to another zone, so its TXT record would never be answered; a query for that name is referred to the child (RFC 1034 §4.2.1)"
}
```

`type` is a relative path, one of `/problems/invalid-request`, `not-found`, `conflict`,
`unauthorized`, `forbidden`, `too-many-requests`, `unavailable`, `internal`. Match on that
rather than on `title`.

One `type` covers two statuses, so the status still carries information. 400 means the request
was malformed. 422, as above, means it was read perfectly well and describes something DNS
will not do.

`detail` is written for a person, names the rule, cites the RFC where there is one, and says
what to do instead. It is not a stable string and not something to parse.

Unknown query parameters and unknown body fields are ignored rather than rejected. A
misspelled filter therefore returns 200 and the unfiltered list, and a misspelled setting
returns 200 and the unchanged settings. Read the response back rather than trusting the
status code.

## Everything there is

Thirty-six operations. The spec is the authority; this is the map.

**Zones**

| | |
| --- | --- |
| `GET POST /zones` | List and create. `?name=` finds one by name |
| `GET PATCH DELETE /zones/{id}` | One zone, its settings, and removing it with everything in it |
| `POST /zones/import` · `GET /zones/{id}/export` | Zonefiles in and out |
| `GET /zones/{id}/check` | What is wrong with it; `?reverse=true` adds the reverse half |
| `POST /zones/{id}/reconcile` | Write the reverse entries its records imply |
| `POST /zones/{id}/rollback` | Restore the state at a serial, as a new commit |
| `PUT /zones/{id}/rrsets` | Make the named RRsets exactly what you send |

**Records**

| | |
| --- | --- |
| `GET POST /zones/{id}/records` | List and add |
| `GET PATCH DELETE /records/{id}` | One record |
| `POST /records/{id}/detach` | Hand a generated record over; automation stops touching it |
| `POST /records/{id}/canonical` | Make this the name its address reverses to |

**History, settings and credentials**

| | |
| --- | --- |
| `GET /commits` · `GET /commits/{id}` | The history, and one change with its records |
| `GET PATCH /settings` | Reverse policy, who may transfer, who is notified |
| `GET POST /tokens` · `DELETE /tokens/{id}` | Credentials. `admin` |
| `GET POST /tsig-keys` · `DELETE` · `GET .../secret` | Transfer keys. `admin` |
| `GET /secondary-config` | The configuration a secondary needs. `admin` |

**Operations**

| | |
| --- | --- |
| `GET /queries/stream` | Server-sent events, one per query answered |
| `GET /healthz` · `GET /metrics` | Health, and Prometheus metrics |
| `POST GET DELETE /auth/session` | The browser's way in |

A minted token and a created key are the only places a secret appears:

```json
{
  "secret": "weg_Sx4n9AGv…",
  "token": {
    "id": "01M1EPR9PBY6ZRDPPDQXYS5NH0",
    "name": "deploy", "prefix": "weg_Sx4n9AGv", "scopes": ["write"],
    "createdAt": "2026-09-01T14:42:44.043Z"
  }
}
```

Afterwards only the hash is kept, and every listing shows the prefix. `prefix` is enough to
tell two tokens apart in a log and far too little to guess from. A TSIG secret is the
exception and can be read back through `GET /tsig-keys/{id}/secret`, because the other end of
a transfer has to be given it, and that endpoint needs `admin`.

## Writing a client

Generate one from the spec rather than writing requests by hand:

```console
$ oapi-codegen -generate client -package weg internal/api/openapi.yaml > client.go
$ npx openapi-typescript internal/api/openapi.yaml -o schema.d.ts
```

Both clients in the repository are built exactly that way, which is what keeps the spec
honest: a change that breaks the contract breaks the build before it reaches you.

Three things to hold on to, none of which a generated client will tell you:

1. Send fully-qualified names, with the trailing dot.
2. Read `generated`, `conflicts` and `missingZones` on every successful write.
3. A 201 is not proof that the reverse half went the way you expected.

## What is not here yet

The applier supports optimistic concurrency: a write can name the serial it expects and be
refused if the zone has moved on. That is not reachable through the API. There is no
`If-Match` header and no `expectedSerial` field in the spec, so two clients writing to one
zone cannot detect that they have raced, and the second write wins silently.

For one operator with two terminals this is theoretical. For anything reconciling a zone from
a file on a timer it is not, and it is the thing to know before you build that. It is written
down here as a gap rather than described as a feature.

## What every write leaves behind

A commit, with the token or session that caused it. Nothing changes a zone quietly, including
a change made by something you wrote against this API at three in the morning.
[History and rollback](/docs/history/) is the other side of it.
