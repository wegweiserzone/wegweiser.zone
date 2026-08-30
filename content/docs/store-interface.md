+++
title = "The persistence boundary"
description = "Where SQL stops. Why the persistence boundary has the shape it has, and what a second backend would have to satisfy."
weight = 150
group = "How it works"
+++

`internal/store` defines the boundary, `internal/store/sqlite` implements it, and
`internal/store/storetest` is the conformance suite that implementation and every later one
have to pass.

**The interface itself lives in [`internal/store/store.go`](https://github.com/wegweiserzone/wegweiser/blob/main/internal/store/store.go),
and that file is the authority.** This document holds the reasoning that does not belong in
a doc comment: why the boundary has the shape it has, and what SQLite in particular makes
you get right. A prose copy of the method list would drift from the code within a week and
be believed anyway.

---

## 1. Shape, in one paragraph

`Reader` is every read. `Writer` is every write. `Tx` is both, and is reachable only inside
`Store.Update(fn)`. `Store` is `Reader` plus lifecycle: `Update`, `View`, `Migrate`, `Ping`,
`Capabilities`, `Close`. Everything is expressed in `zone.Zone`, `zone.Record`,
`journal.Commit` and the handful of supporting types defined alongside the interface. No SQL
crosses the line in either direction, and `depguard` fails the build if anyone tries.

## 2. Why it looks like this

**`Update(fn)` instead of `Begin()`/`Commit()`.** A transaction that is never handed out
cannot be leaked, committed twice, or held open across a request boundary. The cost is that
a transaction cannot span two calls, which is exactly the constraint worth having.

**Writes exist only on `Tx`.** `Store` embeds `Reader` but not `Writer`, so "write without a
transaction" is not an error to catch at runtime; it is a program that does not compile.

**`Reader` satisfied by both `Store` and `Tx`.** Validation, reverse automation and the
snapshot builder all read, sometimes inside a write transaction and sometimes not. One
interface means one implementation of each helper rather than two that drift.

**Streaming with `iter.Seq2`.** `IterZoneRecords` must never build a slice: a zone with ten
million records would allocate gigabytes at snapshot-build time. Range-over-func gives a
streaming API that still reads like a `for` loop, with the error as the second element
rather than as a field on a cursor object a caller can forget to check.

**Cursor paging, not offset paging.** `LIMIT/OFFSET` over a table under concurrent writes
silently skips and duplicates rows. The virtualized tables in the GUI would put that on
screen the moment two people edit at once. A cursor is opaque and carries the kind of
listing it came from, so a record cursor handed to the zone listing is refused instead of
resuming from a position in the wrong order.

**Capabilities instead of type assertions.** `store.(*sqlite.Store)` anywhere above the
persistence layer would be invariant 3 violated in spirit if not in letter.

**No `*sql.DB`, no `*sql.Rows`, no context-free method.** Every method can block on a lock or
a network round trip once Postgres exists.

## 3. What is deliberately absent

Zone checkpoints, journal truncation and streaming a serial range. They serve rollback and
outbound incremental transfer, both outside the v0.1 scope, and the journal data all three
would read is already being recorded, so adding them later is additive, not a redesign.

Streaming a serial range has a real design question in it that deserves a consumer to be
settled against: serials wrap (RFC 1982), so "in serial order" cannot be an `ORDER BY`.

## 4. SQLite: the parts that bite

Each of these cost a measurement or a failing test to find, and each fails silently rather
than loudly. They are the reason `internal/store/sqlite` looks more careful than a CRUD
layer normally does.

**One writer, two pools.** SQLite allows a single writer. `database/sql` knows nothing about
that and will hand two goroutines two connections to the same file, where they deadlock in a
way the busy handler cannot resolve: backing off does not release the lock the other
connection holds. So: a write pool capped at one connection, and a read pool of several.
Write-ahead logging lets the readers proceed during a write.

**`PRAGMA` settings are per connection, and a broken one is silent.** `foreign_keys` defaults
to off and is per connection, so a pool that opens a fresh connection later gets one where
the `ON DELETE CASCADE` keeping generated records in sync quietly does nothing. Worse,
SQLite accepts a misspelled pragma name and an out-of-range value without a word:
`journal_mode(NOPE)` leaves the database in delete mode and reports success. Therefore `Open`
reads every setting back from real connections and refuses to return a store that is not
configured the way it asked for.

**The journal mode is set once, not per connection.** Switching to write-ahead logging takes
a lock that the busy timeout does *not* cover: SQLite reports the conflict immediately. Four
processes starting at the same moment against a database that does not exist yet therefore
produce three failed starts, which is what the concurrency test found.

**`_txlock=immediate` on the write pool.** A deferred transaction that has already read
cannot be upgraded to a writer while another writer holds the lock, and SQLite reports that
as busy without consulting the busy timeout. Taking the lock at `BEGIN` turns a mid-
transaction failure into a wait at the start.

**`PRAGMA query_only` on the read pool.** A write that reaches the database outside the one
write connection then fails loudly instead of racing the writer.

**An in-memory database cannot be used.** With two pools each connection would get its own
copy, so a write through one would be invisible to the other. `Open` rejects it by name
rather than letting the tests quietly measure nothing.

**A partial index is only used when the query repeats its condition.** `zones_rev_idx` is
declared `WHERE rev_prefix IS NOT NULL`. A query saying `WHERE rev_prefix_len IS NOT NULL`
selects exactly the same rows and gets a full table scan plus a temporary B-tree.

**Row-value `IN` lists do not use an index.** Asking for all 33 possible IPv4 networks, or
all 129 IPv6 ones, as `(rev_prefix_len, rev_prefix) IN (VALUES …)` reads as one indexed
lookup and is measured as a full scan of `zones`, with 129 branches of query text to parse
on every call. See `ReverseZoneFor` for what replaced it and `BenchmarkReverseZoneFor` for
the numbers.

## 5. The conformance suite

`internal/store/storetest` is written against the interface and never against a backend. A
new backend adds one file calling `storetest.Run` and inherits every case, which is what
makes "Postgres behaves like SQLite behind the same interface" a thing the test run
establishes rather than a thing this document asserts.

It lives in a normal package rather than in `_test.go` files because a test file cannot be
imported from another package. Nothing outside a test imports it, so it never reaches the
binary.

Postgres will use one pool with serializable transactions and retries on serialization
failure. `Capabilities.ConcurrentWriters` is what tells the applier whether its per-zone lock
is the only thing ordering writes or a fast path in front of the database's own.
