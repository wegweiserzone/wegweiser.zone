+++
title = "Running Wegweiser"
description = "Two shapes that work: a systemd unit on a host, or a container. Both keep the database in one place and neither runs as root."
weight = 70
group = "Running it"
+++

Two supported shapes: a systemd unit on a host, and a container image. Both put
the database in `/var/lib/wegweiser` and read `/etc/wegweiser/config.yaml`, and
neither runs as root.

## systemd

```sh
sudo install -m 0755 bin/weg /usr/bin/weg
sudo install -D -m 0644 packaging/systemd/wegweiser.service /etc/systemd/system/wegweiser.service
sudo install -D -m 0644 docs/wegweiser.example.yaml /etc/wegweiser/config.yaml
sudo systemctl daemon-reload
sudo systemctl enable --now wegweiser
```

The first start prints an administrator token once. It is in the journal:

```sh
journalctl -u wegweiser | grep weg_
```

Put it in the environment and the command line finds the server by itself,
because it reads the API address out of the same configuration file:

```sh
export WEG_TOKEN=weg_…
weg health
weg zone list
```

### What the unit does about privilege

The process runs as a user systemd creates for the lifetime of the unit and
takes away again (`DynamicUser=yes`), and it holds exactly one capability:
`CAP_NET_BIND_SERVICE`, for port 53. `CapabilityBoundingSet` stops it acquiring
any other, and `NoNewPrivileges` stops anything it might exec from doing so
either.

Beyond that the filesystem is read-only apart from its own state directory, the
syscall filter is `@system-service` minus `@privileged` and `@resources`, and
only `AF_INET`, `AF_INET6` and `AF_UNIX` sockets can be opened. A DNS server
parses whatever the network sends it; the wire parser is fuzzed and a malformed
packet must never panic, and this is the second wall for the day the first one
has a hole in it.

`systemd-analyze security` scores the unit at **1.4**, and `make unit-check`
runs both that and `systemd-analyze verify`. What is left in the report is what
a DNS server is: internet sockets, the host's network, and the capability to
bind port 53.

`PrivateUsers=` is deliberately not set. In a private user namespace the
ambient capability means nothing to the host's network namespace, and binding
port 53 fails.

There is no `ExecReload`. The configuration file holds bootstrap settings only,
and everything an operator changes (zones, records,
tokens) is in the database and takes effect on the wire without a restart. weg
does not handle `SIGHUP`, so a reload that sent one would stop the server
rather than reload it.

## Container

```sh
make image
podman run -d --name wegweiser \
  --cap-add=NET_BIND_SERVICE \
  -p 53:53/udp -p 53:53/tcp \
  -p 127.0.0.1:8053:8053/tcp \
  -v wegweiser:/var/lib/wegweiser \
  wegweiser:latest
```

The image is `scratch` with one static binary in it: no shell, no package
manager, no libc. It runs as uid 65532 and is about 21 MB.

Port 53 inside the container is bound without root, which needs the same
capability it would need on a host; hence `--cap-add=NET_BIND_SERVICE`. A
runtime that allows it can instead set
`--sysctl net.ipv4.ip_unprivileged_port_start=53`.

The API listens on every address inside the container, because loopback there
is reachable by nothing. What keeps it private is the published port:
`-p 127.0.0.1:8053:8053` above binds it to the host's loopback only. The API
can change every zone this server answers for, so exposing it to a network is a
decision to make on purpose.

The web interface is served from the same port, at the root: with the mapping
above it is `http://127.0.0.1:8053/`. It is part of the binary rather than a
separate artefact. A deployment that wants an API and
nothing that renders in a browser sets `api.ui: false`, or passes
`--ui=false`, and everything outside `/api/v1` then answers with a document
saying that is what happened. The CLI can do everything the interface can
(architecture invariant 1), so nothing becomes unreachable.

Because there is no shell in the image, the health check is the binary itself:

```
HEALTHCHECK CMD ["/usr/bin/weg", "health"]
```

`weg health` needs no token and exits non-zero unless the server is serving —
which means a snapshot has been published, not merely that the process is up. A
container reporting healthy while answering REFUSED for its own zones is worse
than one that reports nothing.

Build the image with `--format docker`, which `make image` does: the OCI image
format has no field for a health check, and podman drops it with a warning.

### Configuration in a container

The image carries a `/etc/wegweiser/config.yaml`, so replacing it is a mount
and nothing else:

```sh
podman run -d -v ./config.yaml:/etc/wegweiser/config.yaml:ro,Z wegweiser:latest
```

The `Z` is for SELinux, which Fedora and RHEL enforce by default: without it
the mount is denied and the server reports `permission denied` on a file that
is plainly readable on the host. It relabels the file for this container. On a
system without SELinux it does nothing.

It is a file rather than environment variables on purpose. The environment is
the stronger of the two sources, so variables baked into the image would be
variables a mounted file could not override, and "mount your configuration, and
also unset the image's" is not a thing to ask of anybody.

```sh
podman run --rm wegweiser:latest config show
```

says what a server in that image would start with and where each value came
from, which is the fastest way to find out why it is listening somewhere
unexpected.

## Neither

`weg serve` in a terminal works with no configuration at all: it puts the
database in the working directory, answers on port 53 if it may and fails
saying so if it may not, and serves the API and the web interface on loopback.

## The database file

Everything this server holds is in one SQLite file: zones, records, the whole
history, the API tokens, the settings. Both shapes above put it in
`/var/lib/wegweiser`.

**Copy it stopped, or copy all of it.** SQLite runs in write-ahead logging
mode, so a recent change lives in `wegweiser.db-wal` until it is folded back
into the main file, and that log can be larger than the database. Copying
`wegweiser.db` alone on a running server therefore produces a database missing
the most recent changes, and nothing about it looks wrong until the day you
restore it. Stopping the service folds the log in and removes
`wegweiser.db-wal` and `wegweiser.db-shm`; a copy taken then is the whole
thing. If it has to be taken while the server runs, take all three files
together, or `sqlite3 wegweiser.db ".backup out.db"`, which reads a consistent
snapshot of a live database.

**It contains at least one secret that survives being read.** An API token is
stored as a SHA-256, so a copy of the file is not a copy of the credentials. A
TSIG key is not, and cannot be: verifying a signature means recomputing it, so
the secret has to be there in a form the server can use. If you have created
transfer keys, the file is now worth as much as the ability to take a copy of
every zone on the server.

The packaging already does the sensible thing. `StateDirectoryMode=0700` and
`DynamicUser=yes` mean the directory belongs to the service and nothing else on
the host can read it; the container image runs as uid 65532 with the database
on a volume of its own. Neither needs anything from you.

What does need a decision is everything that leaves the machine:

- **Backups.** A copy of this file in an object store, a snapshot volume or a
  home directory is a copy of the keys. Encrypt it, or restrict it the way you
  would a private key.
- **Bind mounts.** `-v ./data:/var/lib/wegweiser` puts the file in a directory
  owned by whoever ran the command, with whatever mode their umask gives it. A
  named volume avoids the question.
- **Support requests.** Do not attach the database to a bug report. Export the
  zone with `weg zone export` instead, which carries records and no secrets.

If none of that is acceptable, do not create TSIG keys. An address list
(`weg settings set --transfer-allow`) holds no secrets at all, and on a private
network under one administration it is enough. The
[secondaries page](/docs/secondaries/) says where each of the two stops working.
