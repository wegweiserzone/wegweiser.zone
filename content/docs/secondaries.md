+++
title = "A second nameserver"
description = "One nameserver is one machine that can reboot. Zone transfer, TSIG, NOTIFY, and the configuration the second server needs."
weight = 100
group = "Running it"
+++

One nameserver is one machine that can reboot. Every registrar asks for at
least two, and the reason is not bureaucracy: a zone with a single server
disappears entirely while that server is down.

Wegweiser does not cluster yet, and it does not need to for this. Zone transfer
is how every nameserver written since the eighties gets a copy of a zone from
another one, so the second server can be BIND, Knot, NSD or PowerDNS, and none
of them has to know what the first one is. It cannot be another Wegweiser yet,
which the section on the other end explains.

This page is that arrangement. Three settings on this side, a handful of lines
on the other.

## The shape

{{< diagram "zone-transfer" "Wegweiser as primary sends AXFR or IXFR to a secondary, which answers NOTIFY back; both answer queries from the world." >}}

You edit zones on the primary. The secondary asks for a copy, keeps it, and
answers from it. Both are listed at your registrar, and a client that cannot
reach one uses the other.

The primary does not have to be reachable by the public at all. A **hidden
primary** is one that no NS record names: it exists to be edited and to feed
the servers that do answer. That is the arrangement this was built for, and
nothing below changes for it.

## 1. Say who may take a copy

Nobody may, until somebody is named. This is the default and it is deliberate:
a zone is an inventory of a network, and a copy handed out cannot be taken
back.

```sh
weg settings set --transfer-allow 192.0.2.53,198.51.100.53
```

Or a whole network, if that is what you mean:

```sh
weg settings set --transfer-allow 192.0.2.0/24
```

A bare address is stored as the single host it means, so you do not have to
write `/32`. A prefix with bits set below its length is refused rather than
quietly masked: `192.0.2.7/24` is a typo for one of two different things, and
guessing which would sometimes hand a zone to a network nobody meant to name.

Read it back at any time:

```sh
weg settings show
```

**What an address list can and cannot do.** A transfer is a TCP session, so a
client has to complete a handshake and an off-path spoofer cannot. That makes
an address a real control here in a way it is not over UDP. What it cannot do
is tell two hosts behind one NAT apart, or authenticate a secondary somebody
else runs. Across an organisational boundary this is not access control, and
the answer there is a key rather than a longer list. Skip to step 3.

## 2. Tell them when something changes

Without this, a secondary finds out about a change when its own refresh timer
fires. The default in a Wegweiser zone is an hour.

```sh
weg settings set --notify 192.0.2.53,198.51.100.53
```

**These are two lists, and they do different things.** The first decides who
may take a copy. The second says where the news can arrive. They look alike and
they are easy to confuse, so:

| | `--transfer-allow` | `--notify` |
| --- | --- | --- |
| Answers | who may pull | who is told |
| Holds | addresses, networks, keys | addresses only |
| Empty means | nobody may transfer | nobody is told |

A network cannot be notified, because a datagram has to arrive somewhere.
Filling in one list does not fill in the other, and an operator who sets the
transfer list and forgets this one gets working transfers and slow news, with
nothing to say why. That is the one sharp edge here.

A secondary on a port of its own follows the address after a colon:

```sh
weg settings set --notify '192.0.2.53,[2001:db8::53]:5353'
```

## 3. A key, where an address is not enough

TSIG (RFC 8945) is a shared secret. The secondary signs its request with it,
this server verifies the signature, and the transfer is granted to whoever
holds the key rather than to whoever is at an address.

```sh
weg tsig create secondary.example.com.
```

That prints the secret and nothing else on standard output, so it can be
captured:

```sh
SECRET=$(weg tsig create ns2.example.com.)
```

Creating a key grants nothing on its own. Put it on the transfer list:

```sh
weg settings set --transfer-allow key:secondary.example.com.
```

An entry is an address **or** a key, and one of them matching is enough. Adding
a key while leaving a prefix in place has not tightened anything: a request
from that prefix is still served unsigned. Take the prefix out when you mean
the key to be the control.

To sign the notification as well, name the key after the address:

```sh
weg settings set --notify '192.0.2.53 key:secondary.example.com.'
```

A secondary configured to insist on TSIG will ignore an unsigned notification,
so this matters as soon as you have set the key up on the other end.

### Which algorithms

`hmac-sha256` unless the other end says otherwise, and `hmac-sha384` or
`hmac-sha512` if it does. Wegweiser does not offer `hmac-sha1` or `HMAC-MD5`.
RFC 8945 calls the first NOT RECOMMENDED and forbids the second, and offering
an algorithm beside advice not to use it is a footgun with a manual page. A
secondary that can only do `hmac-sha1` is an old secondary, and the address
list still serves it.

### Reading a secret back

Unlike an API token, a TSIG secret can be read again:

```sh
weg tsig show secondary.example.com.
```

This is not an oversight. Verifying a signature means recomputing it, so this
server has to keep the secret, and hiding it in the interface would be theatre
rather than a boundary. What follows for the database file is on the
[deployment page](/docs/deployment/).

### Rotating and withdrawing

```sh
weg tsig revoke secondary.example.com.
```

The key stops signing at once and its secret is cleared: an API token leaves
only a hash behind when it is revoked, and a key would leave material nothing
will ever read again. The name and the dates stay in the listing, so a name a
secondary still has configured looks up to something.

The name is then free, so rotating a key does not mean renaming it on the other
end. Withdraw the old one, create a new one with the same name, and copy the
new secret across.

## The other end

You do not have to write this by hand. Wegweiser holds every zone, the key's
name, its algorithm and its secret, so it can write the file the second server
reads:

```sh
weg secondary config bind --primary 192.0.2.1 > /etc/named/wegweiser.conf
weg secondary config knot --primary 192.0.2.1 > /etc/knot/wegweiser.conf
```

Every zone goes in, the reverse ones among them. Those are the ones that get
left out when the file is assembled by hand, and a reverse zone that only one
of your nameservers answers for fails in a way nobody notices for months.

The address is the one thing the command cannot work out. This server does not
know which of its addresses the world reaches it on, and a hidden primary is
named by no record to ask, so `--primary` is required rather than guessed at.

Name the far end as well, and the two lists above are checked against it rather
than only described:

```sh
weg secondary config bind --primary 192.0.2.1 --secondary 198.51.100.53
```

That reports an empty transfer list, a key that was created and never put on
one, and a secondary the notifications do not reach. Each of those leaves a
configuration that is perfectly formed and does not work, which is the failure
this whole page is about. The file goes to standard output and the warnings go
to standard error, so redirecting the first leaves nothing in it to delete.

The Secondaries screen in the interface does the same thing, with a copy button.
It is a tool rather than a setting, so it opens from that screen's bar rather
than sitting on the settings screen where it used to be.

Nothing is generated for NSD or PowerDNS. The transfer works with both; you
write those two by hand, and the blocks below are close enough to adapt.

### BIND

What the command writes, for one zone:

```
// Written by `weg secondary config bind`. Regenerate it rather than edit it.
// BIND 9.16 or newer, which is where `masters` became `primaries`.
// Include this file from named.conf.

key "secondary.example.com." {
    algorithm hmac-sha256;
    secret "<the secret, filled in>";
};

server 192.0.2.1 {
    keys { "secondary.example.com."; };
};

zone "example.com." {
    type secondary;
    primaries { 192.0.2.1; };
    file "/var/lib/named/example.com.zone";
};
```

`--unsigned` leaves out the `key` and `server` blocks, for a secondary the
address list grants. `--zone-dir` moves the `file` path, which is the one line
here that varies by distribution.

### Knot DNS

```yaml
# Written by `weg secondary config knot`. Regenerate it rather than edit it.
# Knot DNS 3. Merge these blocks into knot.conf: a section given twice is an error.

key:
  - id: secondary.example.com.
    algorithm: hmac-sha256
    secret: <the secret, filled in>

remote:
  - id: wegweiser
    address: 192.0.2.1
    key: secondary.example.com.

acl:
  - id: wegweiser-notify
    address: 192.0.2.1
    action: notify
  - id: wegweiser-notify-signed
    address: 192.0.2.1
    key: secondary.example.com.
    action: notify

zone:
  - domain: example.com.
    master: wegweiser
    acl: [wegweiser-notify, wegweiser-notify-signed]
```

The `acl` is not optional and its absence is quiet. Knot will fetch the zone
without it and then drop every notification on the floor, so the zone stays
correct and the news takes an hour. BIND does not need the equivalent, because
it accepts a notification from a server it already calls a primary. Both
behaviours were checked against the real thing.

**Two rules where there is a key, because one cannot cover both cases.** A Knot
access rule naming a key matches only a signed request, and one naming no key
matches only an unsigned one. Whether a notification carries the key is a
separate setting here from whether a transfer is signed, so a secondary set up
from one key has to accept either. With a single rule one of the two
arrangements transfers the zone and then drops every notification: correct
data, a refresh interval late, and nothing anywhere saying so. Both are
written now, and a configuration for an arrangement without a key is the one
rule it always was.

A file written before 0.3.0 has only the first of them. If your notifications
are signed and your Knot secondary only ever picks a change up on its refresh
timer, that is why: regenerate the file and reload it.

### Another Wegweiser

Not yet. Wegweiser transfers zones out and does not take them in, so the second
server in this arrangement is somebody else's software. That is a real
limitation and it is written down rather than glossed over.

## Where each secondary stands

Everything above is what this side can check on its own: the key exists, the
address is on the list, the zone is served. Whether the other machine actually
took the copy is a fact that lives on the other machine, and a secondary that
answers a notification and then never transfers looks exactly like one that is
working.

So it is asked.

```console
$ weg secondary status
SECONDARY         ZONE                   STATE    SERIAL  BEHIND  ASKED
192.0.2.53:53     example.com.           in step  7       -       2m ago
192.0.2.53:53     2.0.192.in-addr.arpa.  in step  4       -       2m ago
198.51.100.53:53  example.com.           behind   5       2       1m ago
198.51.100.53:53  2.0.192.in-addr.arpa.  unasked  -       -       never
```

One line per zone per address on the notify list. Who is asked is who is told:
there is no second list to fill in and keep in step with the first, and a
notify list nobody has filled in has nothing to report here.

| State | |
| --- | --- |
| `in step` | It holds the serial this server publishes |
| `behind` | It holds an older one, and `BEHIND` is by how many commits |
| `unasked` | Nothing has come back for this pair yet |
| `silent` | It did not answer in time; the serial shown is the last one anybody saw |
| `no serial` | It answered without a `SOA` to read, which is what a refusal looks like from here |
| `ahead` | It holds a newer serial, so it took its copy from somewhere this server is not |
| `unordered` | The two serials are half the space apart, which RFC 1982 §3.2 declines to order |

**`unasked` is a state rather than a quiet pass.** A pair nothing has come back
for is unknown, not up to date, and those two being told apart is the whole
point of asking. The dash in `BEHIND` says the same thing in the columns beside
it: zero commits behind and no idea are different answers and are written
differently.

Nothing here is red, in the interface or on the terminal. A zone that has not
arrived yet is something to look at rather than a failure of this server.

### How the asking works

A probe is a `SOA` query, unsigned, over UDP, to the address on the notify
list. Nothing is being asked for beyond what that server answers anybody, so it
carries no key — and the configuration written above adds no query restriction,
so a secondary that has one globally answers nothing and reads as `silent`,
which is honest.

A pair becomes due when its notification finishes, answered or given up on. A
zone nobody edits produces no probes, so the traffic follows how much this
server is changed rather than how many zones it holds. Under that, a slow sweep
asks about everything at least hourly whether anything changed or not, which is
what catches the secondary that quietly lost a zone it already had.

Nothing is reported while a notification is still outstanding. A zone that
changed a moment ago whose secondary has not fetched it yet is in flight rather
than behind, and a report that cannot tell those apart is one nobody reads.

**One caveat, and it is a real one.** BIND acknowledges a notification and
*then* opens the transfer, about eleven milliseconds later. A probe fired the
moment the notification finishes reads the serial from before the change, so
the first reading after an edit can say `behind` when nothing is wrong. The
next ask corrects it and nothing stays wrong, but a `behind` that is seconds
old and clears itself is that. It is written down here rather than smoothed
over, and what the wait after a notification should be is not settled yet.

Nothing automatic follows from a lagging secondary. In particular it is not
sent another notification: a secondary that is not transferring does not start
because it was told twice.

The interface has the same table on its own [Secondaries
screen](/docs/web-interface/#secondaries), where hovering a state says what it
means.

## Checking it works

Before blaming the transfer, ask whether the zone is sound:

```sh
weg zone check example.com
```

The one that matters here is a name server this zone points at and has no
address for. A secondary that fetches such a zone serves a delegation that
answers NXDOMAIN for its own name server, and nothing about the transfer looks
wrong while it happens.

Then ask for the zone the way a secondary would:

```sh
dig @192.0.2.1 example.com. AXFR
```

Unsigned, from an address on the list, that prints the zone. From anywhere else
it prints `status: REFUSED`, which is the correct answer and not a fault.

With a key:

```sh
dig @192.0.2.1 example.com. AXFR \
  -y "hmac-sha256:secondary.example.com.:$SECRET"
```

`dig` verifies the signature on every message and says so if it does not match.
Three things can go wrong, and each says which:

| What `dig` shows | What happened |
| --- | --- |
| `BADKEY` | No key of that name signs here, or it has been withdrawn |
| `BADSIG` | The two ends do not have the same secret |
| `BADTIME` | The clocks are more than five minutes apart |

`BADTIME` carries this server's clock in the answer, so a client can see how
far off it is. The other two do not, deliberately: there is nothing to sign
them with.

### From the metrics

```
weg_dns_queries_total{type="AXFR"}
weg_dns_queries_total{type="IXFR"}
weg_dns_notifications_total{outcome="answered"}
weg_dns_notifications_total{outcome="abandoned"}
weg_secondary_serial_lag{target}
weg_secondary_zones_behind{target}
weg_secondary_zones_unanswered{target}
weg_secondary_probes_total{outcome}
```

`abandoned` counts secondaries that were told six times and never answered. It
should be zero. Anything else means a notification is not arriving, and that
secondary is waiting out its refresh timer on every change.

The four below it are what the probes found. `weg_secondary_serial_lag` is how
many commits the furthest behind of a secondary's zones has yet to see, and
`weg_secondary_zones_behind` how many of them are behind at all. Both are per
secondary rather than per zone: a series per zone per target is what makes a
label expensive, and which zone it is belongs in `weg secondary status`, where
somebody asked for it.

`weg_secondary_zones_unanswered` is the one that is easy to leave out and
should not be. A secondary that has gone quiet reports nothing behind, because
nothing about it is known, and without this that is indistinguishable from one
that is up to date.

A target dropped from the notify list loses its series rather than being left
at the last value it had, which is the kind of number somebody trusts a year
later.

## How many at once

Eight transfers run at the same time. The ninth is answered `SERVFAIL` and comes
back on its own retry timer, which is what a secondary does with that answer
anyway.

The bound is separate from the one on connections because a transfer is the size
of a zone rather than the size of a question: a large one going to a slow client
holds its connection for orders of magnitude longer than a query does, and
without a limit of their own a handful of them would take every connection the
server has and it would stop answering anything.

`maxTransfers` in the configuration file raises it. A `SERVFAIL` on a transfer
that used to work, on a server with more secondaries than it had, is what that
looks like from the other end.

## Whole zone, or only what changed

Both, and the secondary chooses. An `IXFR` request asks for the difference
since the serial it holds, which Wegweiser replays out of its own journal, so
a one-record change sends one record rather than the zone.

Where the difference cannot be worked out, or would be larger than the zone
itself, the answer is a full transfer instead. That is what the specification
provides for and it is never wrong, only larger. You do not configure any of
this.

One thing does affect it: journal retention. A secondary that has been away
longer than the history goes back has to take the whole zone again. Nothing
breaks; it is just more traffic than it needed to be.

## What this is not

It is not a cluster. Both servers answer, but only one of them can be edited,
and if the primary is gone the zone is frozen at whatever the secondary last
fetched. That is the honest description, and for most networks it is enough:
the thing that actually fails is a machine, and the zone keeps answering.

Automatic failover of the *editing* side needs consensus, which needs at least
three servers to have a majority, and that is not built yet. Two servers cannot
elect anything. A pair that claimed to would be lying in the one place a DNS
server must not.
