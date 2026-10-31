+++
title = "Signing in through a provider"
description = "People sign in with the account they already have, through an OpenID Connect provider or an LDAP directory, and their groups decide what they may do. Tokens stay, for programs."
weight = 91
group = "Running it"
version = "0.8.0"
+++

A token suits a program. A person already has an account somewhere, in Authentik, Keycloak or
Entra ID, or in FreeIPA, Active Directory or OpenLDAP, and signs in with that. Each provider
says which of its groups get which [scope](/docs/access/#the-three-scopes), and a person
holds the strongest scope any of their groups is given. Somebody in no mapped group is
refused, however well they signed in.

Tokens go on working beside the providers. The one `weg serve` prints on first start stays
the way in when every provider is gone.

## An OpenID Connect provider

Register Wegweiser with the provider as a confidential client using the authorization code
flow. Give it a redirect URI for every address the server is reached at, each ending in
`/api/v1/auth/oidc/callback`. Then tell Wegweiser what the provider made of it:

```console
$ weg idp add oidc Authentik --issuer https://auth.example.com/application/o/weg/ \
      --client-id weg --client-secret-file secret.txt \
      --redirect-uri https://ns1.example.com/api/v1/auth/oidc/callback \
      --map dns-admins=admin --map dns-ops=write
```

The secret is read from a file, or from standard input with `-`, so that it stays out of the
shell's history, and it is never shown again. Groups are read from the `groups` claim and a
person's name from `preferred_username`; `--groups-claim` and `--name-claim` change that. A
provider that keeps the groups out of the ID token is asked for them at its user info
endpoint, which is how Keycloak behaves unless told otherwise.

## An LDAP directory

```console
$ weg idp add ldap FreeIPA --url ldaps://ipa.example.com \
      --user-base cn=users,cn=accounts,dc=example,dc=com --user-filter '(uid={username})' \
      --ca-file /etc/ipa/ca.crt --map admins=admin
```

A person's entry is found with the filter, `{username}` replaced and escaped, and their
password is checked by binding as that entry. That happens over LDAPS, or over `ldap://`
with `--start-tls`; a password never crosses the network in the clear, and it is forgotten
once the bind has answered. Without `--bind-dn` the entry is searched for anonymously. For
Active Directory the filter is `(sAMAccountName={username})`.

Groups come from the entry's `memberOf`, which FreeIPA, Active Directory and OpenLDAP with
the memberof overlay keep. Where it is missing, `--groups search` searches for them under
`--group-base` with `--group-filter`. A mapping names a group by its DN or by the value of
its first RDN, so `admins` and `cn=admins,cn=groups,cn=accounts,dc=example,dc=com` are the
same group.

## Before anybody relies on it

```console
$ weg idp check FreeIPA --username alice
$ weg idp check Authentik --sign-in
```

The check tries what a sign-in needs, from the server asked: an OpenID Connect provider's
discovery document, a directory's connection, bind and bases. Given a username, a directory
also says who that is, which groups they are in and the scope those give them, without a
password.

An OpenID Connect provider only says who somebody is at the end of a sign-in. `--sign-in`
opens a browser, signs in once and opens no session, and then shows the same. It works on a
provider that is switched off, which is what it is for: try the provider, map the groups it
sends, then switch it on.

`weg idp add` and `weg idp set` take `--dry-run`, which checks a provider as it would be
saved and saves nothing. A failed step is the answer rather than a failure of the command,
so the exit status is zero either way, and with `--output json` a script reads `ok`.

## Signing in

The sign-in page offers each provider that is switched on: a button for an OpenID Connect
provider, a name and password for a directory, and the token folded away below them. From a
terminal:

```console
$ weg login FreeIPA
$ weg login Authentik
```

A directory asks for the name and password without echo. An OpenID Connect provider opens a
browser, which comes back to `weg` on a port of 127.0.0.1. With `--no-browser` the address
is printed instead, and with `--port` as well it can be reached through `ssh -L` from a
machine that has a browser. The session is kept per server address, in a file only you can
read, and the commands after it use it unless `--token` or `WEG_TOKEN` names a token.
`weg logout` ends it.

## Sessions

A session lasts twelve hours. It is a cookie sealed under a key every member of a cluster
holds, so it works on every member and survives a restart, and the server keeps no record
of it. A commit made in it names the person and the provider, as `alice (FreeIPA)`.

The scope is what the person's groups gave them when they signed in, and it holds until the
session ends. Somebody taken out of a group upstream keeps what it gave them until then,
unless their sessions are ended sooner:

```console
$ weg idp end-sessions FreeIPA alice
```

That ends every session they hold through the provider, on every member, and they can sign
in again with what their groups give them now. Switching a provider off, or removing it,
ends every session opened through it.

Ending a session is a write, so it needs the cluster to have its majority. Without one,
signing out clears the browser, and a copy of the cookie taken before works until it runs
out.

## In the interface

*Providers* does everything above. Who a provider lets in is set per scope, as the groups
given each, and a provider that lets nobody in says so. A provider's page checks it as the
fields stand, saved or not, in a column beside the form. Looking somebody up in a directory,
or trying a sign-in at an OpenID Connect provider, lists their groups there, and a click
gives one a scope. [The web interface](/docs/web-interface/#providers) has the screen.

Managing providers needs `admin`, because a mapping is how an account becomes an
administrator.

## Changing a provider

A secret left out of a change is kept, so that changing a mapping does not mean typing it
again. It is kept only while the provider and the account it is for stay the same: the
issuer and the client ID, or the URL and the bind DN. Change either and the secret is asked
for again, so nobody who may edit a provider can send a stored secret to a host of their
choosing.

## What is not built

Approving a sign-in by code, for a terminal with no browser nearby, is not built. A
directory works over SSH as it is, a token works anywhere, and the browser's way back reaches through `ssh -L`.
A mapping that names zones is not built either: a scope covers every zone.
