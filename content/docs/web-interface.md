+++
title = "The web interface"
description = "Every screen, what can be done on it, and the keyboard that gets there faster. Served by the DNS server itself, from the same API the command line uses."
weight = 15
group = "Start here"
+++

Served by the same binary as the DNS server, out of the same API `weg` talks to. No second
process, nothing to keep in step, and no privileged path: anything the interface does, the
command line and [your own client](/docs/api/) can do too.

It listens on loopback until you say otherwise. [Access](/docs/access/) covers exposing it
and why the default is what it is.

{{< screenshot "overview" "The overview screen: status, uptime, zone and record counts, queries answered, and the rate right now, above a queries-per-second line." >}}

## Signing in

Paste a token once. The server sets an httpOnly session cookie, and afterwards nothing a
script can read holds the credential. That is the reason it is a cookie and not browser
storage.

The first token is the one `weg serve` prints on first start. After that, mint one per person
from Tokens, with the scope that person needs.

A session that may only read still sees everything. The controls it cannot use say so, with
*Read only* or *This session may not manage tokens*, rather than quietly disappearing. An
interface that hides what you are not allowed to do teaches you the wrong shape of the system.

## Overview

Six numbers across the top: status, uptime, zones, records, queries answered since start, and
the rate right now. Under them the queries-per-second line for the last two minutes, then
three breakdowns: answers by response code, questions by type, and a latency histogram.
Then the most recent changes and the age of the snapshot being served.

The counters come from `/metrics`. If that cannot be read the screen says so and carries on,
because everything else on it comes from somewhere else.

## Zones and records

Zones lists what this server holds with kind, serial, default TTL, primary name server, state
and when it last changed, narrowing as you type. Creating one takes a name, and a network is
accepted wherever a name is: `192.0.2.0/24` becomes the reverse zone that answers for that
range, without anyone reversing the octets by hand.

Opening a zone gives its records in a dense table with the search across the top, and four
tabs: **Records**, **Check**, **Settings** and **History**. History lands in the server-wide
history already narrowed to this zone. Export sits beside them and writes the zone out as a
zonefile.

Records the server generated and maintains carry a `generated` chip. Editing one tells you
what you are about to take over.

### The record editor

Not a box to type rdata into. The type field offers every type, grouped by what it is for:
addresses, names, mail, services, security. Choose one and the form becomes the fields that
type actually has, each with a line saying what belongs in it.

{{< screenshot "editor" "The new record dialog with SRV chosen: separate fields for priority, weight, port and target, each with a hint, and a line reading BECOMES 10 5 5060 sip.example.com." >}}

Eighteen types have their own fields this way: `A`, `AAAA`, `CNAME`, `DNAME`, `NS`, `PTR`,
`MX`, `SRV`, `TXT`, `SPF`, `CAA`, `SSHFP`, `TLSA`, `URI`, `HINFO`, `RP`, `SVCB` and `HTTPS`.
`TXT` and `URI` add the quoting for you, so you write what you mean.

Three things about it are worth knowing:

**Becomes** shows the record as it will be stored, updating as you type. Nobody has to know
that an `SRV` is four numbers and a name in that order to write one correctly, and anybody
who does can read the line and confirm it.

**Edit as one line** drops back to the raw rdata whenever the fields are in the way. Pasting
a record from somewhere else is one field, not four.

**Any type is accepted**, including one with no mnemonic, in the `TYPE65534` form of RFC 3597.
The server stores those, so a control that refused them would be lying about what it can hold.

The name field is relative to the zone, and `@` or empty means the apex. This is the one place
the interface and the API differ: [the API takes absolute names](/docs/api/#names-are-absolute)
and does not qualify them.

### Checking

The Check tab runs [every rule the write path enforces](/docs/checking/) against the zone as
it stands, and reports rather than refuses.

{{< screenshot "check" "The check screen with the reverse half included: two warnings, one offering to fill in missing reverse entries, one offering to make a name the answer for an address." >}}

A finding that has a fix carries the button for it. *Fill them in* writes the reverse entries
the zone's records imply and does not have, as one commit. *Make this the answer* hands an
address's reverse entry to the name in the finding. Nothing on this screen changes anything
until you press one of them.

## Query stream

The queries as they are answered: source, name, type, response code, size and latency, above a
per-second line and a latency histogram. Truncated answers are marked `TC`.

{{< screenshot "stream" "The query stream: a live table of answered queries with response codes and latencies, above a queries-per-second line." >}}

Filter by a name and everything below it, or by one address or network. Both are applied on
the server, so watching one zone stays complete however busy the rest of the server gets.

Under load the stream samples rather than slowing the query path down, and says so while it is
doing it, with the ratio. A graph that quietly stops being the whole truth is worse than one
that admits it.

## History

Every change, newest first, with the diff of any of them beside it and a button to put the
zone back to the state before it.

{{< screenshot "history" "The history screen: commits on the left, the diff of the selected one on the right, with a button to revert to that state." >}}

Two entries for one edit in that screenshot. Changing an address record wrote the matching
change in the reverse zone, and that arrives as its own commit, in its own zone, with the
comment the server gave it. A rollback is a new commit too, which is why the serial moves
forward when you revert. [History and rollback](/docs/history/) has the rest.

## Tokens and keys

Tokens are the credentials that may use the API; keys are the TSIG secrets a secondary signs
a transfer with. Both need `admin`.

A token's secret appears once, when it is created, and never again. Only the hash is kept.
The listing shows a short prefix, enough to tell two apart in a log, and when each was last
used. Revoking one takes effect at once, and the dialog warns you when it is the token you are
signed in with.

A TSIG secret can be read back, because the other end of the transfer has to be given it.

## Settings

Four things, server-wide.

{{< screenshot "settings" "The settings screen: the four reverse conflict policies, each with its API value and what it does, above the list of clients allowed to transfer a zone." >}}

**When an address already answers** is the reverse conflict policy, and the four choices are
spelled out with what each one costs: keep the first, take it over, keep both, or refuse the
write. The API values are shown next to the names, so what you set here and what a script sets
are visibly the same setting.

**Who may pull a whole zone** and **who is told when one changes** are the transfer and NOTIFY
lists. A transfer hands over every name and address at once, so the default is nobody.

**The configuration the other end needs** writes a BIND or Knot fragment for a secondary,
ready to copy. It warns about what it cannot do from here, because
[it writes the file and never installs it](/docs/secondaries/).

## The keyboard

`Ctrl+K` opens the command palette: anywhere in the interface, any zone by name, the theme,
and signing out.

{{< screenshot "palette" "The command palette, listing every place with its shortcut and every zone by name." >}}

Without it:

| | |
| --- | --- |
| `g` then `o` `z` `s` `h` `t` `k` `,` | Overview, Zones, Query stream, History, Tokens, Keys, Settings |
| `/` | Focus whatever the current screen filters by |
| `↑` `↓` `↵` `Esc` | Move, open, close — in the palette and in tables |

## Light and dark

Both are maintained, rather than one being the real design and the other a filter over it. It
follows the operating system until you choose, and the palette has the toggle. Every
screenshot on this page is the same shot twice; you are seeing whichever your system asked
for.

## Switching it off

```console
$ weg serve --ui=false
```

That removes the routes rather than hiding them. The binary then serves an API and nothing
that renders in a browser, which is what you want on a machine where the interface has no
business being reachable. Nothing becomes unreachable by doing it, because the command line
gets to everything the interface does.
