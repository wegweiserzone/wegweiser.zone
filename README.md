# wegweiser.zone

Website and documentation for [Wegweiser](https://github.com/wegweiserzone/wegweiser), an
authoritative DNS server.

Static pages built with Hugo. Nothing runs on the web server.

## Working on it

```console
$ make serve     # localhost:1313, with live reload
$ make check     # build, and fail on broken internal links
```

`make` downloads the Hugo binary into `bin/` the first time it runs. There is nothing else
to install.

## Publishing

Pushing to `main` builds the site, checks its links and uploads it over SFTP.

### Required secrets

| Secret | |
| --- | --- |
| `SSH_PRIVATE_KEY` | A deploy key used for nothing else |
| `SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -p 222 <host>` |
| `SFTP_HOST`, `SFTP_USER`, `SFTP_PATH` | Destination. `SFTP_PORT` defaults to 222 |

`SSH_KNOWN_HOSTS` is required — the workflow will not accept an unknown host key.

`SFTP_PATH` must end in `httpdocs`. The upload mirrors with `--delete`, and the workflow
refuses to run against anything else.

### Deploying by hand

Only needed if Actions is unavailable. `make build`, then the same mirror the workflow runs:

```console
$ lftp -c "set sftp:connect-program 'ssh -a -x -i ~/.ssh/wegweiser_zone_deploy -p 222'; \
    open -u USER, sftp://HOST; \
    mirror -R --delete httpdocs/ /usr/home/USER/public_html/wegweiser.zone/httpdocs"
```

`make hooks` installs a pre-commit hook that rejects commits containing private key material
or a filled-in password field.

## Content and design

`content/docs/` holds the documentation, written as prose rather than as a reference.

Colours and type come from `web/src/app.css` in the server repository. Fonts are
self-hosted.
