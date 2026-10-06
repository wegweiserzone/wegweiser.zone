+++
title = "Under load"
description = "DNS cookies, and what happens to a query that brings none while the server cannot keep up. One switch, no rate limit, and nothing to configure."
weight = 115
group = "Running it"
+++

A DNS server answers anyone who asks over UDP, and UDP does not check who is asking. Somebody
who forges the source address of a query gets the answer sent to whoever they named, which
is how a nameserver becomes a weapon pointed at a third party. Most servers answer that with
response rate limiting: count what goes to each address, and drop or truncate past a
threshold somebody chose.

This one uses DNS cookies instead, and only while it is under load. A legitimate client pays
at most one extra round trip, once. A forged source never receives the reply that would let
it pay, so it gets nothing worth reflecting.

## Cookies

A client that supports cookies sends one of its own with a query, and the server answers
with a server cookie computed from it and from the client's address (RFC 7873, RFC 9018).
The next query brings both back. A server cookie is worth nothing from any other address,
which is the whole point: it proves the client received an earlier answer at the address it
claims.

There is nothing to switch on. Cookies are answered from the first start: the secret they are
computed under is minted then, kept with the other server settings, and rolled over every
hour. A cookie issued under the previous secret is still accepted for an hour after the
change, so a rollover is invisible to clients. A cookie older than half an hour is replaced
in the next answer.

A client with nothing to ask can fetch a cookie anyway: a query with an empty question and a
cookie option is answered with an empty answer and a cookie in it. Every other message
without exactly one question is still malformed.

## What changes under load

While the server is keeping up, nothing is refused for want of a cookie. While it is not,
a query over UDP has to bring a valid server cookie to be answered:

| The query brings | The answer |
| --- | --- |
| a valid server cookie | the answer, as always |
| a client cookie only, or a server cookie that no longer checks | BADCOOKIE, with a fresh cookie in it |
| no cookie at all | REFUSED |
| anything, over TCP | the answer: TCP proves the address by its handshake |

A client that supports cookies is turned away once and answered on its retry, because the
BADCOOKIE carried what it needed. A client that implements no cookies at all cannot be helped
that way and is refused for as long as the load lasts. That is the case rate limiting exists
for, and the reason it is not ruled out for good: the counter below says how much of that
traffic there actually is, and that number is where reopening the question would start.

## What "under load" is

The kernel having dropped a query on one of the server's sockets because nobody read it in
time. Once a second the server asks the kernel how many datagrams each socket has dropped
(`SO_MEMINFO`), and any change since the last second puts it under load for the next. That
is the machine's own limit rather than a rate anybody configured, so it moves with whatever
machine the server runs on and there is no number to get wrong.

It is a control loop, not a latch. A refusal costs less than an answer, so a flood that
overwhelmed the server may stop overwhelming it while the refusals are in force; the drops
stop, the next second is not under load, and cookieless queries are answered again. Traffic
that sits just above what the machine can serve has its reflection cut rather than stopped.

`SO_MEMINFO` arrived in Linux 4.14. A kernel without it leaves the server answering everyone,
as it did before it had cookies, and says so once in the log:

```
dns: the kernel will not say how many queries it dropped, so a client without a cookie is never refused
```

## Watching it

```
weg_dns_under_load
weg_dns_cookie_refusals_total{client}
```

`weg_dns_under_load` is 1 while the server is refusing cookieless queries. The counter
splits what those refusals turned away: `client="badcookie"` for clients that can come back
with the cookie they were handed, and `client="cookieless"` for clients that implement none
and cannot. A `badcookie` count is cheap; a `cookieless` count is real clients going
unanswered while the load lasts.

The decision records have the long version: why cookies and not rate limiting
([D35](https://github.com/wegweiserzone/wegweiser/blob/main/docs/decisions/d35-cookieless-under-load.md)),
and why the kernel's drop counter is the threshold
([D38](https://github.com/wegweiserzone/wegweiser/blob/main/docs/decisions/d38-under-load-is-what-the-kernel-says.md)).
