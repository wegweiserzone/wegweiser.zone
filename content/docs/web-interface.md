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

{{< screenshot "overview" "The overview screen: a line each for what the server answers for, whether its cluster takes writes and whether the secondaries are in step, above uptime, zone and record counts, queries answered and the rate right now, and a queries-per-second line." >}}

## Signing in

Paste a token once. The server sets an httpOnly session cookie, and afterwards nothing a
script can read holds the credential. That is the reason it is a cookie and not browser
storage.

The first token is the one `weg serve` prints on first start. After that, mint one per person
from Tokens, with the scope that person needs.

A session that may only read still sees everything. The controls it cannot use say so, with
*Read only* or *This session may not manage tokens*, rather than quietly disappearing. An
interface that hides what you are not allowed to do teaches you the wrong shape of the system.

The same goes for a cluster that has lost its majority. Every page then says so in a band
across the top, with the counts, and where a button would change something it reads *No
writes* instead.

## Overview

It opens with how the server stands, a line each: what it answers for, whether its cluster
takes writes and how many voters it can lose, and whether the secondaries hold what it
publishes. Each line leads to the page that explains it, and one with nothing to say is left
out.

Below that, five numbers: uptime, zones, records, queries answered since start, and the rate
right now. Then the queries-per-second line for the last two minutes, which starts when the
page was opened, and three breakdowns: answers by response code, questions by type, and a latency histogram. Then the
most recent changes, and the session you are signed in with.

A server with no zones yet says so and offers to create one or import a zonefile, above
charts that would otherwise be empty.

The counters come from `/metrics`. If that cannot be read the screen says so and carries on,
because everything else on it comes from somewhere else.

## Zones and records

Zones lists what this server holds with kind, how many records each answers from, serial,
default TTL, primary name server, how many of its copies on secondaries are in step, and when
it last changed, narrowing as you type. The name server is written as a zonefile would write
it, `ns1` rather than the zone name a second time. A disabled zone says so beside its name,
and the copies say under the pointer which secondary stands where. Creating one takes a name, and
a network is accepted wherever a name is: `192.0.2.0/24` becomes the reverse zone that answers
for that range, without anyone reversing the octets by hand.

Colour is kept for what is not as it should be. A zone that serves is not green on every row,
so that a disabled one stands out, and the same goes for tokens, keys, cluster members,
secondaries and the response codes in the query stream. A listing that fits on one page has
no pager under it.

Opening a zone gives one line of facts and its records in a dense table with the search across
the top, and four tabs: **Records**, **Check**, **Settings** and **History**. The facts are
its kind, how many records it answers from, serial, default TTL, where its copies on
secondaries stand, and its last change: when, by whom and what, which is the first thing asked
about a zone that behaves differently from yesterday. History lands in the server-wide history
already narrowed to this zone. Export sits beside the tabs and writes the zone out as a
zonefile.

A record the server generated and maintains says `generated` beside its data, and the zone's
own name servers say `zone`. Editing a generated one tells you what you are about to take
over. Every row also has a way to [ask what the server answers](/docs/ask/) for that record,
and a clock that opens [the history of its name](/docs/history/#one-name). Both are reads, so
a session that may only read has them too.

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

**An address is checked as you leave the field**, in the words the server would refuse it
with, and *Add record* waits until it is right. An IPv6 address typed for an `A` record is
pointed at `AAAA`, and the other way round.

**Any type is accepted**, including one with no mnemonic, in the `TYPE65534` form of RFC 3597.
The server stores those, so a control that refused them would be lying about what it can hold.
The note saying so appears only for a type the list does not know.

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

The queries as they are answered: source, transport, name, type, response code, size and
latency, above a per-second line and a latency histogram. Truncated answers are marked `TC`.

{{< screenshot "stream" "The query stream: a live table of answered queries with response codes and latencies, above a queries-per-second line." >}}

Filter by a name and everything below it, or by one address or network. Both are applied on
the server, so watching one zone stays complete however busy the rest of the server gets. A
filter that has matched nothing yet says so, and offers to clear it. A name in the table asks
the same question again on the Ask page, which is where an answer that looks wrong gets
explained.

Under load the stream samples rather than slowing the query path down, and says so while it is
doing it, with the ratio. A graph that quietly stops being the whole truth is worse than one
that admits it.

## Ask

What the server answers for a name and a type, decided by the function that answers queries,
so nobody needs `dig` or a route to the DNS port. It leads with the kind of answer (an answer,
an alias, no data, no such name, a referral), then the response code, the zone and the records
section by section. Every name in an answer asks about itself, so an alias or a delegation can
be followed by clicking, and the question stays in the address to be sent on.
[Asking what it answers](/docs/ask/) has the kinds and what each means.

## History

Every change, newest first, with the diff of any of them beside it. Each row says which
record changed and how, as in `change www A 192.0.2.10 → 192.0.2.11`.

{{< screenshot "history" "The history screen on Everything: commits on the left with the entries the server wrote itself set below the change that caused them and marked followed, and the diff of the selected one on the right, with a button to restore the serial it produced." >}}

**Restore serial** puts the zone back as it was right after the chosen change, at the serial
the change produced. To undo a change, choose the one before it.

It opens on **What people did**. Changing an address record writes the matching change in the
reverse zone, and that arrives as its own commit, in its own zone, with the comment the server
gave it — true history, and not something anybody did. **Everything** brings those back, set
below the change they came from and marked *Followed* rather than by kind, because the kind of
such a commit is always an edit and what it is, is the consequence of another one.

Narrowed to one name, from the clock on a record's row or from an answer on the Ask page, it
shows everything that happened to that name, the entries the server wrote by itself included,
and the name sits in the bar with a way to clear it.

A rollback is a new commit too, which is why the serial moves forward when you revert.
[History and rollback](/docs/history/) has the rest.

## Tokens and keys

Tokens are the credentials that may use the API; keys are the TSIG secrets a secondary signs
a transfer with. Both need `admin`.

A token's secret appears once, when it is created, and never again. Only the hash is kept.
The listing shows a short prefix, enough to tell two apart in a log, and when each was last
used. Revoking one takes effect at once, and the dialog warns you when it is the token you are
signed in with.

A TSIG secret can be read back, because the other end of the transfer has to be given it.

## Secondaries

Every zone on every address the notify list names, with the state each one is in, the serial
it last reported and when it was last asked. Whether a secondary took the copy is a fact that
lives on the other machine, so this server asks it rather than assuming.

{{< screenshot "secondaries" "A table of one row per zone per secondary, each row a state — in step, behind, silent or unasked — beside the serial that secondary last reported, how many commits behind that leaves it, and when it was last asked." >}}

Being in step is the only quiet state. A zone nothing has come back for reads *Unasked*, which
is not the same as up to date, and hovering any state says what it means. Above the table, a
line counts how many of the pairs are not known to be in step, so the screen answers its own
question without anybody reading every row. Nothing here is red: a zone that has not arrived
yet is something to look at rather than a failure of this server.

**The configuration the other end needs** is on this screen too, as a dialog from the bar. It
writes a BIND or Knot fragment for a secondary, ready to copy, and warns about what it cannot
do from here, because [it writes the file and never installs
it](/docs/secondaries/). It used to sit on the settings screen; it is a tool rather than a
setting, and the command line has always kept it under the same noun as `weg secondary
config`.

[A second nameserver](/docs/secondaries/#where-each-secondary-stands) has the states and how
often the questions are asked.

## Cluster

It opens with the answer: whether the cluster takes writes, and how many voters it can lose
before it stops, beside the voters drawn as seats with the majority marked. Below that the
members, with the role each holds, which one leads and how far each has got. The server the
page is served by asks every other member as it answers, so one that is off reads as not
reached, with why under it, rather than as current. The page asks again every five seconds
while it is open.

{{< screenshot "cluster" "The cluster screen: whether the cluster takes writes and how many voters it can lose, beside a row of voter seats, above a table of three members with their addresses, roles, how far each has got, and which one leads." >}}

A server with a cluster section and no cluster yet offers to start one here. **Add a server**
says what to write on the next one: its cluster section, and the command it joins with, or
the same for a witness. With the `admin` scope, each row has a way to take that member out,
and the server's own row is where it leaves. Before it asks, the dialog says what the change
does to the majority, in numbers. A server that has left its cluster, or a cluster with no
voter to spare, says so on every page, in the rail where the version otherwise is.
[A cluster](/docs/cluster/) is the operator's side.

## Settings

Three settings, server-wide, each in a panel of its own and grouped under what it belongs to:
the reverse entries, and the zone transfer.

{{< screenshot "settings" "The settings screen: the four reverse conflict policies, each with its API value and what it does, above the transfer and notify lists, each in a panel of its own." >}}

**When an address already answers** is the reverse conflict policy, and the four choices are
spelled out with what each one costs: keep the first, take it over, keep both, or refuse the
write. The API values are shown next to the names, so what you set here and what a script sets
are visibly the same setting.

**Who may pull a whole zone** and **who is told when one changes** are the transfer and NOTIFY
lists. A transfer hands over every name and address at once, so the default is nobody. The
second of them is also who gets asked what they hold, which is what the Secondaries screen
above reports.

## The keyboard

`Ctrl+K` opens the command palette: anywhere in the interface, any zone by name, the theme,
and signing out. It starts things too: a new zone, record, token or key, an import, and the
check or the history of the zone on the screen, which come first. Each opens the same dialog
the page's own button does. A name typed into it can be asked about at once.

{{< screenshot "palette" "The command palette, listing every place with its shortcut, what can be started from it, and every zone by name." >}}

Without it:

| | |
| --- | --- |
| `g` then `o` `z` `s` `a` `h` `2` `c` `t` `k` `,` | Overview, Zones, Query stream, Ask, History, Secondaries, Cluster, Tokens, Keys, Settings |
| `/` | Focus whatever the current screen filters by |
| `↑` `↓` `↵` `Esc` | Move, open, close, in the palette and in tables |

The palette lists the places in the order of the rail, each with its letter.

## On a phone

Below tablet width the rail waits behind a button in a bar across the top, which keeps the
line about how the server stands, and goes away again once you have chosen. Every table keeps
the columns that answer its question: a record's name, type and data, a query's name, type,
answer and how long it took. The buttons on a row, which a mouse finds by pointing, are always
there on a touch screen.

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
