+++
title = "History and rollback"
description = "Every change is a commit with a reason and an author. What that buys: an audit trail, a diff of any edit, and a way back that is one command."
weight = 40
group = "Everyday"
+++

Nothing changes a zone without leaving a record of what changed, who did it and why. That is
not a feature bolted on for auditing: it is the same structure the server uses to answer an
incremental zone transfer, so it cannot fall behind without transfers breaking too.

## What happened

```console
$ weg history list example.com
WHEN                 ZONE          SERIAL  KIND         WHO        COMMENT
2026-08-30 00:44:49  example.com.  3→4     edit         bootstrap  update record
2026-08-30 00:44:24  example.com.  2→3     edit         bootstrap  add record
2026-08-30 00:44:11  example.com.  0→1     zone_create  bootstrap  create zone
```

Without a zone name it lists everything the server has ever done, which outlives the zones
themselves: "who deleted example.com" is a question worth being able to answer after the
zone is gone.

The serial column is the point. One commit advances it by exactly one, so the history is a
contiguous chain rather than a log beside the data.

## What changed

```console
$ weg history show 01M17V4VY90Y5WJ33Q9YNGW7N3
01M17V4VY90Y5WJ33Q9YNGW7N3  2026-08-30 00:44:49  edit  serial 3→4  by bootstrap
update record

-www.example.com. 3600 IN A 192.0.2.10
+www.example.com. 3600 IN A 192.0.2.99
```

A real diff, in the presentation format the records are stored in, so it says exactly what a
zonefile would have said. The web interface shows the same thing side by side, with a button
to put the zone back to the state before it.

## Going back

```console
$ weg zone rollback example.com 3
weg: no terminal to ask on: pass --yes to put example.com. back to the state it had at serial 3
```

It asks first, and in a script it refuses to guess:

```console
$ weg zone rollback example.com 3 --yes --comment "the address change was a mistake"
example.com. is back at the state it had at serial 3 — 2 record changes, now serial 5
```

Note the serial: it went forward, to 5. A rollback works out the difference between the
current state and the one you named, then writes that difference as a new commit. The history keeps the mistake and the correction, and a secondary sees an
ordinary change it can transfer incrementally. A rewound serial would make every secondary
think its copy was newer than the primary's, which is how a mistake becomes an outage.

Reverse entries follow. Rolling back an address change puts the `PTR` back where it was,
because that entry belongs to the record the rollback restored.

## Who did it

Every commit carries the token or session that caused it. The `WHO` column above says
`bootstrap` because that is the name of the administrator token minted on first start. A
token per person or per script keeps that column useful:

```console
$ weg token create deploy --scope write
```

[Access](/docs/access/) has the rest.

## How far back it goes

All the way, by default. Nothing is pruned on a timer, because the journal is what an
incremental transfer is replayed from: a secondary that has been away longer than the
history goes back has to take the whole zone again, which is correct but larger than it
needed to be.

That means the database grows with the number of changes rather than with the size of the
zone. For a zone edited a few times a week this is nothing. For one under a script that
rewrites it every minute, it is worth planning for.

## What is not in it

`TouchToken` — the record of when a token was last used — is written outside this path on
purpose and produces no commit. It records that a token was used, which is node-local
bookkeeping rather than a change to a zone; including it would bury the real changes.
