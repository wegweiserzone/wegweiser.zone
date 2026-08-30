+++
title = "Reverse zones"
description = "The PTR half, written for you. What gets generated, what happens when two names want one address, and how to take a generated record back by hand."
weight = 30
group = "Everyday"
+++

Reverse DNS is the half everyone forgets, because it lives in a different zone with the
octets backwards and nothing complains when it drifts. This server writes it for you.

## It follows the address record

Create the reverse zone by naming the network. The octets are reversed for you:

```console
$ weg zone create 192.0.2.0/24
created 2.0.192.in-addr.arpa. (reverse), serial 1, ns1.2.0.192.in-addr.arpa.
```

After that, an address record writes its own reverse entry:

```console
$ weg record add example.com mail A 192.0.2.20
added mail.example.com. 3600 IN A 192.0.2.20
  generated 20.2.0.192.in-addr.arpa. 3600 IN PTR mail.example.com.
```

It follows the record for the rest of that record's life. Change the address and the old
entry goes with the new one arriving:

```console
$ weg record update example.com www A 192.0.2.10 --data 192.0.2.99
updated www.example.com. 3600 IN A 192.0.2.99
     from www.example.com. 3600 IN A 192.0.2.10
  generated 99.2.0.192.in-addr.arpa. 3600 IN PTR www.example.com.
```

The `PTR` at `.10` is gone, not orphaned. Delete the address record and the entry goes too.
[Roll the zone back](/docs/history/) and the reverse zone follows it backwards.

## It works retroactively

Creating a reverse zone for a network that is already in use does not leave you with an
empty zone to fill in by hand. The zone is created, and then filled from every address
record already pointing into it, as a commit of its own:

```console
$ weg history list 2.0.192.in-addr.arpa.
WHEN                 ZONE                   SERIAL  KIND         WHO        COMMENT
2026-08-30 00:44:24  2.0.192.in-addr.arpa.  1→2     edit         bootstrap  fill in the reverse entries this zone's records imply
2026-08-30 00:44:24  2.0.192.in-addr.arpa.  0→1     zone_create  bootstrap  create zone
```

The same applies to switching automation on for a zone that already has records. If you ever
need it explicitly, `weg zone reconcile` writes what is missing and only ever adds.

## Which zone is responsible

The most specific one that covers the address. With `10.0.0.0/8` and `10.1.0.0/16` both
held, an address in `10.1.x.x` goes to the `/16`. Nothing is written into a network you do
not hold: if no reverse zone covers the address, the server says so and writes nothing
rather than inventing a zone you did not ask for.

IPv6 works the same way through `ip6.arpa` nibble zones, and RFC 2317 classless delegation
is generated where this server holds the parent of a sub-`/24` delegation.

## When two names claim one address

Several names on one address is ordinary: a virtual host, a load balancer, an alias. Only
one of them can be the reverse answer, because a `PTR` set with several names in it breaks
the reverse-lookup checks that mail and logging do.

So there is a policy, and it is server-wide:

```console
$ weg settings set --reverse-conflict-policy first-wins
```

| | What happens |
| --- | --- |
| `first-wins` | The name already answering keeps the address. The default, and the only setting that never changes an answer nobody asked to change. |
| `last-wins` | The new name takes it over. A reverse entry somebody wrote by hand is still never replaced. |
| `multi` | Every name answers. The literal reading, and the one that breaks those checks. |
| `reject` | The whole write fails, address record included. |

Whichever is set, **the conflict is reported rather than swallowed.** The write says what it
did not do, and `weg zone check --reverse` lists the addresses two names are claiming at any
time. A conflict is worked out from the records every time rather than stored, so it stops
being reported the moment it stops being true.

To settle one deliberately:

```console
$ weg record canonical example.com www A 192.0.2.10
```

That hands the reverse entry for the address to the record you name, taking it from whatever
generated record holds it.

## Taking one over by hand

A generated record is marked as generated, and the marking is what lets the server keep it
in step. If you want to write something else there:

```console
$ weg record detach example.com 10.2.0.192.in-addr.arpa. PTR
```

Detaching keeps the record and drops the provenance. From then on it is yours: the server
will not update it when the address record changes, and will not delete it when that record
goes. That is deliberate — a record somebody edited by hand is a statement that the
automation should keep its distance.

An entry written by hand is never replaced by automation either, whatever the policy says.

## Switching it off

```console
$ weg zone update example.com --auto-reverse off
$ weg zone update example.com --auto-reverse server
```

Per zone, and with three states rather than two. `server` is not the same as `off`: it puts
the zone back on the server-wide setting, so changing that setting reaches this zone again.
`off` is a decision this zone keeps regardless.

Switching it off takes nothing away. The entries already generated stay where they are; it
only stops new ones appearing.
