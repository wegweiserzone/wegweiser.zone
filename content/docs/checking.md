+++
title = "Checking a zone"
description = "What is wrong with a zone as it stands, told apart by whether the server would have refused it. Usually quiet, and the quiet is the point."
weight = 50
group = "Everyday"
+++

```console
$ weg zone check example.com
example.com.: 1 warning in 3 records.

  warning  nameserver  example.com.
    ns1.example.com. has no address in this zone, so a resolver referred to it is told the
    name does not exist. Add ns1.example.com. A <address>, or point the delegation
    somewhere off-site (RFC 1912 §2.8).
```

A zone edited only through this server stays sound, so a quiet check is the ordinary answer.
The command exists for what the write path never saw: data written before a rule existed, or
put there by a hand on the database file.

The findings are the answer, not a failure. **The exit status is zero either way**, so this
is safe in a script that would otherwise stop on the first warning. `--output json` gives
the list and the counts without parsing text.

## Two severities, and the difference matters

**error** — the write path would refuse this. A zone holding one holds data that is
unanswerable or contradictory, and this server would not have let anybody build it, so
something reached the database another way.

**warning** — the write path accepted it and would again. Correct DNS that is probably not
what somebody meant, and occasionally exactly what they meant.

A zone missing a glue record is not in the same condition as one holding a record nothing
can answer, and a report that called both "problem" would be a report people stop reading.

## The one that catches everybody

A name server the zone points at and has no address for. It is a warning rather than an
error because the DNS is correct: the delegation exists, the records are well formed,
nothing is contradictory. It just does not work. A resolver referred to that name asks for
its address, is told the name does not exist, and gives up.

It is the default state of a freshly created zone, which is why `weg zone create` says so as
it happens and why `--ns-address` exists.

## The reverse half

```console
$ weg zone check example.com --reverse
```

That adds two things: the reverse entries this zone's records imply and the reverse zone
does not have, and the addresses two names are claiming at once.

It is a separate flag because working it out plans the write that would fix it, which holds
the zone while it runs. On an ordinary check you do not pay for that.

Both are warnings. A missing entry is fixed by [`weg zone reconcile`](/docs/reverse-zones/),
which writes what is missing and only ever adds. A conflict is not a fault at all: several
names on one address is the ordinary case, and what the check reports is which of them
answers. It stops being reported when it stops being true, because it is worked out from
the records every time rather than stored.

## When a lot is wrong

The list stops at a thousand findings. A zone past that has one fault rather than a thousand,
and the rest would say the same thing again. The report says when it stopped.

## In the interface

The same thing, on a Check tab on every zone, with the reverse half behind a checkbox for
the same reason. Where a finding names a record, the screen offers the action beside it
rather than making you retype the name on a command line.
