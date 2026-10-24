+++
title = "Monitoring"
description = "Whether it is fit to answer, what it has been answering, and the handful of numbers worth an alert."
weight = 120
group = "Running it"
version = "0.7.0"
+++

## Is it alive

```console
$ weg health
serving — 2 zones, 6 records, v0.5.0
```

`/healthz` is the same answer over HTTP and is **the one endpoint that needs no credential**,
because a load balancer and a container runtime have nowhere to put one.

It reports `serving` only once a snapshot has been published, not merely once the process is
up. A container that called itself healthy while answering REFUSED for its own zones would
be worse than one that reported nothing, which is why the image's health check is this
command and not a TCP probe.

On a member of a [cluster](/docs/cluster/) it carries `current` as well:

```json
{"current":true,"records":2,"status":"serving","version":"v0.5.0","zones":1}
```

`current` is false once the member has left its cluster, by being taken out or by stopping
over a change it could not apply, and `weg health` says so in a second line. The status stays
`serving`, because the member still answers queries with what it held. Whether that is reason
to take it out of rotation is yours to decide, so it is a field beside the status rather than
a different status code.

## What it has been doing

```console
$ weg status
serving      2 zones, 6 records
cluster      takes writes, and can lose one voter: 3 of 3 voters answered, 2 needed
secondaries  all 2 copies in step

no queries answered yet
```

It opens with how the server stands, a line each: what it serves, whether its cluster takes
writes and how many voters it can lose, and how many copies on secondaries are known to be in
step. A server with no cluster, or nobody on its notify list, leaves that line out. Below
them come the queries answered, by response code, by question type and by latency.
`--output json` carries the two lines as `cluster` and `secondaries`, beside every field it
had before.

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
weg_dns_query_duration_seconds{transport}
weg_dns_response_size_bytes{transport}
weg_dns_queries_dropped_total{transport}
weg_dns_responses_truncated_total{transport}
weg_dns_notifications_total{outcome}
weg_dns_under_load
weg_dns_cookie_refusals_total{client}
weg_secondary_probes_total{outcome}
weg_secondary_serial_lag{target}
weg_secondary_zones_behind{target}
weg_secondary_zones_unanswered{target}
weg_snapshot_zones
weg_snapshot_records
weg_snapshot_published_timestamp_seconds
weg_cluster_behind
weg_build_info
```

### The six worth an alert

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

**`weg_cluster_behind` is 1.** The member has left its cluster and is answering from data that
no longer changes. It does not come back by itself; [a cluster](/docs/cluster/) says how to
repair it. Each member reports on itself, so scrape every member.

`weg_dns_responses_truncated_total` is worth a graph rather than an alert: some truncation is
normal over UDP, a lot of it means clients are being pushed to TCP more than they should be.
So is `weg_dns_under_load`, beside `weg_dns_cookie_refusals_total`: they say when the server
could not keep up and whom that turned away, and [under load](/docs/under-load/) says what
the two labels of the counter mean.

## What is not measured

The ceiling. The query path costs about 0.45 µs of this server's own work per query against
roughly 9 µs of kernel time, so what limits throughput is the network stack, and that has
never been benchmarked on a real interface. [The kernel is the
bottleneck](/docs/query-path-measurement/) is the honest write-up, including what would
change the conclusion.
