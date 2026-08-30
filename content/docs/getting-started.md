+++
title = "Getting started"
description = "From an empty machine to a zone that answers, in about five minutes. What each step actually did, so the next one is not guesswork."
weight = 10
group = "Start here"
+++

## Get the binary

One static file. No runtime, no libraries, nothing to install beside it.

```console
$ sha256sum -c --ignore-missing checksums.txt
$ tar xzf weg_*_linux_amd64.tar.gz
$ ./weg version
```

The archive and the `checksums.txt` are on the
[releases page](https://github.com/wegweiserzone/wegweiser/releases/latest). Checking the
sum is one command and it is worth the five seconds.

## Start it

```console
$ weg serve
```

With no configuration at all it puts the database in the working directory, answers DNS on
port 53 if it is allowed to and says so if it is not, and serves the API and the web
interface on loopback.

The first start prints something once:

```console
$ weg serve
weg is answering on [::]:53 — 0 zones, 0 records from ./wegweiser.db
the API is on http://127.0.0.1:8053
weg: this is the first start. The administrator token is shown once:

    weg_NcjjAGWC…

Store it now; only its hash is kept.
```

That token is the administrator credential. It is shown once because what the database
holds is a hash of it, so there is nothing to show a second time. Put it somewhere a
password manager would go, and export it for the shell you work in:

```console
$ export WEG_TOKEN=weg_…
```

Then open <http://127.0.0.1:8053> and paste the same token into the sign-in field, or keep
working on the command line. Both reach the same server through the same API; nothing is
available in only one of them.

## Port 53 without root

Port 53 is privileged, and this server never wants to be root. On a host, the systemd unit
grants the one capability that covers it:

```console
$ sudo setcap cap_net_bind_service=+ep /usr/bin/weg
```

In a container it is `--cap-add=NET_BIND_SERVICE`. If neither is available, put it on a high
port with `--listen 127.0.0.1:5353` and point a resolver at it; [a resolver in
front](/docs/resolver-in-front/) is that arrangement written out.

## Your first zone

```console
$ weg zone create example.com
created example.com. (forward), serial 1, ns1.example.com.
ns1.example.com. has no address yet, so a resolver referred to it is told the name does
not exist. `weg record add example.com. ns1.example.com. A <address>` fixes it.
it is answering now; `weg record add` puts something in it
```

Three things happened. The zone exists and is being answered for. It has a start of
authority naming `ns1.example.com.` as its name server and `hostmaster@example.com` as the
mailbox, both defaults you can override with `--ns` and `--email`. And the server told you
about a problem it just created rather than waiting for you to find it: the name server it
named has no address yet.

That warning is the same check [`weg zone check`](/docs/checking/) runs, and it matters more
than it looks. A delegation pointing at a name with no address is a zone that fails in a way
nothing complains about until somebody cannot reach you.

## Your first record

```console
$ weg record add example.com www A 192.0.2.10
added www.example.com. 3600 IN A 192.0.2.10
  no reverse zone covers 192.0.2.10; create 2.0.192.in-addr.arpa. to have PTRs generated for it
```

`www` is enough: a name without a trailing dot is taken as being inside the zone. The TTL
came from the zone's default.

The second line is the part that makes this server different. It wanted to write the
matching `PTR` and had nowhere to put it. [Reverse zones](/docs/reverse-zones/) is the whole
story; the short version is that you create the reverse zone and it fills itself in:

```console
$ weg zone create 192.0.2.0/24
created 2.0.192.in-addr.arpa. (reverse), serial 1, ns1.2.0.192.in-addr.arpa.
```

A network is accepted wherever a zone name is, so you never have to reverse the octets by
hand. The `PTR` for `www` appeared with it, retroactively, as a commit of its own.

## See it answer

```console
$ dig @127.0.0.1 www.example.com A +short
192.0.2.10
$ dig @127.0.0.1 -x 192.0.2.10 +short
www.example.com.
```

Both directions, and only one of them was typed.

## What to read next

- [Zones and records](/docs/zones-and-records/) is the daily work.
- [Reverse zones](/docs/reverse-zones/) is the feature the second command above hinted at.
- [History and rollback](/docs/history/) is what makes a mistake cheap.
- [Running Wegweiser](/docs/deployment/) turns this into something that survives a reboot.
