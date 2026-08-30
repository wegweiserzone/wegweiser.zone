+++
title = "A second nameserver"
description = "One nameserver is one machine that can reboot. Zone transfer, TSIG, NOTIFY, and the configuration the second server needs."
weight = 100
group = "Running it"
+++

One nameserver is one machine that can reboot. Every registrar asks for at
least two, and the reason is not bureaucracy: a zone with a single server
disappears entirely while that server is down.

Wegweiser does not cluster yet, and it does not need to for this. Zone transfer
is how every nameserver written since the eighties gets a copy of a zone from
another one, so the second server can be BIND, Knot, NSD or PowerDNS, and none
of them has to know what the first one is. It cannot be another Wegweiser yet,
which the section on the other end explains.

This page is that arrangement. Three settings on this side, a handful of lines
on the other.

## The shape

{{< diagram "zone-transfer" "Wegweiser as primary sends AXFR or IXFR to a secondary, which answers NOTIFY back; both answer queries from the world." >}}

You edit zones on the primary. The secondary asks for a copy, keeps it, and
answers from it. Both are listed at your registrar, and a client that cannot
reach one uses the other.

The primary does not have to be reachable by the public at all. A **hidden
primary** is one that no NS record names: it exists to be edited and to feed
the servers that do answer. That is the arrangement this was built for, and
nothing below changes for it.

## 1. Say who may take a copy

Nobody may, until somebody is named. This is the default and it is deliberate:
a zone is an inventory of a network, and a copy handed out cannot be taken
back.

```sh
weg settings set --transfer-allow 192.0.2.53,198.51.100.53
```

Or a whole network, if that is what you mean:

```sh
weg settings set --transfer-allow 192.0.2.0/24
```

A bare address is stored as the single host it means, so you do not have to
write `/32`. A prefix with bits set below its length is refused rather than
quietly masked: `192.0.2.7/24` is a typo for one of two different things, and
guessing which would sometimes hand a zone to a network nobody meant to name.

Read it back at any time:

```sh
weg settings show
```

**What an address list can and cannot do.** A transfer is a TCP session, so a
client has to complete a handshake and an off-path spoofer cannot. That makes
an address a real control here in a way it is not over UDP. What it cannot do
is tell two hosts behind one NAT apart, or authenticate a secondary somebody
else runs. Across an organisational boundary this is not access control, and
the answer there is a key rather than a longer list. Skip to step 3.

## 2. Tell them when something changes

Without this, a secondary finds out about a change when its own refresh timer
fires. The default in a Wegweiser zone is an hour.

```sh
weg settings set --notify 192.0.2.53,198.51.100.53
```

**These are two lists, and they do different things.** The first decides who
may take a copy. The second says where the news can arrive. They look alike and
they are easy to confuse, so:

| | `--transfer-allow` | `--notify` |
| --- | --- | --- |
| Answers | who may pull | who is told |
| Holds | addresses, networks, keys | addresses only |
| Empty means | nobody may transfer | nobody is told |

A network cannot be notified, because a datagram has to arrive somewhere.
Filling in one list does not fill in the other, and an operator who sets the
transfer list and forgets this one gets working transfers and slow news, with
nothing to say why. That is the one sharp edge here.

A secondary on a port of its own follows the address after a colon:

```sh
weg settings set --notify '192.0.2.53,[2001:db8::53]:5353'
```

## 3. A key, where an address is not enough

TSIG (RFC 8945) is a shared secret. The secondary signs its request with it,
this server verifies the signature, and the transfer is granted to whoever
holds the key rather than to whoever is at an address.

```sh
weg tsig create secondary.example.com.
```

That prints the secret and nothing else on standard output, so it can be
captured:

```sh
SECRET=$(weg tsig create ns2.example.com.)
```

Creating a key grants nothing on its own. Put it on the transfer list:

```sh
weg settings set --transfer-allow key:secondary.example.com.
```

An entry is an address **or** a key, and one of them matching is enough. Adding
a key while leaving a prefix in place has not tightened anything: a request
from that prefix is still served unsigned. Take the prefix out when you mean
the key to be the control.

To sign the notification as well, name the key after the address:

```sh
weg settings set --notify '192.0.2.53 key:secondary.example.com.'
```

A secondary configured to insist on TSIG will ignore an unsigned notification,
so this matters as soon as you have set the key up on the other end.

### Which algorithms

`hmac-sha256` unless the other end says otherwise, and `hmac-sha384` or
`hmac-sha512` if it does. Wegweiser does not offer `hmac-sha1` or `HMAC-MD5`.
RFC 8945 calls the first NOT RECOMMENDED and forbids the second, and offering
an algorithm beside advice not to use it is a footgun with a manual page. A
secondary that can only do `hmac-sha1` is an old secondary, and the address
list still serves it.

### Reading a secret back

Unlike an API token, a TSIG secret can be read again:

```sh
weg tsig show secondary.example.com.
```

This is not an oversight. Verifying a signature means recomputing it, so this
server has to keep the secret, and hiding it in the interface would be theatre
rather than a boundary. What follows for the database file is on the
[deployment page](/docs/deployment/).

### Rotating and withdrawing

```sh
weg tsig revoke secondary.example.com.
```

The key stops signing at once and its secret is cleared: an API token leaves
only a hash behind when it is revoked, and a key would leave material nothing
will ever read again. The name and the dates stay in the listing, so a name a
secondary still has configured looks up to something.

The name is then free, so rotating a key does not mean renaming it on the other
end. Withdraw the old one, create a new one with the same name, and copy the
new secret across.

## The other end

You do not have to write this by hand. Wegweiser holds every zone, the key's
name, its algorithm and its secret, so it can write the file the second server
reads:

```sh
weg secondary config bind --primary 192.0.2.1 > /etc/named/wegweiser.conf
weg secondary config knot --primary 192.0.2.1 > /etc/knot/wegweiser.conf
```

Every zone goes in, the reverse ones among them. Those are the ones that get
left out when the file is assembled by hand, and a reverse zone that only one
of your nameservers answers for fails in a way nobody notices for months.

The address is the one thing the command cannot work out. This server does not
know which of its addresses the world reaches it on, and a hidden primary is
named by no record to ask, so `--primary` is required rather than guessed at.

Name the far end as well, and the two lists above are checked against it rather
than only described:

```sh
weg secondary config bind --primary 192.0.2.1 --secondary 198.51.100.53
```

That reports an empty transfer list, a key that was created and never put on
one, and a secondary the notifications do not reach. Each of those leaves a
configuration that is perfectly formed and does not work, which is the failure
this whole page is about. The file goes to standard output and the warnings go
to standard error, so redirecting the first leaves nothing in it to delete.

The settings screen in the interface does the same thing, with a copy button.

Nothing is generated for NSD or PowerDNS. The transfer works with both; you
write those two by hand, and the blocks below are close enough to adapt.

### BIND

What the command writes, for one zone:

```
// Written by `weg secondary config bind`. Regenerate it rather than edit it.
// BIND 9.16 or newer, which is where `masters` became `primaries`.
// Include this file from named.conf.

key "secondary.example.com." {
    algorithm hmac-sha256;
    secret "<the secret, filled in>";
};

server 192.0.2.1 {
    keys { "secondary.example.com."; };
};

zone "example.com." {
    type secondary;
    primaries { 192.0.2.1; };
    file "/var/lib/named/example.com.zone";
};
```

`--unsigned` leaves out the `key` and `server` blocks, for a secondary the
address list grants. `--zone-dir` moves the `file` path, which is the one line
here that varies by distribution.

### Knot DNS

```yaml
# Written by `weg secondary config knot`. Regenerate it rather than edit it.
# Knot DNS 3. Merge these blocks into knot.conf: a section given twice is an error.

key:
  - id: secondary.example.com.
    algorithm: hmac-sha256
    secret: <the secret, filled in>

remote:
  - id: wegweiser
    address: 192.0.2.1
    key: secondary.example.com.

acl:
  - id: wegweiser-notify
    address: 192.0.2.1
    action: notify

zone:
  - domain: example.com.
    master: wegweiser
    acl: wegweiser-notify
```

The `acl` is not optional and its absence is quiet. Knot will fetch the zone
without it and then drop every notification on the floor, so the zone stays
correct and the news takes an hour. BIND does not need the equivalent, because
it accepts a notification from a server it already calls a primary. Both
behaviours were checked against the real thing.

The rule names an address and no key, deliberately. An ACL naming a key demands
a signature, and whether a notification carries one is a separate setting here
from whether a transfer is signed, so a rule that insisted would drop the
notifications of an arrangement that is set up correctly.

### Another Wegweiser

Not yet. Wegweiser transfers zones out and does not take them in, so the second
server in this arrangement is somebody else's software. That is a real
limitation and it is written down rather than glossed over.

## Checking it works

Before blaming the transfer, ask whether the zone is sound:

```sh
weg zone check example.com
```

The one that matters here is a name server this zone points at and has no
address for. A secondary that fetches such a zone serves a delegation that
answers NXDOMAIN for its own name server, and nothing about the transfer looks
wrong while it happens.

Then ask for the zone the way a secondary would:

```sh
dig @192.0.2.1 example.com. AXFR
```

Unsigned, from an address on the list, that prints the zone. From anywhere else
it prints `status: REFUSED`, which is the correct answer and not a fault.

With a key:

```sh
dig @192.0.2.1 example.com. AXFR \
  -y "hmac-sha256:secondary.example.com.:$SECRET"
```

`dig` verifies the signature on every message and says so if it does not match.
Three things can go wrong, and each says which:

| What `dig` shows | What happened |
| --- | --- |
| `BADKEY` | No key of that name signs here, or it has been withdrawn |
| `BADSIG` | The two ends do not have the same secret |
| `BADTIME` | The clocks are more than five minutes apart |

`BADTIME` carries this server's clock in the answer, so a client can see how
far off it is. The other two do not, deliberately: there is nothing to sign
them with.

### From the metrics

```
weg_dns_queries_total{type="AXFR"}
weg_dns_queries_total{type="IXFR"}
weg_dns_notifications_total{outcome="answered"}
weg_dns_notifications_total{outcome="abandoned"}
```

`abandoned` counts secondaries that were told six times and never answered. It
should be zero. Anything else means a notification is not arriving, and that
secondary is waiting out its refresh timer on every change.

## How many at once

Eight transfers run at the same time. The ninth is answered `SERVFAIL` and comes
back on its own retry timer, which is what a secondary does with that answer
anyway.

The bound is separate from the one on connections because a transfer is the size
of a zone rather than the size of a question: a large one going to a slow client
holds its connection for orders of magnitude longer than a query does, and
without a limit of their own a handful of them would take every connection the
server has and it would stop answering anything.

`maxTransfers` in the configuration file raises it. A `SERVFAIL` on a transfer
that used to work, on a server with more secondaries than it had, is what that
looks like from the other end.

## Whole zone, or only what changed

Both, and the secondary chooses. An `IXFR` request asks for the difference
since the serial it holds, which Wegweiser replays out of its own journal, so
a one-record change sends one record rather than the zone.

Where the difference cannot be worked out, or would be larger than the zone
itself, the answer is a full transfer instead. That is what the specification
provides for and it is never wrong, only larger. You do not configure any of
this.

One thing does affect it: journal retention. A secondary that has been away
longer than the history goes back has to take the whole zone again. Nothing
breaks; it is just more traffic than it needed to be.

## What this is not

It is not a cluster. Both servers answer, but only one of them can be edited,
and if the primary is gone the zone is frozen at whatever the secondary last
fetched. That is the honest description, and for most networks it is enough:
the thing that actually fails is a machine, and the zone keeps answering.

Automatic failover of the *editing* side needs consensus, which needs at least
three servers to have a majority, and that is not built yet. Two servers cannot
elect anything. A pair that claimed to would be lying in the one place a DNS
server must not.
