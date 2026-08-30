+++
title = "The kernel is the bottleneck, and the ceiling is unmeasured"
linkTitle = "Query path"
description = "The server's own work is no longer what limits it, and the thing that does has never been measured. Written down rather than left as a comfortable assumption."
weight = 160
group = "How it works"
+++

Measuring the query path (2026-08-18, on `0586125`) turned up something worth
writing down before it is forgotten: **the server's own work is no longer what
limits it, and what does has never been measured.**

## What was measured

AMD Ryzen 7 7700 (8 cores / 16 threads), Go 1.26, Linux, over loopback, against
a zone of 200 000 records.

| | |
| --- | --- |
| `Snapshot.Resolve` — the RFC 1034 §4.3.2 search | **35 ns**, 0 allocations |
| `Responder.Respond` — query bytes in, response bytes out | **445 ns**, 4 allocations |
| Single-worker round trip over UDP | **15.2 µs** |
| Throughput, 8 workers, zero packet loss | **339 272 qps** |
| Server CPU during that run | **315 %** — 3.15 of the 12 cores it had |
| CPU per query, in the server process | **≈ 9.3 µs** |

So of the ~9.3 µs of CPU one query costs, **about 0.45 µs is this project's
code and the remaining ~95 % is the kernel** — `recvfrom` and `sendto`, twice
over on loopback. That is the shape you would expect, and it is exactly why not
handing each datagram to a goroutine was the right call (measured against
`miekg/dns.Server`: 1878 ns and 4 allocations against 4882 ns and 21).

## What was *not* measured, and this is the point

**The ceiling.** At 339 272 qps the server was using a quarter of the machine —
the load generator ran out of steam first, not the server. Scaling that
linearly suggests roughly 1.3 M qps on 12 cores, but that is an extrapolation
from a quarter-loaded measurement and should not be quoted as a number.

Two reasons it may be wrong in either direction:

- The load generator is synchronous — one outstanding query per worker — so it
  measures round-trip latency, not the server's capacity. A generator with many
  queries in flight per socket, or `dnsperf`, would push far harder.
- Everything here is loopback, which has no NIC driver, no interrupts and no
  packet-per-second ceiling of its own. A real interface changes the balance,
  quite possibly for the worse.

**So the first task is not an optimisation. It is a proper measurement.**

## What could be done, if it turns out to matter

In increasing order of cost and regret:

1. **`recvmmsg` / `sendmmsg`** — read and write several datagrams per syscall.
   `golang.org/x/net/ipv4` and `ipv6` expose it as `PacketConn.ReadBatch` /
   `WriteBatch`, and `golang.org/x/net` is already an indirect dependency via
   `miekg/dns`. It fits the current design without changing its shape: the
   reader goroutine keeps owning its socket and its buffers, it just handles a
   batch per wakeup instead of one datagram. This is the obvious first move and
   the only one I would consider before there is evidence.
2. **Socket tuning** — larger `SO_RCVBUF`/`SO_SNDBUF`, possibly `SO_BUSY_POLL`.
   Cheap, but it is an operator's knob and not something to bake in.
3. **`AF_XDP`** — bypass the kernel network stack entirely. Enormous complexity,
   Linux-only in a way the rest of the project is not, and wildly out of
   proportion to anything in the v0.1 scope fence. Named here so that it is on
   the list as the thing decided *against*, not as an option waiting.

## When this would be worth doing

Probably never, for the audience in the product thesis. 108 000 qps per core is
already past what a self-hosted authoritative server for a handful of zones will
ever see, and the four differentiators are all about usability and correctness
rather than throughput. Reference points for scale: a busy ccTLD sits in the low
hundreds of thousands of queries per second across a whole anycast fleet.

Concrete triggers that would change that:

- A benchmark on a real network interface well under 100 k qps per core, which
  would mean the loopback numbers were flattering.
- Somebody actually wanting to run this in front of a large zone at
  authoritative-DNS-provider scale.
- `recvmmsg` turning out to be a small enough patch that it is worth doing on
  principle rather than on evidence — which is possible, and is why it is first
  on the list.

Until one of those happens, **the right answer is to leave it alone.** This
issue exists so the decision is a decision rather than an oversight.

## Reproducing the measurement

```sh
# The in-process cost
go test ./internal/dns/ -run XXX -bench 'BenchmarkResolve|BenchmarkRespond' -benchmem

# Against the wire library's own server, over a real socket
go test ./internal/dns/ -run XXX -bench BenchmarkServerUDP -benchmem

# End to end: seed a large zone, start the server, and drive it with a
# generator in a separate process while watching utime+stime in /proc.
```

The load generator used was a throwaway; anyone picking this up should reach
for `dnsperf` or write one that keeps many queries in flight, since that is the
gap that made the ceiling unmeasurable in the first place.

