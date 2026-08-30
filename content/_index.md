+++
title = "Wegweiser"
+++

{{< screenshot "records" "The records of a zone in the web interface: name, type, TTL and data in a dense table, with the record that generated each reverse entry marked." >}}

## What it is

A single static binary that runs an authoritative DNS server. Start it, open the web
interface, and have a working zone in five minutes without learning zonefile syntax first.
It is a side project, written by one person who got tired of editing zonefiles by hand.
*Wegweiser* is German for signpost.

Also here: authoritative UDP and TCP with EDNS0, zonefile import and export, outbound zone
transfer to the secondaries you name, signed with TSIG and announced with NOTIFY, SQLite
persistence, token authentication, Prometheus metrics. Single node.

### One record, two answers

Adding an address record writes the reverse entry with it. The server says so rather than
leaving you to find out:

```console
$ weg record add example.com api A 192.0.2.60
added api.example.com. 3600 IN A 192.0.2.60
  generated 60.2.0.192.in-addr.arpa. 3600 IN PTR api.example.com.
```

### What the server is being asked, as it is asked

{{< screenshot "stream" "The live query stream: one row per exchange with source, name, type, response code, size and latency, above a queries-per-second line and a latency histogram." >}}

## What it does not do

**It does not resolve.** No recursion, no forwarding, no cache. That one is settled rather
than pending, and a name outside its zones is answered with REFUSED. A network that wants
both its own zones and the internet runs a resolver, hands *that* out over DHCP, and points
a stub zone at Wegweiser. [A resolver in front](/docs/resolver-in-front/) is that
arrangement, and both halves fit on one machine.

## Getting it

```console
$ sha256sum -c --ignore-missing checksums.txt
$ tar xzf weg_*_linux_amd64.tar.gz
$ ./weg version
```

Or as a container, which is `scratch` with the one binary in it:

```console
$ podman run --rm --cap-add=NET_BIND_SERVICE -p 53:53/udp -p 53:53/tcp -p 8053:8053 \
    -v weg:/var/lib/wegweiser ghcr.io/wegweiserzone/wegweiser:latest
```

`--cap-add=NET_BIND_SERVICE` is what binding port 53 needs; the server never wants root.

## The documentation
