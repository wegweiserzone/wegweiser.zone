+++
title = "Architecture"
description = "The two flows that define the system: a query from the wire to the response, and a write from the API until queries can see it."
weight = 130
group = "How it works"
+++

This document describes the two flows that define the system: a query arriving on the wire
until a response leaves it, and an API write until the new state is visible to queries.
Everything else in the codebase exists to serve one of those two paths.

---

## 1. Overview

{{< diagram "planes" "The control plane takes an API write through validation and the journal into the store; the data plane answers queries from an immutable snapshot that is rebuilt and swapped in." >}}

The only coupling between the planes is a single `atomic.Pointer[Snapshot]`. The control
plane writes it, the data plane reads it. There is no lock, no channel and no callback on
that boundary; see invariant 2 in `docs/conventions.md`.

The store is the source of truth. The snapshot is a derived cache and can always be rebuilt
from the store. That direction is never reversed; it is what makes crash recovery trivial
and what will make Raft state-machine replay correct later.

---

## 2. Query path: wire in, wire out

### 2.1 Ingress

`internal/dns` owns its listeners rather than building on `miekg/dns.Server`. The
measurement that decided it is `BenchmarkServerUDP`: that server hands every datagram to a
new goroutine, which puts a scheduler round trip on the latency of every query and allocates
21 objects where answering in place allocates 4. Over loopback with sixteen clients it
answers in 4751 ns against 1874.

UDP and TCP are separate listeners on the same address, as required by RFC 1035 §4.2.

- **UDP**: `SO_REUSEPORT` sockets, one reader goroutine per socket, `GOMAXPROCS` sockets.
  Kernel-side fan-out avoids a single accept bottleneck and keeps each goroutine on its own
  socket buffer. A query is answered in the goroutine that read it: resolving and packing
  takes well under a microsecond and waits on nothing, so a handoff would buy no parallelism
  and cost a scheduling round trip. The parallelism comes from the sockets instead. A
  configured port of 0 is resolved after the first bind and the other sockets join it, or
  the server ends up listening on as many addresses as it has readers.
- **TCP**: accept loop with a per-connection read deadline and an idle timeout. Queries
  pipelined on one connection are answered in order, one at a time. RFC 7766 §6.2.1.1 allows
  answering them concurrently and out of order, and there is nothing to win by it while
  every answer is an in-memory lookup: a worker per question would add scheduling and a
  write lock, and would let one connection turn itself into an unbounded number of
  goroutines. Throughput across connections is unaffected, because each has a reader of its
  own. The shape to change, should a query ever have to wait for something, is a worker
  dispatched from that loop with the writes serialised.
- **Open connections are bounded**, at 150 by default, and a connection arriving when they
  all are is closed straight away rather than queued. A connection costs a goroutine, a
  `Responder` and buffers that grow to the largest message the client has sent, up to the
  64 KiB the length prefix allows, so an unbounded accept loop is a cheap way to take the
  server's memory and file descriptors, and TCP is exactly where a datagram client is *told*
  to go when an answer does not fit. Closing rather than blocking the accept loop keeps one
  stalled client from holding up every new one for a whole idle period. The operator is told
  once when the bound starts being reached, not once per refused connection: reporting each
  one would let a flood generate work of its own.
- Buffers are owned rather than pooled. A UDP reader holds its read buffer, its response
  buffer and its `Responder` for the life of the socket, and a connection holds its own for
  the life of the connection, so there is nothing shared on the query path and nothing to
  contend for. A datagram larger than the read buffer is read short and then fails to parse,
  which is the answer it was going to get anyway; on TCP the two-octet length prefix of
  §4.2.2 bounds a message without a limit of this server's.

Hard limits are applied before parsing: message size, label length 63, name length 255
(RFC 1035 §2.3.4), question count exactly 1 for QUERY.

### 2.2 Parse and reject

Parsing uses `miekg/dns`. Failure modes, in order of checking:

| Condition | Response |
| --- | --- |
| Unparseable header | drop, no response (nothing safe to echo) |
| Parseable header, broken body | FORMERR, echo ID and question if recoverable |
| OPCODE not QUERY/NOTIFY/UPDATE | NOTIMP |
| QDCOUNT ≠ 1 | FORMERR |
| EDNS version > 0 | BADVERS (RFC 6891 §6.1.3) |
| QCLASS not IN | REFUSED |

Two of those are stricter than they look. A message with QR already set is a response, and
answering a response is how two servers talk each other into a loop, so it is dropped along
with a message too short to hold a header. And CH is refused rather than passed through:
`version.bind` and its neighbours (RFC 4892) do not exist in v0.1, so there is nothing to
say in that class, and REFUSED is what having nothing to say means. When they arrive, this
row is where they arrive.

The parser is fuzzed from the first commit. A malformed packet that panics is a remote DoS,
so this is the one place where "never panic" is a hard requirement rather than a goal.

### 2.3 Snapshot acquisition

```go
snap := h.current.Load()   // *Snapshot, immutable for its whole lifetime
```

One atomic load per query. The snapshot the query holds stays valid for the whole request
even if a write swaps in a newer one mid-flight; the old snapshot is garbage collected once
the last in-flight query releases it. That is the RCU property, and it is why a zone change
cannot block a query.

### 2.4 Zone selection

`Snapshot.zones` is a map keyed by the whole apex name. The longest-suffix match on QNAME is
a walk from QNAME up towards the root, and the first zone found is by construction the most
specific one this server is authoritative for.

- No match → **REFUSED**. Not NXDOMAIN: this server cannot assert non-existence for a namespace it does
  not serve. (RFC 1035 §4.1.1 defines Refused as "the name server refuses to perform the
  specified operation"; asserting NXDOMAIN out of authority is the classic lame-server bug.)
- Match → continue inside that zone.

Zone count is small (thousands) relative to record count (millions), so zone lookup and
record lookup use separate structures. Changing one zone then replaces one entry and carries
every other zone over by pointer.

**Both shapes were measured** (this map plus a walk, against the suffix trie of reversed
labels that this section prescribed before) with the depth bound of §2.8 applied to each,
in `BenchmarkZoneFor` and `BenchmarkZoneTreeLookup`:

| Shape | Map + walk | Suffix trie |
| --- | --- | --- |
| Zone selection, name inside a served zone | **9 ns** | 19 ns |
| Zone selection, name in no served zone | 20 ns | **12 ns** |
| Inside a zone, name exists | **13 ns** | 27 ns |
| Inside a zone, empty non-terminal | **12 ns** | 14 ns |
| Inside a zone, name absent below a name present | **17 ns** | 26 ns |
| Inside a zone, name far deeper than the zone | 27 ns | **18 ns** |

The trie wins exactly where the descent can stop at a label it has never seen, and the map
wins wherever a name has to be found, which is every query that gets answered, and also the
random-subdomain flood, where the zone is found and the name below it is not. The two shapes
the trie wins are both bounded by the depth cut-off anyway. Neither allocates.

The walk up is free of allocation because `zone.Name` holds the wire form as a string and
`Parent` is a substring of the same backing array.

### 2.5 Name resolution inside the zone

The canonical name search of RFC 1034 §4.3.2, in order. QNAME is lowercased for lookup
(RFC 4343); the *original* casing is retained for the response.

1. **Find the name, or the deepest name above it.** A hit on QNAME answers directly; a miss
   walks up one label at a time until a name exists. That name is the closest encloser,
   which is what wildcards are synthesized from.
2. **Delegation check.** If the name found is a delegation, or lies below one (a node
   strictly below the apex carrying an NS RRset) stop and emit a **referral**: RCODE
   NOERROR, AA **unset**, NS RRset in AUTHORITY, in-zone glue addresses in ADDITIONAL
   (RFC 1034 §4.3.2 step 3b). Glue that is out of bailiwick is not sent. Each node records
   the delegation above it at build time, so this is a field read rather than a second walk.
3. **Exact match, type present** → answer with the RRset. AA set.
4. **Exact match, CNAME present** and QTYPE ≠ CNAME → append the CNAME, restart resolution
   at the target if the target is in a served zone, otherwise stop and let the resolver
   continue (RFC 1034 §4.3.2 step 3a). Chain length is capped (see §2.8).
5. **Exact match, type absent** → **NODATA**: NOERROR, empty ANSWER, SOA in AUTHORITY.
6. **Empty non-terminal**: a node that exists only because something below it exists →
   also NODATA, *not* NXDOMAIN (RFC 4592 §2.2.2, reinforced by RFC 8020). The snapshot must
   therefore distinguish "no node" from "node with zero RRsets", which is why a node is
   created for every name in between; this is the single most commonly botched case in
   hand-written authoritative servers.
7. **No match** → wildcard synthesis: look for `*` as a child of the closest encloser
   (RFC 4592). A wildcard only applies when no closer name exists and no delegation was
   crossed. The synthesized owner name is the QNAME, not the wildcard name.
8. **Still nothing** → **NXDOMAIN**, SOA in AUTHORITY.

Negative answers carry the SOA with TTL `min(SOA.TTL, SOA.MINIMUM)` (RFC 2308 §3, §5).

### 2.6 Additional section

For NS, MX and SRV in the answer, in-zone A/AAAA records of the target are appended
(RFC 1034 §4.3.2 step 6). Out-of-zone targets are not resolved; that is a resolver's job —
and neither are targets in another zone this server happens to hold: completing a name
across a zone boundary is the same job under a different name.

An address that lies **below a delegation** is only ever sent as that delegation's own glue.
Below any other delegation the server holds it without being authoritative for it, and attaching it
to an unrelated MX would put a record on the wire that is out of bailiwick (§2.5). The
distinction is one pointer comparison, because every node already records the delegation
above it.

Additional records are dropped first when the message does not fit (§2.7).

### 2.7 Assembly and truncation

- EDNS0 (RFC 6891): if the query has an OPT record, the response gets one. The advertised
  requestor buffer is clamped to a configured maximum (default 1232 bytes, the DNS Flag Day
  2020 recommendation, safely below common path MTU fragmentation).
- Extended DNS Errors (RFC 8914) are attached where they carry information the operator can
  act on. They are what lets the GUI and `weg query` explain *why* an answer looks the way
  it does instead of just printing SERVFAIL.
- If the message exceeds the budget: drop ADDITIONAL, then drop non-essential records, then
  set TC=1 and truncate (RFC 1035 §4.1.1). On TCP the budget is the largest message a
  two-octet length prefix can frame (§4.2.2), which nothing v0.1 builds comes near, so TC
  is never set in practice.
- Name compression is applied when it is needed to fit the budget, and skipped when the
  message already fits. Compressing costs a map allocation per response and saves nothing a
  datagram under the budget cares about; the amplification ceiling is the budget itself,
  which holds either way.

### 2.8 Limits

Every loop in the query path is bounded, because every bound is otherwise an amplification
or CPU-exhaustion vector:

| Limit | Default | Reason |
| --- | --- | --- |
| CNAME chain length | 8 | RFC 1034 warns about loops; no RFC number exists |
| Additional records | 16 | response size |
| Wildcard descent depth | 128 labels | RFC 1035 §2.3.4 name limit |
| Response budget UDP | min(advertised, 1232) | fragmentation |
| Name walk, zone selection | deepest apex held | see below |
| Name walk, inside a zone | deepest name in that zone | see below |

The last two are the reason the lookups in §2.4 stay flat as a query gets longer. A QNAME is
cut back to the deepest name the structure could possibly hold before the walk starts, so a
query of 100 labels buys 100 hash lookups for the price of one packet in neither of them.
The bound comes from the data rather than from a constant, which means it tightens by itself
for the shallow zones almost everyone runs.

### 2.9 Observability, off the hot path

There is one hook, `dns.Config.Observe`, called once per query with a `dns.Event` holding
what the exchange looked like: the question as it was asked, the response code and size,
the transport, the client, and how long it took. Everything that watches the server is fed
from that one structure, because the metrics and the live query stream want the same facts
and two hooks would be two things to keep in step. Composing them is the wiring's job; this
package answers queries and does not know what anybody wants to count.

It is called on the goroutine that read the query, after the response has been written, so
an observer that blocks stops a reader. Nothing in the tree does: a counter is O(1) and the
ring buffer drops rather than waits. Measured cost per query: 63 ns with something watching,
2 ns without, and no allocations either way, against 1874 ns for the whole exchange. When
nobody is watching, the clock is not even read.

After the response is written:

- Prometheus counters and a latency histogram are updated. Labels are bounded: QTYPE and
  RCODE only, never QNAME, which would be an unbounded-cardinality footgun.
- The exchange is offered to every watcher of the live query stream, filtered before it is
  buffered so that a narrow filter stays complete (D9). **If a watcher's buffer is full, its
  oldest event is dropped.** The observability path must never apply back-pressure to the
  query path. This is a deliberate trade: the showcase feature loses events under extreme
  load rather than slowing DNS down, and it drops the oldest, because a live view that
  falls behind and stays behind is not one. Cost per query: 2 ns with nobody watching, and
  10 to 43 ns per watcher depending on how much of the filter a query gets through. With
  every processor answering at once, where the counters a watcher keeps become a contended
  cache line: 47 ns for one watcher and 200 ns for sixteen, which is what bounds the number
  of them.

Target for v0.1: p99 under 1 ms for an in-memory hit, zero allocations in the steady-state
path apart from the response buffer. Benchmarked with `go test -bench` plus `dnsperf`; the
number is a gate, not an aspiration.

---

## 3. Write path: API request to snapshot swap

### 3.1 Command, not diff

The API accepts an **intent** ("add record X to zone Y", "restore zone Y to serial N") and
turns it into a `Command`. It does not accept a pre-computed diff. The server derives the
diff, because only the server knows the current state, the reverse-automation rules and the
validation constraints.

This matters beyond tidiness: a `Command` is the unit Raft will replicate later. Building
the write path around commands now means the cluster phase adds a transport, not a rewrite.
See `docs/decisions/d19-journal-as-command-log.md`, amended on the unit of replication by
`docs/decisions/d24-what-the-cluster-replicates.md`.

{{< diagram "write-path" "A write travels from the HTTP request through the api handler, apply, and one store transaction, after which the snapshot is rebuilt and published." >}}

### 3.2 Serialization of writes

Writes are serialized **per zone** by a keyed mutex. Two zones commit concurrently; two
writes to the same zone do not. Rationale: validation reads the current zone state and must
not race with another write against it, and SOA serial allocation must be strictly ordered.
Per-zone rather than global keeps a bulk import into one zone from stalling every other.

Optimistic concurrency is exposed to clients through `ExpectedSerial`. If it is set and does
not match, the commit fails with `ErrSerialMismatch` and the GUI can show "someone else
changed this zone" instead of silently clobbering.

### 3.3 Apply, inside one transaction

```go
store.Update(ctx, func(tx store.Tx) error {
    // 1. read current zone + affected records
    // 2. validate ops against current state
    // 3. expand: reverse automation adds derived ops
    // 4. re-validate expanded set
    // 5. allocate new serial
    // 6. append commit + events to the journal
    // 7. apply materialized changes to the records table
    return nil
})
```

**1–2 Validation** rejects the whole command if any op is invalid. Nothing partially
applies. The rules that matter (see `docs/data-model.md` §5 for the full list): no CNAME
alongside another type at the same owner (RFC 2181 §10.1), no CNAME at the apex, uniform TTL
within an RRset (RFC 2181 §5.2), no duplicate RR within an RRset (RFC 2181 §5), label and
name length limits, apex NS and SOA must survive the command.

**3 Reverse automation** is a pure function from `(ops, current state, policy)` to
`additional ops`. Adding `www.example.com. A 192.0.2.10` looks up the reverse zone covering
`192.0.2.10` (including RFC 2317 classless child zones and `ip6.arpa` nibble zones
(RFC 3596 §2.5)) and emits a PTR op against it. Deleting the A emits the matching PTR
delete. The generated PTR is a **real, materialized record** carrying provenance back to its
source record, not a virtual one; see `docs/decisions/d21-materialized-managed-records.md`.

Conflicts (an existing PTR from a different source, or a manually edited one) do not
silently overwrite. They produce a conflict that the API returns and both clients
show, worked out from the records each time rather than stored, so it stops being
reported when it stops being true (`docs/decisions/d33-a-conflict-is-derived.md`).
The default is first-wins, configurable server-wide and per zone.

**5 Serial allocation.** `serial_to = serial_from + 1` using RFC 1982 arithmetic. One commit
equals exactly one serial step, which is what makes IXFR a direct replay of the journal
(RFC 1995) rather than a reconstruction. See `docs/decisions/d02-soa-serials.md`.

**6–7 Journal then state.** The journal rows and the record rows are written in the same
transaction. There is no window where a record exists without its event. This is the
mechanical enforcement of invariant 4.

If anything fails, the transaction rolls back and no snapshot rebuild happens. The system
is exactly where it was.

### 3.4 Snapshot rebuild and swap

After the transaction commits:

```go
old := s.current.Load()
zoneTree := buildZone(ctx, store, zoneID)      // read back from store
next := old.WithZone(zoneID, zoneTree)          // structural sharing, other zones reused
s.current.Store(next)                           // one atomic write
```

- Only the changed zone is rebuilt. Every other zone's tree is carried over by pointer.
- The new zone tree is fully built *before* the swap. Queries see either the complete old
  state or the complete new state, never a half-built tree.
- The rebuild reads from the store rather than replaying the ops in memory. Slower, but it
  makes the snapshot provably a function of the database and eliminates a whole class of
  drift bugs where in-memory state and persisted state disagree. Correctness first;
  §3.5 covers the escape hatch if it turns out too slow.

**Announced shortcut for v0.1:** the whole zone is rebuilt on every commit. At ~100k records
per zone that is tens of milliseconds and nobody notices. It becomes a problem for a
million-record zone under a steady edit rate. The fix (copy-on-write of only the trie path
touched by the commit) is a contained change inside `internal/dns`, gated on a benchmark
rather than done speculatively. Tracked as a TODO in the builder.

### 3.5 Failure after commit

If the rebuild fails or the process dies between commit and swap, the database is correct
and the snapshot is stale or absent. Recovery is the same code path as startup: rebuild
every zone from the store. There is no repair logic, no reconciliation, no fsck. That is the
entire payoff of "the store is the source of truth".

### 3.6 Notification

After a successful swap, subscribers are notified: the GUI over SSE for live zone updates,
metrics, and later NOTIFY to secondaries and the Raft apply loop. All of this is after the
swap, so a slow subscriber cannot delay visibility of the change.

---

## 4. Startup and shutdown

**Startup**

1. Load bootstrap config: flags → environment → config file. Only bootstrap settings live
   in the file (listen addresses, store DSN, TLS material). Everything else lives in the
   database and is therefore reachable through the API; see
   `docs/decisions/d11-config-holds-bootstrap-only.md`.
2. Open the store, run migrations, verify the schema version.
3. Build the initial snapshot from the store, zone by zone, in parallel.
4. Bind sockets. `CAP_NET_BIND_SERVICE` handles port 53; the process never runs as root.
5. Start the HTTP API and, on the first run, print the bootstrap admin token to stdout once.
6. Only then report ready on `/healthz`. Serving before the snapshot is complete would mean
   answering NXDOMAIN for zones it actually holds: worse than not answering at all.

**Shutdown**: stop accepting new queries, drain in-flight ones with a deadline, close the
store last. In-flight write transactions either commit or roll back; there is no third state.

---

## 5. Package boundaries

| Package | Owns | May import |
| --- | --- | --- |
| `internal/dns` | query path, trie, snapshots | `zone` (model only) |
| `internal/zone` | zone/record model, validation, reverse automation |: |
| `internal/config` | bootstrap settings: the file, the environment, the flags |, |
| `internal/metrics` | Prometheus collectors and the exposition format | `dns` (events), `zone`, `buildinfo` |
| `internal/stream` | the live query stream: filters, buffers, sampling | `dns` (events), `zone` |
| `internal/store` | persistence, migrations, SQL | `zone`, `journal` (types) |
| `internal/journal` | events, serials, applier, rollback | `zone`, `store` |
| `internal/api` | HTTP, OpenAPI, auth, embedded GUI | `journal`, `store` (read), `dns` (snapshot read) |
| `internal/cluster` | Raft, membership | `journal` |
| `internal/tui` | Bubble Tea views | generated API client only |
| `internal/cli` | Cobra commands, output formatting | generated API client, `api` (for the embedded server) |
| `cmd/weg` | process entry point, signal handling | `cli` only |

`internal/zone` has no dependencies on storage or transport. It is pure model and pure
functions, which is what makes the validation and reverse-automation logic exhaustively
table-testable without a database.

The dependency direction is strictly one way: `cmd` → `cli` → `api` → `journal` → `store` →
`zone`. `internal/dns` depends only on `zone`. Nothing imports `internal/api` except the
wiring.

These rules are not a convention to remember. `depguard` in `.golangci.yml` encodes them, so
crossing a boundary fails the build rather than the review.

---

## 6. What this design pre-pays for

| Deferred feature | What already accommodates it |
| --- | --- |
| IXFR (RFC 1995) | journal commits are serial-framed delete/add sets: a direct replay |
| AXFR | zone snapshot iteration in canonical order via `sort_key` |
| Raft cluster | `Command` is the replicated unit; the applier is already an FSM in shape |
| PostgreSQL | `Store` interface, no SQL outside `internal/store` |
| DNSSEC | canonical ordering exists; `sort_key` gives NSEC chains their order for free |
| Views / split-horizon | the snapshot is already a value: multiple named snapshots is an extension, not a redesign |

None of these are built. The seams are placed so that building them does not require moving
anything else.
