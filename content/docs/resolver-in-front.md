+++
title = "A resolver in front"
description = "Wegweiser answers for its zones and refuses everything else. This is what to put in front of it so a laptop can still reach the rest of the internet."
weight = 110
group = "Running it"
+++

Wegweiser answers for the zones it holds and refuses everything else. That is
the correct behaviour for an authoritative server and it is deliberate
([D17](https://github.com/wegweiserzone/wegweiser/blob/main/docs/decisions/d17-no-recursion.md)), but it means a laptop that has only Wegweiser in its DHCP lease
cannot look up `example.org`. This page is the arrangement that fixes it:
a resolver takes the client queries, and hands the ones for your zone down to
Wegweiser.

Both fit on one machine. The whole thing is about six lines of configuration.

## First, the trap

The obvious idea is to hand out two nameservers over DHCP, one Wegweiser and
one public resolver, and let the client sort it out. It does not work, and it
fails in a way that looks like a flaky network rather than a mistake.

The two directions are not symmetric:

- **Outward.** A query for `example.org` arrives at Wegweiser and gets
  REFUSED. A stub resolver reads that as a broken server and moves on to the
  next entry in its list, so the name resolves. It costs a round trip on every
  single external lookup.
- **Inward.** A query for `nas.internal.example` arrives at the public
  resolver and comes back NXDOMAIN. That is a *valid, final* answer, not a
  failure, so the stub accepts it and never asks the second server. For that
  client, the name does not exist.

Which server a client asks first is not yours to decide. glibc walks the list
in order, `options rotate` shuffles it, systemd-resolved has its own logic,
and Windows and Android differ again. So internal names resolve on some hosts,
in some processes, some of the time.

Adding more nameservers does not help either. glibc reads at most `MAXNS`
entries out of `resolv.conf`, currently three, and ignores the rest.

**Hand out the resolver. Only the resolver.**

## The arrangement

{{< diagram "resolver-split" "Clients ask Unbound, which answers from the internet for most names and hands the internal zone down to Wegweiser on a port of its own." >}}

DHCP gives out the address of the machine running Unbound. Nothing points at
Wegweiser except Unbound.

## Moving Wegweiser off port 53

In `/etc/wegweiser/config.yaml`:

```yaml
dns:
  listen: "127.0.0.1:5353"
```

Or `$WEG_LISTEN`, or `weg serve --listen 127.0.0.1:5353`. `weg config show`
prints what the server will actually use and where each value came from.

One thing this buys back: on a high port and on loopback, Wegweiser no longer
needs `CAP_NET_BIND_SERVICE` at all. If you use the shipped systemd unit, you
can drop both capability lines and the process ends up with none.

## Unbound

```
server:
    interface: 10.0.0.1
    access-control: 10.0.0.0/24 allow

    # The internal zone is not delegated from any parent, so a validating
    # resolver cannot build a chain of trust to it and would answer SERVFAIL.
    domain-insecure: "internal.example."
    domain-insecure: "0.0.10.in-addr.arpa."

    # Unbound answers the private reverse ranges itself by default, which
    # would shadow the stub zone below before it is ever consulted.
    unblock-lan-zones: yes
    insecure-lan-zones: yes

    # And it refuses to query the loopback by default, which would leave both
    # stub zones below unused.
    do-not-query-localhost: no

stub-zone:
    name: "internal.example."
    stub-addr: 127.0.0.1@5353

stub-zone:
    name: "0.0.10.in-addr.arpa."
    stub-addr: 127.0.0.1@5353
```

`stub-zone`, not `forward-zone`. A stub zone is how Unbound talks to an
authoritative server: it expects an authoritative answer and treats it as one.
A forward zone is how it talks to another resolver. Both happen to work here,
but only one of them describes what is true.

Do not skip the reverse zone. Forgetting it gives you a network where names
work and `dig -x` does not, which is a confusing state to debug later.

Four things bite people here, and all four are in the block above:

1. **DNSSEC.** If Unbound validates (it does by default on most
   distributions) an unsigned private zone with no delegation from its parent
   fails validation, and the client sees SERVFAIL rather than an answer.
   `domain-insecure` is what exempts it.
2. **Built-in local zones.** Unbound ships answers for `10.in-addr.arpa` and
   the other private ranges, and `local-zone` is consulted before `stub-zone`.
   Without `unblock-lan-zones`, your reverse stub is never reached.
3. **The loopback.** `do-not-query-localhost` defaults to yes, so Unbound will
   not send anything to `127.0.0.1` and the stub zones sit there unused. Every
   query for the internal zone comes back SERVFAIL. This one is the reason to
   run `unbound-checkconf`: it warns about exactly this, by name, and it is a
   warning rather than an error, so the configuration loads and quietly does
   nothing.
4. **Rebinding protection.** Some distributions ship `private-address` lines,
   which strip RFC 1918 addresses out of answers. If yours has them, add
   `private-domain: "internal.example."` or your A records arrive empty.

Then, and not optionally:

```sh
unbound-checkconf
sudo systemctl restart unbound
```

The block above was run against Unbound in a container, with Wegweiser behind
it, and every check below was taken from that run.

## Checking it

Work from the inside out. Ask Wegweiser directly first:

```sh
dig @127.0.0.1 -p 5353 nas.internal.example A +norecurse
```

Then ask the resolver, which is what a client will do:

```sh
dig @10.0.0.1 nas.internal.example A
dig @10.0.0.1 -x 10.0.0.20
dig @10.0.0.1 example.org A
```

What the answers mean when they are not the one you wanted:

| You get | Where it broke |
| --- | --- |
| REFUSED from Wegweiser | The zone is not on this server. `weg zone list`. |
| NXDOMAIN from Unbound, but Wegweiser answers | The stub zone does not match, or a built-in local zone shadows it. |
| SERVFAIL from Unbound | Either validation of an unsigned zone (`domain-insecure`) or the loopback it will not query (`do-not-query-localhost`). `unbound-checkconf` names the second one. |
| NOERROR with an empty answer | Rebinding protection stripped the address. `private-domain`. |
| Nothing, it hangs | Unbound cannot reach `127.0.0.1:5353`. Check what Wegweiser is bound to. |

Wegweiser also tells you why it refused. Its answers carry extended DNS errors
(RFC 8914), so `dig` prints a sentence rather than leaving you to guess:

```
; EDE: 20 (Not Authoritative): (no zone on this server covers that name)
```

## Variants

**Separate machines.** Nothing changes except the address. Point `stub-addr`
at the host running Wegweiser and set `dns.listen` to an address it can be
reached on. Keep the API on loopback or behind a proxy either way.

**A resolver you already run.** Pi-hole, AdGuard Home and Technitium all have
a conditional-forwarding field that does the same job. Give it the zone name
and `address#5353`, and give it the reverse zone as well.

**dnsmasq**, if it is already handing out your DHCP leases:

```
server=/internal.example/127.0.0.1#5353
server=/0.0.10.in-addr.arpa/127.0.0.1#5353
```

dnsmasq does not distinguish stub from forward, and it does not validate by
default, so the DNSSEC caveat above does not apply to it.

**BIND**, for completeness. It validates by default, so it needs the same
exemption Unbound does or it answers SERVFAIL with `broken trust chain` in its
log:

```
options {
    validate-except { "internal.example"; "0.0.10.in-addr.arpa"; };
};

zone "internal.example" {
    type forward;
    forward only;
    forwarders { 127.0.0.1 port 5353; };
};

zone "0.0.10.in-addr.arpa" {
    type forward;
    forward only;
    forwarders { 127.0.0.1 port 5353; };
};
```

## Why it is not built in

Short version: forwarding would put two different levels of trust on one
socket, it would turn a bounded amplification factor into an open resolver's,
and a cache is mutable state in a query path built to have none of it. The
long version, with the arguments on both sides, is [D17](https://github.com/wegweiserzone/wegweiser/blob/main/docs/decisions/d17-no-recursion.md) in the repository.
