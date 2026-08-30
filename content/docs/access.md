+++
title = "Access"
description = "Tokens, what each scope may do, and how a browser signs in without ever holding one. Everything that reaches this server comes through the same door."
weight = 90
group = "Running it"
+++

There is one API. The web interface and `weg` are both clients of it, and so is anything you
write. That means one place to reason about access rather than three.

## Tokens

```console
$ weg token create deploy --scope write
weg_5ecY4bnf0qKysmwcQCeiSWArmPXvx_pUSwFRBTrqaXc
minted "deploy" with write. This is the only time the secret is shown — what the server
keeps is its hash.
```

The secret is shown once because that is all there is: the database holds a SHA-256 of it.
There is no "show it again", not as a policy but as a fact about what was stored. Lose it
and you mint another.

```console
$ weg token list
NAME       PREFIX        SCOPES  LAST USED  STATUS
bootstrap  weg_NcjjAGWC  admin   just now   active
deploy     weg_5ecY4bnf  write   never      active
```

The prefix is enough to tell two tokens apart in a log without being enough to use. `LAST
USED` is what tells you a token nobody remembers minting is still in service, or that the
one you are about to revoke has not been touched in a year.

```console
$ weg token revoke deploy
```

Revoked immediately, and the row stays so that a name in the history still looks up to
something. The server refuses to withdraw the last token that can still administer it,
because a server nobody can administer is not a safe state to reach by accident.

## The three scopes

They are ordered: `admin` allows everything `write` does, which allows everything `read`
does.

| | |
| --- | --- |
| `read` | Look at zones, records, history, metrics, the query stream |
| `write` | All of that, and change zones and records |
| `admin` | All of that, and manage tokens and transfer keys |

The scope a request needs is decided by its method — a `GET` needs `read`, anything else
needs `write` — with one exception in each direction.

**Tokens and transfer keys need `admin` whatever the method is.** A `write` token that could
mint an `admin` token would not be a `write` token, and a key that may transfer may take
every zone on the server. Reading a key's secret is a `GET` and still needs `admin`.

**Ending your own session needs nothing beyond being signed in.** Logging out takes access
away rather than using it, and a read-only session that could not log out would be one that
cannot stop being logged in.

## How the browser signs in

The interface holds no token. You paste one once, the server sets an httpOnly session
cookie, and the token is gone from anywhere a script can reach. That is the whole reason it
is a cookie and not `localStorage`: a script injected into the page cannot read an httpOnly
cookie, and could read anything the page stored itself.

A second cookie carries a CSRF value that the page *can* read, because it has to send it
back in a header on every state-changing request. Those are the two halves of the
double-submit pattern: the credential the page cannot see, and the proof it is the page
making the request.

## Reaching it from a network

The API listens on loopback by default, and that default is a decision rather than an
oversight: a token on this API can change every zone this server answers for.

Putting it on a network is a deliberate act, with TLS in front of it. `--api-listen` or
`WEG_API_LISTEN` moves it; a reverse proxy terminating TLS is the ordinary arrangement.
The container image listens on every address inside the container, because loopback there is
reachable by nothing — what keeps it private is the port you publish.

If you do not want the browser half at all:

```console
$ weg serve --api-ui=false
```

That removes the routes rather than hiding them, so the binary serves an API and nothing
that renders in a browser. Nothing becomes unreachable: the command line does everything the
interface does.

## What a token cannot do

Read a secret it was never shown. Revoked and expired tokens, and tokens that never existed,
all fail the same way and with the same message — so a caller cannot sort guesses into
"wrong" and "used to be right".
