+++
title = "A witness"
description = "The third vote for two servers: a small program that keeps the cluster's log, answers nothing, and hands leadership to a server whenever it wins an election."
weight = 102
group = "Running it"
+++

Two DNS servers make no honest [cluster](/docs/cluster/). A majority of two is two, so
either one going down stops every change. A third server fixes that and costs a third copy of
everything, a third machine answering queries, and a third place for TSIG keys to live.

A witness is the cheaper third vote. It is
[wegwitness](https://github.com/wegweiserzone/wegwitness), a program of its own: it votes,
it keeps the log, and it does nothing else. It holds no zones, answers no queries and has no
API. Two servers answer DNS; one small machine holds the log with them.

It needs Wegweiser 0.5.0 or later on the servers.

## What it does, and what it never does

**It counts towards the majority.** With two servers and a witness, either server can go
down and the other one, with the witness, goes on taking changes.

**It never leads.** A leader plans every write against the data it holds, and a witness holds
none. When it wins an election it hands leadership to a server straight away, and the
cluster brings that server up to date from the witness's log first. That is how a witness
repairs the case it is there for: a server that was down while a change was made, and whose
partner went down before it caught up, comes back, is brought current by the witness and then
leads. A write in that moment is refused with a 503 that says no member able to take one is
leading yet.

**Witnesses stay fewer than half of the voters.** One beside two servers, or two beside three.
A majority made of witnesses could commit a change that no server holding data has, so the
cluster refuses to add a witness, or remove a server, when the result would break that.

**It keeps far more log than a server does**, a hundred times Raft's default. A server is
brought up to date from the log rather than from a snapshot a witness wrote, because that
snapshot is empty and a server refuses to restore it.

**It is exactly as sensitive as a server.** The log carries TSIG secrets and the DNS cookie
secret in the clear, and the witness keeps all of it because keeping it is the job. Small is
not the same as low-trust: put it somewhere you would put a nameserver.

## Installing it

Every [release](https://github.com/wegweiserzone/wegwitness/releases) carries a static
binary for linux/amd64 and linux/arm64, with the example configuration and a sandboxed
systemd unit beside it. There is an image too:

```console
$ podman run -d --name wegwitness -p 8054:8054 \
    -v ./config.yaml:/etc/wegwitness/config.yaml:ro -v wegwitness:/var/lib/wegwitness \
    ghcr.io/wegweiserzone/wegwitness serve --join 192.0.2.1:8054
```

## Configuration

The same four things a server's cluster section holds, a directory for the log, and a log
level. `wegwitness` reads `/etc/wegwitness/config.yaml` unless `--config` names another file.

```yaml
cluster:
  # Left out, one is minted on the first start and kept beside the log.
  # id: "witness-office"
  listen: ":8054"
  advertise: "192.0.2.9:8054"
  secret: "…"
dir: "/var/lib/wegwitness"
log:
  level: "info"
```

**`id`** has to begin with `witness-`. That prefix is how the cluster tells a witness from a
member that holds data, and a server refuses to take such a name for itself
([D48](https://github.com/wegweiserzone/wegweiser/blob/main/docs/decisions/d48-a-witness-is-known-by-its-identifier.md)).
**`advertise`** and **`secret`** are required and mean what they mean on a server: where the
members reach the witness, and the cluster's shared secret.

## Joining

From the first start, with the cluster address of any member:

```console
$ wegwitness serve --join 127.0.0.1:8054
level=INFO msg="asking to join the cluster" member=witness-779d7443496e57f1 via=127.0.0.1:8054
level=INFO msg="taking part in the cluster" member=witness-779d7443496e57f1 advertise=127.0.0.1:8094 dir=wegwitness
```

It joins the way a voter does: without a vote first, and with one once the log has reached
it. The flag does nothing on later starts. The cluster lists it like any member, with its role
and how far it has got:

```console
$ weg cluster status
cluster  takes writes, and can lose one voter: 3 of 3 voters answered, 2 needed
asked    ns1 at 127.0.0.1:8054, applied 7 of 7, current

MEMBER                    ADDRESS         ROLE     LOG
ns1 (this one, leader)    127.0.0.1:8054  voter    current
ns2                       127.0.0.1:8064  voter    current
witness-779d7443496e57f1  127.0.0.1:8094  witness  current
```

The witness is one of the three voters the first line counts, which is the point of it: two
servers and a witness can lose any one of the three and go on taking writes.

A second witness beside two servers would be half of the voters, and is turned away:

```console
$ wegwitness serve --join 127.0.0.1:8054
wegwitness: witness: 127.0.0.1:8054 would not add this witness: cluster: witnesses have to stay fewer than half of the voters
```

## Is it healthy

A witness has no API to ask, so `wegwitness health` asks it on its own cluster port, with the
secret from the same configuration file:

```console
$ wegwitness health
witness-779d7443496e57f1 takes part: applied 7 of 7, ns1 leads
```

It exits 0 only when the witness is a member and has not been taken out. A witness still
waiting to be added holds no vote, and is not healthy either. The image uses this as its
health check, and a monitoring system can call it the same way.

## Taking it out

From any member, by its identifier:

```console
$ weg cluster remove witness-779d7443496e57f1 --yes
```

There is no `wegwitness leave`: a witness has no API for the request to arrive at, and
removing it from a member is the same act. Before it goes, make sure the servers left are a
majority on their own, or add another vote first: two servers without their witness are back
to the arithmetic this page started with.
