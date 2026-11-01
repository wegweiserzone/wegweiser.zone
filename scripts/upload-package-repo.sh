#!/bin/bash
# Uploads the repository package-repo.sh built to the document root of
# pkg.wegweiser.zone, over SFTP.
#
#   SFTP_HOST=… SFTP_USER=… SFTP_PORT=… SSH_KEY=~/.ssh/id_deploy \
#     scripts/upload-package-repo.sh OUT REMOTE
#
# In four passes, so that a client updating while this runs never reads an
# index whose files are not there yet. The packages go first, and only those
# not there already: a package's file never changes once it is published.
# Then the index files but the signed ones that name the rest; then those;
# and only then is anything deleted. Every file is written under another name
# and renamed into place, so nothing is ever read half written.
set -euo pipefail

out=$(cd "$1" && pwd)
remote=$2
: "${SFTP_HOST:?}" "${SFTP_USER:?}" "${SSH_KEY:?}"

# The site's own document root sits beside this one, and the last pass
# mirrors with --delete. That pass leaves .well-known alone as a whole: the
# repository has none, so excluding only acme-challenge/ inside it would still
# have the directory itself removed, and the certificate's renewal with it.
case "$remote" in
*/httpdocs/*)
	echo "upload-package-repo: $remote lies inside another document root" >&2
	exit 1
	;;
*/pkg.wegweiser.zone/httpdocs) ;;
*)
	echo "upload-package-repo: $remote is not pkg.wegweiser.zone's document root" >&2
	exit 1
	;;
esac

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
rsync -a --include='*/' --include='*.deb' --include='*.rpm' --exclude='*' "$out/" "$stage/packages/"
rsync -a --exclude='*.deb' --exclude='*.rpm' --exclude=InRelease --exclude=Release \
	--exclude=Release.gpg --exclude=repomd.xml --exclude=repomd.xml.asc "$out/" "$stage/indexes/"

lftp -c "
	set sftp:connect-program 'ssh -a -x -i ${SSH_KEY} -p ${SFTP_PORT:-222}';
	set net:max-retries 2;
	set net:timeout 20;
	set xfer:use-temp-file yes;
	open -u ${SFTP_USER}, sftp://${SFTP_HOST};
	mirror --reverse --only-missing --verbose --parallel=4 $stage/packages/ ${remote};
	mirror --reverse --verbose --parallel=4 $stage/indexes/ ${remote};
	mput -O ${remote}/deb/dists/stable $out/deb/dists/stable/Release $out/deb/dists/stable/Release.gpg;
	mput -O ${remote}/deb/dists/stable $out/deb/dists/stable/InRelease;
	mput -O ${remote}/rpm/repodata $out/rpm/repodata/repomd.xml $out/rpm/repodata/repomd.xml.asc;
	mirror --reverse --only-missing --delete --verbose \
		--exclude '^\.well-known/' \
		$out/ ${remote};
"
