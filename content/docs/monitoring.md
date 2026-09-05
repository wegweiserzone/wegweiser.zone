+++
title = "Monitoring"
description = "Whether it is fit to answer, what it has been answering, and the handful of numbers worth an alert."
weight = 120
group = "Running it"
+++

## Is it alive

```console
$ weg health
serving — 2 zones, 19 records, 0.3.0
```

`/healthz` is the same answer over HTTP and is **the one endpoint that needs no credential**,
because a load balancer and a container runtime have nowhere to put one.

It reports `serving` only once a snapshot has been published, not merely once the process is
up. A container that called itself healthy while answering REFUSED for its own zones would
be worse than one that reported nothing, which is why the image's health check is this
command and not a TCP probe.

## What it has been doing

```console
$ weg status
no queries answered yet: the snapshot holds 2 zones, 19 records
```

For the live view, `weg query tail` follows queries as they are answered, filtered
server-side:

```console
$ weg query tail --name example.com --rcode NXDOMAIN
```

The filter is applied before anything is buffered, so watching one zone stays complete
however busy the rest of the server is. A watcher that falls behind loses its oldest
exchanges, never its newest, and the stream says when it is sampling rather than quietly
leaving things out. This is a live view, and it is never allowed to slow a query down.

## Metrics

`/metrics` in the Prometheus text format, authenticated like everything else. What a server
is asked, how often and by how many zones is operational detail, and a scraper can carry a
bearer token.

```
weg_dns_queries_total{type,rcode,transport}
weg_dns_query_duration_seconds
weg_dns_response_size_bytes
weg_dns_queries_dropped_total{transport}
weg_dns_responses_truncated_total{transport}
weg_dns_notifications_total{outcome}
weg_secondary_probes_total{outcome}
weg_secondary_serial_lag{target}
weg_secondary_zones_behind{target}
weg_secondary_zones_unanswered{target}
weg_snapshot_zones
weg_snapshot_records
weg_snapshot_published_timestamp_seconds
weg_build_info
```

### The five worth an alert

**`weg_snapshot_published_timestamp_seconds` stops moving** while writes are happening. The
snapshot is what queries are answered from; if it stops being rebuilt, the server is
answering from a past that is getting older.

**`weg_dns_queries_dropped_total` rises.** A query that got no response at all is a different
failure from one answered SERVFAIL, and it is the one a client experiences as a timeout.

**`weg_dns_notifications_total{outcome="abandoned"}` is not zero.** That counts secondaries
told six times that never answered. Each one is waiting out its refresh timer on every
change.

**`weg_secondary_zones_behind` stays above zero, or `weg_secondary_zones_unanswered` is not
zero.** Being told is not the same as having fetched, so the secondaries are asked what serial
they hold. A zone that stays behind for longer than a transfer takes is a secondary that
answers notifications and does not transfer, which nothing else on this list would show. The
second gauge is the quiet one: a secondary that has gone silent reports nothing behind,
because nothing about it is known. [Where each secondary
stands](/docs/secondaries/#where-each-secondary-stands) has what the states mean, and why a
`behind` a few seconds after an edit is expected rather than a fault.

**`weg_snapshot_zones` falls.** Zones do not usually leave.

`weg_dns_responses_truncated_total` is worth a graph rather than an alert: some truncation is
normal over UDP, a lot of it means clients are being pushed to TCP more than they should be.

## What is not measured

The ceiling. The query path costs about 0.45 µs of this server's own work per query against
roughly 9 µs of kernel time, so what limits throughput is the network stack, and that has
never been benchmarked on a real interface. [The kernel is the
bottleneck](/docs/query-path-measurement/) is the honest write-up, including what would
change the conclusion.
