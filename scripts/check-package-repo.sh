#!/bin/sh
# Installs wegweiser and wegwitness from the package repository the way the
# documentation says to, with every signature check on, and runs both.
#
#   scripts/check-package-repo.sh [BASE]
#
# Meant for a throwaway container of Debian, Ubuntu, Rocky Linux, Fedora or
# openSUSE.
# BASE is where the repository is served, https://pkg.wegweiser.zone unless
# given; the files it serves name that address, and are rewritten to BASE.
set -eu

base=${1:-https://pkg.wegweiser.zone}

if command -v apt-get >/dev/null; then
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y -qq ca-certificates curl >/dev/null
	install -d -m 0755 /etc/apt/keyrings
	curl -fsSL "$base/signing-key.asc" -o /etc/apt/keyrings/wegweiser.asc
	curl -fsSL "$base/wegweiser.sources" | sed "s|https://pkg.wegweiser.zone|$base|" \
		>/etc/apt/sources.list.d/wegweiser.sources
	apt-get update -qq
	apt-get install -y -qq wegweiser wegwitness
elif command -v dnf >/dev/null; then
	curl -fsSL "$base/wegweiser.repo" | sed "s|https://pkg.wegweiser.zone|$base|" \
		>/etc/yum.repos.d/wegweiser.repo
	# gpgcheck and repo_gpgcheck are on in the file, so an unsigned package or
	# index is refused here rather than installed.
	dnf install -y -q wegweiser wegwitness
else
	curl -fsSL "$base/wegweiser.repo" | sed "s|https://pkg.wegweiser.zone|$base|" \
		>/etc/zypp/repos.d/wegweiser.repo
	zypper --non-interactive --gpg-auto-import-keys install wegweiser wegwitness
fi

weg version
wegwitness version
