+++
title = "Asking what it answers"
description = "What the server answers for a name and a type, and what kind of answer that is, from the web interface, `weg ask` or the API. No dig, and no route to the DNS port."
weight = 55
group = "Everyday"
+++

When something is wrong, the question somebody brings is what the server says for `www`, and
why. `dig` answers it, given the right address and port and a machine that can reach the DNS
listener. A browser holding the web interface often has none of that, and a firewall in
between is common enough that it should not decide whether the question can be asked.

So the server answers it itself, over the same API everything else uses.

```console
$ weg ask www.example.com
NOERROR from example.com.: 1 record

answer
www.example.com.  3600  IN  A  192.0.2.11
```

The type is `A` unless you name another, as a mnemonic or in the `TYPE65534` form. One that is
not a type at all is the request's mistake, and is answered with the one it was probably
meant to be: `"AAA" is not a record type; did you mean AAAA?`.

```console
$ weg ask example.com MX
NOERROR from example.com.: 1 record

answer
example.com.  3600  IN  MX  10 mail.example.com.

additional
mail.example.com.  3600  IN  A  192.0.2.25
```

## The same answer the wire gives

It is not a second implementation of the search, and not a query sent to the server's own
port. The API takes the snapshot the query path is serving at that moment and asks it with the
function the query path uses, the one that decides the response code, the AA bit and the three
sections. Whatever it says is what a query would have been told.

What it leaves out belongs to a client the API does not have. The answer is the one a query
over TCP would get: there is no casing to echo back, no UDP size to cut it down to, and no
[cookie to check while the server is under load](/docs/under-load/). The server's own
explanation of a response, the [extended DNS error](/docs/glossary/#extended-dns-error), is
kept, because that is the sentence that says why.

## What kind of answer it is

The first line says, so that nobody has to work it out from the sections:

| | |
| --- | --- |
| an answer | The records asked for |
| an alias | A `CNAME` the question did not ask for, followed as far as this server's zones go |
| no data | The name exists without the type asked for ([NODATA](/docs/glossary/#nodata)) |
| no such name | Nothing exists at the name, or below it ([NXDOMAIN](/docs/glossary/#nxdomain)) |
| a referral | The name is delegated, and the name servers below answer for it ([referral](/docs/glossary/#referral)) |
| refused | No zone on this server covers the name |
| not answered | The type asks for a transfer or belongs to a message, such as `AXFR` or `OPT` |
| failed | A [SERVFAIL](/docs/glossary/#servfail), such as a `CNAME` chain longer than the eight links the server follows |

```console
$ weg ask web.example.com
NOERROR from example.com.: an alias, 2 records starting with the CNAME

answer
web.example.com.  3600  IN  CNAME  www.example.com.
www.example.com.  3600  IN  A      192.0.2.11

$ weg ask host.lab.example.com
NOERROR from example.com.: a referral; the name is delegated, and the name servers below answer for it

authority
lab.example.com.  3600  IN  NS  ns1.lab.example.com.

additional
ns1.lab.example.com.  3600  IN  A  192.0.2.53
```

### An alias to nowhere

A `CNAME` whose target does not exist is answered `NXDOMAIN`. That is correct, since the code
speaks about the end of the chain (RFC 6604), and it is also exactly where `dig` misleads: the
name somebody asked about is there, and the code says it is not. The first line names it as
what it is:

```console
$ weg ask old.example.com
NXDOMAIN from example.com.: an alias, 1 record starting with the CNAME, and the name it leads to does not exist

answer
old.example.com.  3600  IN  CNAME  gone.example.com.

authority
example.com.  3600  IN  SOA  ns1.example.com. hostmaster.example.com. 9 3600 900 1209600 3600
```

That is usually a record left behind when the one it pointed at was deleted, and the
[history of that name](/docs/history/#one-name), `gone.example.com` here, says when.

### Refused, not missing

```console
$ weg ask example.org
REFUSED: no zone on this server covers that name
```

A name outside every zone here is refused rather than called nonexistent, because a server
cannot vouch for the absence of a name in a namespace it does not serve. A name in a
[disabled zone](/docs/zones-and-records/#switching-a-zone-off) is refused the same way, since
on the wire that zone is not there. Neither is an error of the request: the API answers `200`
and says `refused`.

## In the web interface

**Ask** sits in the rail between the query stream and the history, and `g` then `a` gets
there. It leads with the kind of answer, then the response code, the zone and the records,
section by section, and a copy as a zonefile writes it underneath.

{{< screenshot "ask" "The Ask page for 200.0.168.192.in-addr.arpa PTR: headed An alias, NOERROR and authoritative from 0.168.192.in-addr.arpa, with the CNAME into the classless child zone 192/26 and the PTR it leads to, and the questions asked before listed beside it." >}}

Every name in an answer asks about itself. Clicking the target of an alias, a name server in a
referral or the exchange of an `MX` asks the next question, so a chain can be walked without
typing it. The question is kept in the address, which means it can be sent to somebody else
as it is, and the ones asked in the tab are listed beside the answer for comparing.

The same question can start elsewhere: from a record's row in a zone, from a name in the
[query stream](/docs/web-interface/#query-stream), or by typing a name into the palette with
`Ctrl+K`.

## Over the API

```console
$ curl -s -H "Authorization: Bearer $WEG_TOKEN" \
    'http://127.0.0.1:8053/api/v1/ask?name=web.example.com&type=A'
```

```json
{
  "name": "web.example.com.", "type": "A",
  "rcode": "NOERROR", "authoritative": true,
  "outcome": "alias", "zone": "example.com.",
  "answer": [
    { "name": "web.example.com.", "ttl": 3600, "class": "IN", "type": "CNAME", "data": "www.example.com." },
    { "name": "www.example.com.", "ttl": 3600, "class": "IN", "type": "A", "data": "192.0.2.11" }
  ],
  "authority": [], "additional": []
}
```

`outcome` is one of `answer`, `alias`, `nodata`, `nxdomain`, `referral`, `refused`,
`notImplemented` and `failed`. `zone` is absent when no zone covers the name, and
`explanation` carries the extended error where there is one. A missing trailing dot on the
name is added. Asking needs the `read` scope, like any other read, because it shows nothing a
read of the zone's records would not.

## In a cluster

Each member answers from its own copy, on the wire and here alike. Asking a member that trails
the leader therefore shows what that member answers, which is the point when it is the member
in question. [A cluster](/docs/cluster/) has how to tell how far each one has got.
