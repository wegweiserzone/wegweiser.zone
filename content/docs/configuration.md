+++
title = "Configuration"
description = "Everything the file holds, why it holds so little, and the one command that says what a server would actually start with."
weight = 80
group = "Running it"
+++

## The file holds bootstrap settings and nothing else

Zones, records, tokens, transfer keys and the server-wide defaults live in the database and
are reachable through the API. Only the things needed to *reach* that database are in a file:
where to listen, where the database is, how loudly to log.

That line is deliberate. A setting that lives only in a file is a feature that exists only
for whoever can log in to the machine — not for the interface, not for the command line, not
for a script with a token. Everything that ought to be changeable by an operator is
therefore not here.

## What is in it

The packaging puts this at `/etc/wegweiser/config.yaml`; `--config` or `$WEG_CONFIG` moves
it. Everything is optional and what is left out takes the built-in default.

```yaml
dns:
  listen: ":53"
  udpResponseSize: 1232
  maxTCPClients: 0
  maxTransfers: 0

api:
  listen: "127.0.0.1:8053"
  ui: true

database:
  path: "/var/lib/wegweiser/wegweiser.db"

log:
  level: "info"
```

**`dns.listen`** — where to answer queries, as `host:port`. Every address on port 53 by
default, which needs `CAP_NET_BIND_SERVICE` and not root.

**`dns.udpResponseSize`** — the largest UDP response to send, whatever a client says it can
receive. A requestor may claim 4096 octets; whether the path between you carries them is not
something it can know, and a fragmented response is one that often does not arrive. 1232 is
the DNS Flag Day advice.

**`dns.maxTCPClients`** — how many TCP connections to answer at once. Each costs a goroutine
and buffers that grow to the largest message its client has sent, so an unbounded accept
loop is a cheap way to take this server's memory. `0` takes the built-in 150; a negative
number removes the bound, which is a decision to make on purpose.

**`dns.maxTransfers`** — how many zone transfers may run at once, out of those connections. A
transfer is the size of a zone rather than the size of a question, so a few slow clients
would otherwise hold every slot. `0` takes the built-in 8. A transfer arriving when they are
all in use is told to come back, which a secondary does on its own timer.

**`api.listen`** — where the API and the web interface are. Loopback by default; see
[access](/docs/access/) for why, and what to do instead.

**`api.ui`** — whether to serve the browser half at all. It is inside the binary either way,
so switching it off saves no memory worth counting; what it does is remove the routes.

**`database.path`** — where the SQLite file lives. The directory has to exist: a database
appearing in a path nobody meant is worse than a refusal that names it.

**`log.level`** — `debug`, `info`, `warn` or `error`. Faults and lifecycle events go to
standard error; what a command produced goes to standard output, so the two can be
redirected apart.

## Four sources, one order

A command-line flag beats an environment variable, which beats the file, which beats the
default.

The variables are `WEG_CONFIG`, `WEG_LISTEN`, `WEG_API_LISTEN`, `WEG_API_UI`,
`WEG_DATABASE`, `WEG_UDP_RESPONSE_SIZE`, `WEG_MAX_TCP_CLIENTS`, `WEG_MAX_TRANSFERS` and
`WEG_LOG_LEVEL`.

## What is actually in force

```console
$ weg config show
no configuration file; /etc/wegweiser/config.yaml would be read if it existed

SETTING              VALUE           FROM
dns.listen           :53             default
dns.udpResponseSize  1232            default
dns.maxTCPClients    0               default
dns.maxTransfers     16              environment
api.listen           127.0.0.1:8053  default
api.ui               true            default
database.path        wegweiser.db    default
log.level            info            default
```

The `FROM` column is the reason this command exists. With four sources, "why is it listening
there" is a question that takes ten minutes to answer by reading files and one command to
answer here. It works without a running server, because it resolves the same configuration
that `weg serve` would.

## The settings that are not here

```console
$ weg settings show
reverse conflict policy  first-wins
zone transfer to         nobody
a change is announced to nobody
```

Those live in the database, reach every client, and take effect on the next write without a
restart. [Reverse zones](/docs/reverse-zones/) covers the first;
[a second nameserver](/docs/secondaries/) covers the other two.
