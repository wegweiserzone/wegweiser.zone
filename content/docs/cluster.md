+++
title = "A cluster"
description = "A few servers holding the same zones, kept in step through one log. How many to run, how one starts and the others join, what happens when one goes away, and how a member leaves."
weight = 101
group = "Running it"
+++

A cluster is a few Wegweiser servers that hold the same zones and keep them in step through
one replicated log (Raft). Every one of them answers queries from its own copy. A change made
on any of them goes through the log, and from there it reaches all of them. There is no
external database and no primary to configure by hand: the servers elect a leader among
themselves, and when it goes away they elect another.

It is the other answer to "more than one server" besides [a second
nameserver](/docs/secondaries/). Zone transfer copies zones to servers that may not even be
Wegweiser; a cluster replicates the whole database between servers that all are. The two
combine: a cluster can transfer to secondaries like a single server does.

## How many

Raft needs a majority of its voting members to agree on every change. That arithmetic decides
the shape:

| Servers | Shape |
| --- | --- |
| 1 | A single server. A supported deployment, not a degraded cluster. |
| 2 | No honest cluster: a majority of two is two, so either one going down stops every change. Add a [witness](/docs/witness/) as the third vote, or run the second server as a [secondary](/docs/secondaries/). |
| 3 to 7 | All of them vote. This is the range Raft is for. Three survive one failure, five survive two. |
| more | Three or five vote, and the rest join as non-voters: they receive the whole log and answer queries like any member, and nobody waits for them. |
| spread across sites, or mixed with other software | A cluster as a hidden primary, and zone transfer outward from it. |

Even numbers of voters buy nothing: four tolerate one failure, exactly as three do, and need
one more acknowledgement for every write. The reasoning is in
[D25](https://github.com/wegweiserzone/wegweiser/blob/main/docs/decisions/d25-cluster-shape.md).

## What it replicates

Zones, records, history, tokens, TSIG keys and the server-wide settings, including the secret
DNS cookies are computed under. A token minted on one member works on every member.

Three things stay on the server they belong to: browser sessions, so signing in to the web
interface is per server and a failover asks for the token again; when a token was last used;
and how far the server has got through the log. Sessions stay local on purpose: replicated,
a login would need the cluster to agree on it, and would fail exactly when the cluster has
lost its majority.

## Configuration

Every member needs a `cluster` section in its [configuration file](/docs/configuration/).
Without one a server is a single server and behaves exactly as it always has.

```yaml
cluster:
  id: "ns1"
  listen: ":8054"
  advertise: "192.0.2.1:8054"
  secret: "…"
```

**`id`** is what the member is known by, for as long as it is one. Left out, one is minted on
the first start and kept in the database. It never changes afterwards, and a file that names a
different one is refused: handing a fresh machine an old member's identifier would graft one
member's history onto another's.

**`listen`** is where the other members connect, `:8054` by default. **`advertise`** is the
address they reach this one at, and is required, because the address listened on may be every
interface, which is not one anybody can dial.

**`secret`** is the cluster's shared secret, base64, at least 256 bits, the same on every
member. `openssl rand -base64 32` makes one. Members talk over TLS 1.3 and prove the secret
inside the session, so holding it is what makes a machine a member, and whoever holds it can
speak as any of them. The file wants to be readable by the server alone.

The section is read from the file only, never from the environment. `weg config show` lists
it, and says that a secret is set and how long it is rather than what it is. Raft keeps its
log in a directory beside the database, named after it: `wegweiser.raft` for
`wegweiser.db`.

The file does not say who the other members are. That list lives in the log, and is changed
by the commands below.

## Starting one

The first server starts the cluster, with everything it already holds:

```console
$ weg cluster init
started a cluster; this server is its first member, ns1 at 127.0.0.1:8054
another server joins it from its first start: weg serve --join 127.0.0.1:8054
```

It needs the `admin` scope and is done once. A server that has run on its own for a year
becomes the first member of a cluster with every zone, record, token and key it has.

Every other server joins from its first start, with an empty database:

```console
$ weg serve --join 127.0.0.1:8054
weg is answering on 127.0.0.1:5302 — 1 zone, 3 records from wegweiser.db
the API and the web interface are on http://127.0.0.1:8063
this node is a cluster member, as ns2 on 127.0.0.1:8064; Raft keeps its log in wegweiser.raft
```

The address is any member's cluster port. A member that does not lead names the one that
does, and the new server asks again there. It starts answering queries only once the
cluster's data has reached it, so a new member never answers from an empty database, and it
mints no administrator token of its own: the cluster's tokens arrive with the data.

A server whose database already holds anything is refused, and told what it holds. Joining
replaces a database rather than merging two, and the cluster's is the one that wins. Once a
server is a member the flag is ignored, so a unit file can keep it.

`--role nonvoter` joins without a vote. A new voter is added without one first and given
its vote once the log has reached it, so a server the others cannot reach never counts
towards the majority.

## What it looks like

```console
$ weg cluster status
cluster  takes writes, and can lose one voter: 3 of 3 voters answered, 2 needed
asked    ns1 at 127.0.0.1:8054, applied 59 of 59, current

MEMBER                  ADDRESS         ROLE   LOG
ns1 (this one, leader)  127.0.0.1:8054  voter  current
ns2                     127.0.0.1:8064  voter  current
ns3                     127.0.0.1:8074  voter  current
```

The first line is the answer: whether the cluster takes writes, and how many more voters it
can lose before it stops. The server asked lists the members as its copy of the log has
them, and asks every other member how far it has got. One that has not answered within two
seconds is listed as not reached, with the reason underneath, and the first line counts it:

```console
$ weg cluster status
cluster  takes writes, and the next voter lost stops them: 2 of 3 voters answered, 2 needed
asked    ns1 at 127.0.0.1:8054, applied 59 of 59, current

MEMBER                  ADDRESS         ROLE   LOG
ns1 (this one, leader)  127.0.0.1:8054  voter  current
ns2                     127.0.0.1:8064  voter  current
ns3                     127.0.0.1:8074  voter  not reached

ns3: not reached: connection refused
```

The reason is what the network said, in a few words: refused, or no answer within two
seconds. From the network a machine that is off and one that cannot be reached look the same,
so it says no more than that. A member a few entries behind for a moment is keeping up; one
that stays behind is worth looking at. `--watch` asks again every two seconds, the Cluster
page in the web interface shows the same and asks every five, and `-o json` gives it to a
script, with the counts as `quorum`.

## Writing to it

A write can be sent to any member. One that does not lead hands it to the leader over the
cluster port and answers with what the leader answered, so a client never needs to know which
member leads, and a load balancer can point at all of them:

```console
$ WEG_SERVER=http://127.0.0.1:8073 weg record add example.com mail A 192.0.2.25
added mail.example.com. 3600 IN A 192.0.2.25
```

Reads are answered by the member asked, from its own copy, and can trail the leader by a
moment.

## When a member goes away

The others carry on as long as a majority of the voters is still there: two of three, three
of five. Nothing has to be done, and the member catches up from the log when it comes back.

Below a majority the cluster takes no writes, and says so with a 503, until enough members
are back for one of them to be elected. **Every member goes on answering queries** with
the data it holds. A DNS server that stops answering because its control plane lost a vote
would be the wrong failure: one that stops accepting edits for a while is inconvenient, one
that stops resolving names is an outage.

A member that is merely off stays a member and keeps being counted. Nothing removes members
for being quiet, because nothing on the network can tell a machine that is off from one that
is cut off, and a cluster that dropped the quiet ones would shrink its way into two clusters.

## Taking a member out

```console
$ weg cluster leave --server http://127.0.0.1:8063 --yes
ns2 has left the cluster. It answers queries with what it held and refuses writes. To join it again,
discard its database and its Raft directory and start it with --join; to run
it on its own, discard its Raft directory only.
```

`leave` takes out the server it is sent to. `remove` takes out another one, which is the way
for a member that cannot ask for itself because it is off, or has stopped:

```console
$ weg cluster remove ns3 --yes
took ns3 out of the cluster; if it is running, it answers queries with what it held and refuses writes
```

Both need the `admin` scope and ask before acting unless given `--yes` (or `-y`). The
cluster's only voter cannot be removed. **Take out a member that is off before one that is
running**: removing a running voter while another is off can leave the rest without a
majority, and then nothing more can be changed, the removal of the dead one included.

That is why both say, before they ask, what the change does to the majority. With ns3 off,
taking out ns2, which answers, would stop the writes:

```console
$ weg cluster remove ns2
Afterwards 2 voters remain, 1 of them answered here, and 2 are needed: the cluster would take no writes.
```

A member that has been taken out keeps answering queries with what it held, and refuses
writes. It does not turn into a single server by itself, because a server still in a
resolver's rotation that started taking its own writes would drift away from the cluster
without anybody having decided it should. From there:

- **to join it again**, discard its database and its Raft directory, and start it with
  `--join`;
- **to run it on its own**, discard the Raft directory only. It starts as a single server
  holding what it held, and `weg cluster init` can make it the first member of another
  cluster.

A member that was off when it was removed learns nothing. When it starts again it still
believes it is a member, refuses writes as if no member led, and cannot disturb the others:
they no longer count its votes. Repair it the same way.

## A member that cannot apply a change

A member that fails to carry out an entry of the log, because its disk is full or because it
is an older version meeting an entry it cannot read, tries a few times over about a minute,
then leaves the cluster rather than skip the entry. It goes on answering queries with what it
held at that point, refuses writes, and `weg cluster status` on it names the entry it stopped
at and the reason.

Repair it like a member that was taken out: remove it from another member, discard its
database and its Raft directory, and join it again. It starts from a snapshot of the whole
cluster, however long the log has grown.

The same rule is why an upgrade goes one member at a time. A member running an older version
that meets an entry it cannot read stops rather than guess, and `weg cluster status` is how
you see that before the next member goes.

## Watching it

`weg_cluster_behind` is 1 while a member has left its cluster, by being taken out or by
stopping over an entry. `/healthz` on a member carries `current`, which is false in the same
state, and `weg health` says so in a second line. The status stays `serving` either way,
because the member still answers: whether to take it out of rotation is yours to decide.

Each member reports on itself. To see the cluster, ask any member for `weg cluster status`;
to be alerted about every member, scrape every member.
