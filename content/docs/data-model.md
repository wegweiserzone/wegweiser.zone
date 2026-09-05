+++
title = "Data model"
description = "Zones, records and the journal, and the rules the write path enforces over them."
weight = 140
group = "How it works"
+++

The schema below is what SQLite holds today. Where a note says what Postgres would do
instead, that note is reasoning rather than experience: the backend does not exist yet, so
nothing in it has been run.

Three things are modelled: **zones**, **records**, **journal**. Everything else in the schema
— tokens, settings: is support.

**The schema itself is
[`internal/store/sqlite/migrations/0001_initial.sql`](https://github.com/wegweiserzone/wegweiser/blob/main/internal/store/sqlite/migrations/0001_initial.sql),
and the Go types are `internal/zone` and `internal/journal`.** Those are the authority. This
document explains the choices behind them, which is the part that does not survive being
read off a `CREATE TABLE`.

---

## 1. The tables

| Table | Holds | Notes |
| --- | --- | --- |
| `schema_migrations` | Which migrations have run | Created by the migrator, not by a migration; it has to be readable before the first one runs |
| `zones` | One row per zone, SOA included as columns | §4.1 |
| `records` | One row per resource record | §4.4 |
| `journal_commits` | One row per atomic change to one zone | §4.5 |
| `journal_events` | One row per resource-record change inside a commit | §4.5 |
| `api_tokens` | API credentials, by hash | §4.7 |
| `settings` | JSON key–value | |

Timestamps are Unix milliseconds. Serials and TTLs are 32-bit DNS values in signed columns,
with `CHECK` constraints holding them to their real range; the store converts, and nothing
above it ever sees a signed serial.

The `CHECK` constraints mirror the Go types rather than merely guarding against nonsense: an
identifier that is not 26 characters, a rollback with no target serial, a reverse zone with
half a network, and a generated record with a source but no reason are all refused by the
database as well as by the code. Two independent gates on the same invariant is the point.

### Postgres deltas

Same shape, different column types. The `Store` interface hides all of it.

| SQLite | Postgres |
| --- | --- |
| `TEXT` id | `TEXT` id (identical: ULIDs are portable) |
| `INTEGER` timestamp (unix millis) | `timestamptz` |
| `INTEGER` boolean | `boolean` |
| `BLOB` | `bytea` |
| `CREATE INDEX … WHERE` | identical, partial indexes exist |
| `INTEGER` serial (uint32) | `bigint`: Postgres has no unsigned types |

---

## 2. Reverse automation model

{{< diagram "reverse-pair" "An address record on the left, and the PTR record on the right that reverse automation generated from it and marked with its provenance." >}}

The PTR is a normal row in a normal zone. It appears in exports, in AXFR, in diffs and in the
trie with no special handling anywhere. Only two places know it is derived: the applier,
which keeps it in sync, and the UI, which marks it and refuses casual edits. The `ON DELETE
CASCADE` on `managed_by` is what makes "delete the A record and its PTR goes too" a property
of the schema rather than of remembering to do it, and it is exactly the guarantee that
disappears in silence if `PRAGMA foreign_keys` is not on, which is why the store verifies it
at startup.

Finding the responsible reverse zone for an address is a longest-prefix match over
`rev_prefix` / `rev_prefix_len`. The prefix is computed once from the zone name at creation:

| Zone name | Prefix |
| --- | --- |
| `2.0.192.in-addr.arpa.` | `192.0.2.0/24` |
| `0/25.2.0.192.in-addr.arpa.` | `192.0.2.0/25` (RFC 2317 classless child) |
| `8.b.d.0.1.0.0.2.ip6.arpa.` | `2001:db8::/32` (RFC 3596 §2.5 nibble form) |

Deriving it at creation rather than parsing on every lookup keeps the hot lookup an indexed
comparison, and it rejects an unreadable reverse name at the only moment where that is still
cheap. How the lookup itself is phrased turned out to matter a great deal; see
`docs/store-interface.md` §4.

---

## 3. Key decisions and why

### 3.1 SOA is columns, not a record

The alternative, SOA as an ordinary row in `records`, is more uniform and was tempting.
Rejected because the serial is owned by the journal, not by the user. As a record it becomes
hand-editable, and a hand-edited serial breaks the one-commit-one-serial-step invariant that
rollback and IXFR both rest on. As columns it is unambiguous who writes it, and reading the
current serial for an optimistic-concurrency check is one indexed column instead of a join.

Cost: the snapshot builder and the zonefile writer synthesize the SOA record, and the
zonefile *importer* has to map an incoming SOA onto the zone rather than pass it through.
`zone.Record` refuses a record of type SOA outright, so that obligation cannot be forgotten
quietly. Per D2 an import seeds the serial and counting continues from there, which is why a
`zone_create` commit is the one kind allowed to start at a serial other than 1.

### 3.2 RDATA is canonical presentation format

Stored as text, fully qualified, origin-independent: `www.example.com.`, never `www`. Full
reasoning in `docs/decisions/d18-rdata-presentation-format.md`. Short version: this product is
built around diffs, audit logs and human editing, and presentation format is the only
representation where all three are natural. Unknown types stay lossless via the RFC 3597
`\# <len> <hex>` form.

Because the form is canonical, equality of record data is string equality, which is what lets
a plain unique index catch a duplicate RR. `rdata_hash` exists because that index has to
cover the data and a TXT record holds up to 64 KB, which does not belong in a B-tree key. It
is a **SHA-256 truncated to 16 bytes**, not BLAKE2b as originally drafted: the hash guards a
uniqueness constraint on data the server itself canonicalised, carries no security weight,
and the standard library already has it, a dependency for this would be a poor trade.

Getting back from stored text to a value uses `zone.RDataFromCanonical`, which skips the
parse. Canonicalising parses the data several times over, measured at 2 to 4 microseconds and
around forty allocations per record; a zone of half a million records would pay a second of
that on every snapshot rebuild, which happens on every commit. The precondition, that the
text came out of `ParseRData`, holds because the store is what wrote it.

### 3.3 `sort_key` gives canonical DNS ordering for free

Labels reversed, lowercased, each terminated by two zero octets, with an embedded zero octet
inside a label escaped to `0x00 0xFF`:

```
www.example.com.  →  com\x00\x00example\x00\x00www\x00\x00
*.example.com.    →  com\x00\x00example\x00\x00*\x00\x00
example.com.      →  com\x00\x00example\x00\x00
```

Plain byte comparison of this key equals the canonical name ordering of RFC 4034 §6.1: the
terminator sorts below every label byte, so a shorter name always precedes its descendants,
and `*` (0x2A) sorts before letters exactly as the RFC requires.

`ORDER BY sort_key` therefore gives a correct zone export, a correct tree walk for the GUI,
and, when DNSSEC arrives, a correct NSEC chain, without a second index or a sort in Go.

It pays a second time in filtering: because the key of a name is a byte prefix of the key of
everything below it, "this name and everything under it" is one indexed range rather than a
`LIKE` that scans.

### 3.4 Records are stored individually, RRsets are enforced

DNS operates on RRsets, not on records (RFC 2181). Storing RRsets directly would make the
constraints structural. Rejected: every UI affordance the product promises (per-record
comments, per-record provenance for generated PTRs, a stable ID to link a diff line to, row
selection in a virtualized table) needs a per-record identity.

So: individual rows, with the RRset rules enforced in validation and re-checked by
`weg zone check`. The two that matter are uniform TTL within an RRset (RFC 2181 §5.2) and no
duplicate RR within an RRset (§5, enforced by `records_rr_uq`). Full rationale in
`docs/decisions/d20-individual-records.md`.

`DeleteRRset` exists on the store for the same reason: the RRset is what DNS operates on, so
removing one should not require a caller to enumerate the members first and race whoever adds
one in between.

### 3.5 Scalar types are named, not bare integers

`RRType`, `Class`, `TTL` and `Serial` are distinct types rather than `uint16`/`uint32`. They
render as mnemonics in JSON and YAML, so the API says `"AAAA"` rather than `28`, and they
carry the rules that belong to them: `RRType.Storable` knows that a QTYPE or a meta type may
not be written to a zone (RFC 6895 §3.1), and `ParseTTL` accepts the suffixed form BIND uses
so a value pasted out of an existing zonefile works as typed.

`Serial` is a struct specifically so that `<` does not compile. Serials wrap, and comparing
them as plain integers is the classic way to make a secondary refuse a transfer forever
(RFC 1982).

`TTL` counts seconds rather than being a `time.Duration`. A Duration admits values such as
1500 ms that DNS cannot represent, which would force a rounding decision into several
different places. `MaxTTL` is 2^31-1, because RFC 2181 §8 requires a receiver to read a TTL
with the top bit set as zero: accepting one would store something resolvers treat as "do not
cache".

### 3.6 Two journal tables

A commit is what a human did; an event is what changed on the wire. One human action is one
commit and one serial step, but produces N record-level events: an A record plus its
generated PTR is already two, in two different zones.

Splitting them means the audit log and diff view read `journal_commits` (small, indexed by
time) while a transfer reads `journal_events` for a serial range. Neither pays for the other,
and `ListCommits` can render a screen of headings without loading a single event.

A commit belongs to exactly one zone. A change touching a forward and a reverse zone produces
**two commits**, one per zone, written in the same transaction. Zones have independent
serials; a commit spanning zones could not advance both correctly.

They carry one timestamp, read once for the whole change rather than once per zone. One
command was accepted at one moment, and a clock read per zone puts an order between those
commits that nothing meant by it — which a reader of the history, sorting by time, would take
for a sequence.

Events are numbered from zero without gaps, with every deletion before every addition, so
that a commit is already a difference sequence in the shape RFC 1995 §2 requires.

**A commit outlives its zone.** `journal_commits` deliberately has *no* foreign key to
`zones`, and carries `zone_name` of its own. The alternative was tried and is incoherent: with
a cascade, the `zone_delete` commit is erased by the very deletion it records, so either the
kind is dead weight or zone deletion bypasses the journal, and the second breaks architecture
invariant 4. Records do cascade, because they belong to the zone rather than to its history.

The cost is that a deleted zone's commits accumulate with nothing pointing at them, and that
`zone_id` has no referential integrity. Both are acceptable: the journal is append-only
regardless, and a retention policy is a separate question from this one. Recreating a zone
under the same name gets a fresh identifier, so the old history does not attach itself to it.

### 3.7 Rollback moves forward

Restoring a zone to serial 42 does not rewind the journal. It computes the difference between
the current state and the state at serial 42 and writes it as a **new** commit with
`kind='rollback'` and `reverts_to=42`. History is append-only, and the schema enforces that
only a rollback carries a target.

This is not tidiness, it is correctness: a secondary that has already seen serial 90 will
never accept a jump back to 42 (RFC 1982 arithmetic makes 42 *older*, and RFC 1995 has no way
to express going backwards). Moving forward to a state that happens to equal serial 42 is the
only representation that works for both the UI and the wire.

### 3.8 Token hashing is SHA-256, not Argon2

Deliberate, and the opposite of the usual advice. A password is low-entropy and needs a slow
KDF; an API token is 256 bits from `crypto/rand` and is not brute-forceable regardless of the
hash speed. A slow KDF on every API request would just be a self-inflicted rate limit.
Comparison is constant-time; the stored `prefix` is display-only so the UI can show which
token is which without keeping the secret.

Unknown, revoked and expired tokens all leave the store by the same door (`ErrNotFound`,
decided in the query rather than after it) so that a caller cannot learn which tokens exist
by watching which error comes back. Tokens are revoked, never deleted, so the audit log keeps
naming the token behind each change.

### 3.9 ULID primary keys

Not auto-increment integers. Three reasons: they are assignable before the transaction, they
survive being merged across nodes when Raft arrives, and they are safe to expose in the API
so URLs do not leak row counts. Not UUIDv4, because ULIDs are time-ordered and therefore keep
B-tree insert locality: the property UUIDv4 destroys.

The store refuses to mint one. Once nodes replicate, the identifier has to be part of the
command every node applies, or two nodes would invent two identifiers for one change.

The cost is 26 bytes per key instead of 8. It is affordable here specifically because the
query path never touches the database: IDs matter only on the edit path, which is orders of
magnitude lower in volume. Revisit if a benchmark at 10M records says otherwise.

---

## 4. Validation rules

Enforced in `internal/zone`, as pure functions over the proposed state, and table-tested.
The store re-checks the cheap ones before writing, and the schema re-checks a subset again.

**Structural**

- Label ≤ 63 octets, name ≤ 255 octets on the wire (RFC 1035 §2.3.4)
- TTL in `[0, 2^31-1]`; the top bit must be zero (RFC 2181 §8)
- Names are stored lowercase and compared case-insensitively (RFC 4343)
- Every record's name must be at or below its zone's apex

**RRset**: `ValidateRRset`

- Uniform TTL across an RRset (RFC 2181 §5.2)
- No duplicate RR within an RRset (§5)

**Owner**: `ValidateOwner`, which needs only the name being written and is therefore what
the applier runs on every edit

- A CNAME may not coexist with any other type at the same owner (RFC 2181 §10.1)
- No CNAME at the zone apex: SOA and NS live there
- A PTR's owner name must fall inside its zone's prefix

**Zone**: `ValidateZone`, which walks everything and is therefore for imports and
consistency checks

- At least one NS at the apex (RFC 1034 §4.2.1)
- At a delegation point, only NS records
- Below a delegation, only A and AAAA glue

Still to arrive with the applier: CNAME chains within a zone must not form a loop, the last
apex NS cannot be deleted, glue is required when the NS target is inside the delegated
namespace, and a generated PTR may not be edited directly.

---

## 5. Migrations

Numbered, forward-only SQL files embedded via `embed.FS`, applied in a transaction, recorded
in `schema_migrations`. The sequence is checked for gaps on load: a lost file would produce a
schema that never existed anywhere else, which is worse than refusing to start.

Whether a migration should run is decided *inside* the transaction that applies it, so two
processes starting at the same moment cannot both run one.

Before the first tagged release, `0001_initial.sql` may be amended in place rather than
corrected by a second migration: no database it has ever run against outlives a test. After
that release it is immutable like every other, and a change is a new file.

No down-migrations. For a single-binary product they are a liability, because the tested
recovery path is "restore the backup", not "run the down-migration nobody has ever
exercised", and offering the second mostly invites people to skip the first. `weg db backup`
will exist so that path is available before every upgrade.

The store refuses to open against a schema version newer than the binary knows: a downgraded
binary must not write rows an older schema cannot represent.
