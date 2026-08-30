+++
title = "Import and export"
description = "Zonefiles are how a zone gets in and out. Migrating off another nameserver, and getting a file back that another one will read."
weight = 60
group = "Everyday"
+++

Zonefiles are an interchange format here, not a storage format. Nothing is served from a
file and no file is kept in step with the database. What exists is a parser and a writer for
RFC 1035 §5, so that moving in takes minutes and moving out is always possible.

## Bringing a zone in

```console
$ weg zone import db.example.com
$ weg zone import db.example.com --origin example.com.
$ dig @old-server example.com AXFR | weg zone import
```

The origin comes from `$ORIGIN` in the file, or from the flag, or from the SOA. The last
form is the migration: ask the old server for the zone and pipe it straight in. If it will
not hand you a transfer, its own zonefile does just as well.

An import is one commit, whatever the file's size. The zone starts at **the serial the file
carried**, not at 1, so a secondary that already had the zone from the old server sees a
number it recognises and steps forward from there.

What comes in is validated the same way a typed record is. A file with a CNAME beside other
data is refused as a whole rather than half-loaded, which is the useful behaviour: half a
zone is worse than none.

## Writing one out

```console
$ weg zone export example.com > db.example.com
$ weg zone export example.com | named-checkzone example.com /dev/stdin
```

```
$ORIGIN example.com.
$TTL 3600

example.com.	3600	IN	SOA	ns1.example.com. hostmaster.example.com. (
			5            ; serial
			3600         ; refresh
			900          ; retry
			1209600      ; expire
			3600         ; negative caching
			)

example.com.	3600	IN	NS	ns1.example.com.
mail.example.com.	3600	IN	A	192.0.2.20
www.example.com.	3600	IN	A	192.0.2.10
```

Every name is absolute and every record carries its own TTL and class, so no line means
something different when it is copied out of context. Records come out in the canonical
order of RFC 4034 §6.1, which has a useful consequence: **exporting the same zone twice is
the same bytes**, and a diff of two exports is a diff of two zones.

A disabled record is left out. It is not part of the zone as it answers, and a file has
nowhere to say "present but switched off".

## As a backup

An export carries records and no secrets. That makes it the right thing to attach to a bug
report, and a reasonable second line of defence beside a copy of the database — but it is
not a backup of the server. It does not carry the history, the tokens, the transfer keys or
the settings. [The database file](/docs/deployment/) is what holds those, and copying it has
a rule of its own.

## What a zonefile cannot carry

The provenance of a generated record. A `PTR` written by reverse automation and a `PTR`
typed by hand are the same line in a file, so a zone that goes out and comes back arrives
with every record detached, belonging to nobody. That is the honest outcome rather than a
guess, and it is a reason to move zones with `import` once rather than to round-trip them
as a habit.
