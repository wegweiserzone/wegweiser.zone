#!/bin/sh
# Builds the apt and dnf repository served at pkg.wegweiser.zone.
#
#   scripts/package-repo.sh IN OUT FINGERPRINT
#
# IN holds the .deb and .rpm files of every release, OUT is written from
# scratch, and FINGERPRINT names the signing key in the caller's keyring.
# Nothing is kept between two runs: the releases are where the repository
# comes from (wegweiser's docs/decisions/d54-installed-from-packages.md).
#
# Needs apt-ftparchive (apt-utils), createrepo_c, rpmsign (rpm) and gpg.
set -eu

in=$(cd "$1" && pwd)
out=$2
key=$3

rm -rf "$out"
mkdir -p "$out/deb/pool/main" "$out/rpm"
out=$(cd "$out" && pwd)

# The key vouches for these two and for nothing else that a release might
# carry, whatever its name says.
ours() {
	case "$1" in
	wegweiser | wegwitness) ;;
	*)
		echo "package-repo: $2 is a package named '$1', which is not ours to sign" >&2
		exit 1
		;;
	esac
}

# apt: one suite, stable, because the binaries are static and the same package
# installs on every release of every distribution.
for deb in "$in"/*.deb; do
	pkg=$(dpkg-deb -f "$deb" Package)
	ours "$pkg" "$deb"
	mkdir -p "$out/deb/pool/main/$pkg"
	cp "$deb" "$out/deb/pool/main/$pkg/"
done
cd "$out/deb"
for arch in amd64 arm64; do
	dir=dists/stable/main/binary-$arch
	mkdir -p "$dir"
	apt-ftparchive --arch "$arch" packages pool/main >"$dir/Packages"
	gzip -9nk "$dir/Packages"
done
# By hash, so that a client reading the index while it is being uploaded is
# given the files the index it read names, not newer ones with other hashes.
apt-ftparchive \
	-o APT::FTPArchive::DoByHash=true \
	-o APT::FTPArchive::Release::Acquire-By-Hash=yes \
	-o APT::FTPArchive::Release::Origin=Wegweiser \
	-o APT::FTPArchive::Release::Label=Wegweiser \
	-o APT::FTPArchive::Release::Suite=stable \
	-o APT::FTPArchive::Release::Codename=stable \
	-o "APT::FTPArchive::Release::Architectures=amd64 arm64" \
	-o APT::FTPArchive::Release::Components=main \
	-o "APT::FTPArchive::Release::Description=Wegweiser, an authoritative DNS server" \
	release dists/stable >Release
mv Release dists/stable/Release
gpg --batch --yes --local-user "$key" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --local-user "$key" --armor --detach-sign -o dists/stable/Release.gpg dists/stable/Release

# dnf: every package signed, and the metadata as well, so that both gpgcheck
# and repo_gpgcheck can be on. One directory for both architectures; dnf
# picks its own.
for rpm in "$in"/*.rpm; do
	ours "$(rpm -qp --qf '%{NAME}' "$rpm" 2>/dev/null)" "$rpm"
done
cp "$in"/*.rpm "$out/rpm/"
# Every run signs every package again, so the signature is made at one fixed
# moment, the key's own creation plus a second. The same package then comes out
# byte for byte the same each time, and a client holding yesterday's metadata
# still finds the file it names. Ubuntu's rpm looks for gpg2, which Ubuntu's
# gnupg does not install.
at=$(gpg --list-keys --with-colons "$key" | awk -F: '/^pub/ { print $6 + 1; exit }')
rpmsign --addsign --define "_gpg_name $key" --define "__gpg $(command -v gpg)" \
	--define "_gpg_sign_cmd_extra_args --faked-system-time ${at}!" \
	"$out"/rpm/*.rpm >/dev/null
createrepo_c --quiet "$out/rpm"
gpg --batch --yes --local-user "$key" --armor --detach-sign \
	-o "$out/rpm/repodata/repomd.xml.asc" "$out/rpm/repodata/repomd.xml"
