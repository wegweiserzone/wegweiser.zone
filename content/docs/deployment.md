+++
title = "Running Wegweiser"
description = "Three shapes that work: packages from the project's repository, a systemd unit installed by hand, or a container. All keep the database in one place and none runs as root."
weight = 70
group = "Running it"
+++

Three supported shapes: packages for apt, dnf and zypper, a systemd unit
installed by hand, and a container image. All of them put the database in
`/var/lib/wegweiser` and read `/etc/wegweiser/config.yaml`, and none runs as
root.

## Packages

Wegweiser and its [witness](/docs/witness/) come as deb and rpm packages from
the project's own repository at `pkg.wegweiser.zone`, for amd64 and arm64. The
binary is static, so one package fits Debian 12, Ubuntu 22.04, RHEL 9 and its
rebuilds, current Fedora, openSUSE Leap 15.6, and whatever came after them.

The repository is signed with this key:

```
1B12 102F 15DD 28E0 A9D0  10C1 BC11 6760 1CAC C922
```

Compare it with what you are shown for the key you downloaded. The same
fingerprint is in the [server's README](https://github.com/wegweiserzone/wegweiser#readme),
so it can be checked somewhere other than this page.

On Debian and Ubuntu:

```sh
sudo install -d -m 0755 /etc/apt/keyrings
sudo curl -fsSLo /etc/apt/keyrings/wegweiser.asc https://pkg.wegweiser.zone/signing-key.asc
gpg --show-keys /etc/apt/keyrings/wegweiser.asc
sudo curl -fsSLo /etc/apt/sources.list.d/wegweiser.sources https://pkg.wegweiser.zone/wegweiser.sources
sudo apt update
sudo apt install wegweiser
```

The sources file names the key with `Signed-By`, so the key vouches for this
repository and for no other.

On RHEL, Rocky Linux, AlmaLinux and Fedora:

```sh
sudo curl -fsSLo /etc/yum.repos.d/wegweiser.repo https://pkg.wegweiser.zone/wegweiser.repo
sudo dnf install wegweiser
```

On openSUSE:

```sh
sudo curl -fsSLo /etc/zypp/repos.d/wegweiser.repo https://pkg.wegweiser.zone/wegweiser.repo
sudo zypper install wegweiser
```

dnf and zypper show the key's fingerprint and ask before they trust it the
first time. They check the signature of every package and of the index.

### What installing does

The package installs `weg`, the systemd unit and completions for bash, zsh and
fish. Where there is no `/etc/wegweiser/config.yaml` yet, it writes the example
there, mode 0600 and owned by root, and from then on leaves the file alone. Each
release brings its own example to `/usr/share/wegweiser/wegweiser.example.yaml`,
to compare yours against.

**It starts nothing.** Edit the configuration, then:

```sh
sudo systemctl enable --now wegweiser
```

On Ubuntu and Fedora the edit has to include the address. systemd-resolved
holds `127.0.0.53:53` there, and the default `:53`, which is every address,
cannot be bound beside it: the server stops with `address already in use`.
Either give `dns.listen` the address the server answers on, such as
`192.0.2.1:53`, or switch off resolved's stub listener with
`DNSStubListener=no` in `/etc/systemd/resolved.conf`. The second changes how
the machine itself looks names up.

The first start prints an administrator token, [as below](#the-first-start).

### Upgrading

```sh
sudo apt update && sudo apt upgrade      # or: sudo dnf upgrade, sudo zypper update
```

A server that was running is restarted on the new binary, and one that was
stopped stays stopped. If the new one does not come back, the package manager
says so and finishes anyway, and `journalctl -u wegweiser` says why.

Read the release's notes first. When a release changes the database they say
so under **Upgrading**: the older release cannot open the database afterwards,
so the way back is a copy taken before ([the database file](#the-database-file)).
Installing the older package over it gives a server that refuses to start and
says so.

In a cluster, the members must not all upgrade at once. [Upgrading a
cluster](/docs/cluster/#upgrading) says how to hold them and in which order to
go.

### Removing

`apt remove`, `dnf remove` or `zypper remove` stops the server, disables it,
and takes the binary and the unit. The configuration stays. `apt purge` takes
the configuration as well.

The database stays every time. It holds the zones, their whole history and the
TSIG keys, and a package manager is not where that gets decided. It is in
`/var/lib/private/wegweiser`, where systemd keeps the state of a service whose
user it creates; delete it by hand when that is what you mean.

### Moving from an installation by hand

The package takes over the binary and keeps the configuration as it is. The
unit needs a step of its own: one in `/etc/systemd/system` takes precedence
over the package's in `/usr/lib/systemd/system`, so the old one would go on
running unnoticed until the day the two differ.

```sh
sudo apt install wegweiser          # or: sudo dnf install wegweiser, sudo zypper install wegweiser
sudo systemctl disable wegweiser
sudo rm /etc/systemd/system/wegweiser.service
sudo systemctl daemon-reload
sudo chmod 600 /etc/wegweiser/config.yaml
sudo systemctl enable wegweiser
sudo systemctl restart wegweiser
```

Disabling it first removes the link that enabled the old unit, which would
otherwise point at nothing once the file has gone. The database is not touched.

## systemd, by hand

```sh
sudo install -m 0755 bin/weg /usr/bin/weg
sudo install -D -m 0644 packaging/systemd/wegweiser.service /etc/systemd/system/wegweiser.service
sudo install -D -m 0600 docs/wegweiser.example.yaml /etc/wegweiser/config.yaml
sudo systemctl daemon-reload
sudo systemctl enable --now wegweiser
```

### The first start

The first start prints an administrator token once. It is in the journal:

```sh
journalctl -u wegweiser | grep weg_
```

Put it in the environment and the command line finds the server by itself:

```sh
export WEG_TOKEN=weg_…
weg health
weg zone list
```

It looks for the API address in `/etc/wegweiser/config.yaml`, which only root
can read. Run as anyone else, it asks `127.0.0.1:8053`, where the API listens
unless told otherwise. For an API elsewhere, give `--server` or set
`WEG_SERVER`.

### What the unit does about privilege

The process runs as a user systemd creates for the lifetime of the unit and
takes away again (`DynamicUser=yes`), and it holds exactly one capability:
`CAP_NET_BIND_SERVICE`, for port 53. `CapabilityBoundingSet` stops it acquiring
any other, and `NoNewPrivileges` stops anything it might exec from doing so
either. The package installs the same unit.

A user that exists only while the service runs cannot be given a file, so the
configuration reaches it as a systemd credential: systemd reads
`/etc/wegweiser/config.yaml` as root at each start and hands the service a copy
only the service can read. That is what lets the file be mode 0600, which a
file holding a [cluster's](/docs/cluster/) secret should be. Without the file
the service does not start.

Inside a container that runs systemd 252, as Debian 12 and RHEL 9 have it,
the copy only reaches the service when the container's root mount propagates
mounts. Where it does not, the server stops with `permission denied` on
`/run/credentials/wegweiser.service/config.yaml`; `mount --make-rshared /`
before systemd starts is what changes that. A machine of its own, or a virtual
one, is not affected.

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
format has no field for a health check, and podman drops it with a warning. The
published image is pushed in that format for the same reason, so `podman run`
gives a container with a health state and not only `docker run` does.

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
history, the API tokens, the settings. Every shape above puts it in
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

**In a cluster there is a second directory.** Raft keeps its log and its snapshots in
`wegweiser.raft` beside the database, and they carry the same secrets the database does. Back
it up, restrict it and keep it out of bug reports on the same terms. To bring back a member
that lost its disk, join it again with an empty database rather than restoring a copy; a
backup is for the day the whole cluster is gone, when it is restored on one server and `weg
cluster init` makes that server the first member of a new cluster.

If none of that is acceptable, do not create TSIG keys. An address list
(`weg settings set --transfer-allow`) holds no secrets at all, and on a private
network under one administration it is enough. The
[secondaries page](/docs/secondaries/) says where each of the two stops working.
