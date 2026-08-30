+++
title = "Zones and records"
description = "Creating, changing and removing the things a nameserver actually holds, and the rules the write path will not let you break."
weight = 20
group = "Everyday"
+++

## Zones

```console
$ weg zone create example.com
$ weg zone list
$ weg zone show example.com
$ weg zone update example.com --ttl 300
$ weg zone delete example.com
```

A zone is created with a start of authority filled in from this server's defaults: `ns1`
under the zone as the name server, `hostmaster` under it as the mailbox, and timers that are
ordinary rather than clever. Every one of them is a flag on `create` and on `update`:

```console
$ weg zone create example.com \
    --ns ns1.example.com. --ns-address 192.0.2.53 \
    --email hostmaster@example.com --ttl 300
```

`--ns-address` is worth the extra words. It writes the address record for the name server in
the same commit that creates the zone, which is the difference between a zone that works and
one that needs the fix described in [checking a zone](/docs/checking/).

### The serial is not yours to set

There is no `--serial`. One commit advances it by exactly one, always, and that is what lets
the journal be replayed as an incremental transfer. A zone imported from a file keeps the
serial the file carried, and steps by one from there.

### Switching a zone off

```console
$ weg zone disable example.com
$ weg zone enable example.com
```

A disabled zone stays in the database with all its records and stops being answered for
entirely: it is not in the snapshot, so queries for it are REFUSED and a transfer of it is
refused too. It is the reversible half of `delete`.

## Records

```console
$ weg record add example.com www A 192.0.2.10
$ weg record list example.com
$ weg record update example.com www A 192.0.2.10 --data 192.0.2.11
$ weg record delete example.com www A
```

The shape is always the same: the zone, the name, the type, then the data. A name without a
trailing dot is inside the zone, so `www` means `www.example.com.` and `@` means the apex. A
name with a trailing dot is absolute and has to be inside the zone anyway.

`--ttl` overrides the zone's default for one record. Left out, the record inherits, and a
change to the zone's default moves every record that never said otherwise.

### Changing one record out of several

`www A` may be three records. `update` and `delete` take the data to identify which:

```console
$ weg record update example.com www A 192.0.2.10 --data 192.0.2.11
updated www.example.com. 3600 IN A 192.0.2.11
     from www.example.com. 3600 IN A 192.0.2.10
```

Without the data, `delete` removes the whole set at that name and type. That is occasionally
what you want and never what you want by accident, so it is worth being explicit.

### Switching a record off

```console
$ weg record disable example.com www A 192.0.2.10
$ weg record enable example.com www A 192.0.2.10
```

A disabled record is kept, is not answered with, and is left out of a zonefile export: a
file has nowhere to say "present but switched off". It is how you take something out of
service without losing the thing you will want back.

## What the write path refuses

These are not warnings. The write does not happen.

**A CNAME beside other data at the same name.** RFC 2181 §10.1: a CNAME is an alias for
everything at that name, so nothing else can live there. The apex therefore cannot be a
CNAME, because the SOA and NS records are already there.

**Two TTLs inside one RRset.** RFC 2181 §5.2: every record of one name and type shares one
TTL. Changing the TTL of one changes the set.

**Anything but NS at a delegation point.** Once `sub.example.com. NS` exists, a query for
that name is referred to the child and never answered from here, so a `TXT` there would be
invisible:

```console
$ weg record add example.com sub TXT '"hello"'
weg: invalid: "sub.example.com." delegates to another zone, so its TXT record would never
be answered; a query for that name is referred to the child (RFC 1034 §4.2.1)
```

**Anything but glue below one.** Below a delegation, `A` and `AAAA` are allowed and nothing
else. Those two are glue: they let a resolver reach the child's name servers, which it could
not otherwise look up without asking the zone it is trying to find. A `TXT` there is refused
for the same reason as above.

The rule holds whichever order the records arrive in. Writing the `TXT` first and then
delegating over it is refused too, because the delegation is checked against the names it
puts out of reach as well as the name it touches. Otherwise the same zone would be legal or
illegal depending on the order somebody happened to type it in.

**A duplicate.** The same name, type and data twice is not two records.

**A name outside the zone.** `weg record add example.com www.other.example. A …` is refused
rather than quietly creating something nothing will answer.

## Names, case and the wire

Names are stored the way you typed them and compared without regard to case, which is RFC
4343. A query is answered with the casing the *query* used, not the casing in the database,
which is the 0x20 defence against off-path spoofing.

Record data is stored in the canonical presentation format of its type, not as the string
you typed. `1.2.3.4` and `01.02.03.04` are the same address and come back the same way; an
unknown type round-trips unchanged as RFC 3597 requires.

## Where to go next

- [Reverse zones](/docs/reverse-zones/): the PTR half, which is written for you.
- [History and rollback](/docs/history/): every one of the commands above is a commit.
- [Checking a zone](/docs/checking/): what is wrong that the write path allowed.
