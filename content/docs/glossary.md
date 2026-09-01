+++
title = "Glossary"
description = "The DNS terms this documentation uses without stopping to explain them, and the few that mean something particular here."
weight = 180
group = "Reference"
toc = false
layoutHint = "terms"
+++

Written for someone who runs a network rather than someone who implements a resolver. Where
a term has a precise definition in an RFC, the RFC is named and this is the short version.

## The shape of the system

### Zone

A slice of the namespace one server is responsible for, from an apex downwards
until a delegation hands part of it away. `example.com` and `192.0.2.0/24` are both zones
here; the second is a reverse zone.

### Apex

The top of a zone, where its `SOA` and `NS` records live. `example.com.` is the
apex of the zone `example.com`. It cannot be a `CNAME`, because those records are already
there.

### Authoritative

A server that answers for a zone from its own data, and whose answer is
the truth rather than a copy. Wegweiser is only ever this.

### Recursive

A server that goes and finds an answer on your behalf by asking others.
Wegweiser is never this; [a resolver in front](/docs/resolver-in-front/) is the arrangement
that gives you both.

### Delegation

An `NS` record saying that everything at and below a name belongs to
another zone. Once `sub.example.com. NS` exists, a query for anything under it is referred
to the child rather than answered here.

### Glue

An `A` or `AAAA` record for a name server that lives inside the zone it serves.
Without it a resolver cannot reach `ns1.example.com.` without first asking
`example.com.`, which is what it is trying to find. Glue is the only thing that may remain
below a delegation.

### Stub zone

A resolver's note that one particular zone is answered by one particular
server, so it hands those queries straight there instead of walking down from the root.

## Records

### Resource record

One fact: a name, a class, a type, a time to live, and data.
`www.example.com. 3600 IN A 192.0.2.10`.

### RRset

Every record sharing one name and type. They are answered together and, by
RFC 2181 §5.2, they share one TTL. Changing the TTL of one changes the set.

### TTL

How long a resolver may keep an answer before asking again. Lower means changes
land sooner and costs more queries.

### SOA

Start of authority, the record at the apex naming the primary server, the
administrator's mailbox and the timers a secondary follows.

### Serial

The version number in the SOA. A secondary compares it to decide whether its
copy is stale. Here it advances by exactly one per commit, which is what makes the history
replayable as an incremental transfer.

### NS

Names a server authoritative for a zone. At the apex it says who answers for this
zone; below it, it delegates.

### A and AAAA

An IPv4 and an IPv6 address for a name.

### PTR

The reverse direction: an address, written backwards under `in-addr.arpa` or
`ip6.arpa`, pointing at a name. [Reverse zones](/docs/reverse-zones/) is what this server
does about them.

### CNAME

An alias. RFC 2181 §10.1: nothing else may live at a name that has one, because
the alias covers everything at that name.

### MX, TXT, SRV

A mail exchanger, free text, and a service's host and port.

## Reverse DNS

### Reverse zone

The zone that answers `PTR` queries for a network. `192.0.2.0/24`
becomes `2.0.192.in-addr.arpa.`, the octets reversed. Wegweiser accepts the network
wherever a zone name is taken, so you never write it out by hand.

### Nibble zone

The IPv6 equivalent, under `ip6.arpa`, one hex digit per label and
therefore very long (RFC 3596 §2.5).

### RFC 2317

Classless delegation, for when somebody has been given part of a `/24` rather
than the whole thing. The parent points at a name the delegate controls, and `PTR` lookups
follow a `CNAME` to get there.

### Managed record

A record this server generated and keeps in step with the one that
caused it. Detaching a managed record hands it to you, and automation leaves it alone
afterwards.

## Transfer

### Primary

The server a zone is edited on.

### Secondary

A server that holds a copy it fetched, and answers from it. It cannot be
edited.

### Hidden primary

A primary no `NS` record names. It exists to be edited and to feed the
servers that do answer, and is the arrangement [zone transfer](/docs/secondaries/) here was
built for.

### AXFR

A full zone transfer. Everything, in one session, over TCP (RFC 5936).

### IXFR

An incremental one: only what changed since the serial the secondary names
(RFC 1995). Where the difference cannot be worked out, the answer is a full transfer
instead, which is never wrong and only larger.

### NOTIFY

A message telling a secondary that a zone changed, so it asks now rather than
when its refresh timer fires (RFC 1996).

### TSIG

A shared secret both ends sign messages with (RFC 8945). A key grants a transfer
from any address, which an address list cannot do across an organisational boundary.

## Answers

### NXDOMAIN

The name does not exist. RFC 8020: it means nothing below it exists either.

### NODATA

The name exists, but not with the type you asked for. Not an error, and not
the same as NXDOMAIN.

### REFUSED

This server will not answer that. What a name outside its zones gets here,
because it does not resolve.

### SERVFAIL

Something went wrong. A transfer arriving when every slot is in use gets
this, which is a secondary's cue to come back later.

### Referral

An answer that does not contain the data but names the servers that have it.
What a delegation produces.

### EDNS0

The extension that lets a client say how large a UDP response it can take, and
carries extended error codes (RFC 6891).

### Extended DNS error

A machine-readable reason attached to a failure, so "SERVFAIL"
can say *why* (RFC 8914).

### 0x20 encoding

Mixing the case of a query name and requiring the same mixture back, as
a cheap defence against off-path spoofing. Names are compared case-insensitively anyway
(RFC 4343).

### Truncation

A UDP response too large to send gets the TC bit, and the client asks again
over TCP.

## This project's own words

### Snapshot

The immutable in-memory structure queries are answered from. A write builds a
new one and swaps it in by pointer, so a change never blocks a query in flight.

### Journal

The record of every change, as commits. It is the audit log, the source of a
diff, what a rollback is computed from, and what an incremental transfer is replayed out of
— one mechanism, not four.

### Commit

One write, with the records it changed, who caused it, why, and the serial it
moved the zone to.

### Applied index

How far a node has got through the replicated log. It exists for the
clustering that is not built yet.

### Decision record

A numbered document in the server repository settling one question and
saying why. The documentation cites them as D1, D2 and so on.
