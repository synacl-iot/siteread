#!/usr/bin/env bash
# Build here, ship only the output (the owner's way): run from the owner's machine.
#
#   cloud/deploy/ship.sh [root@host]        default: $SITEREAD_SSH, else root@siteread.dev
#
# Tests both packages, builds the site, copies one release to /srv/siteread/releases/<id>/ and
# runs its install.sh there, which provisions what is missing and switches `current` to it. The
# VM needs no repo, no npm and no build headroom. A release is:
#
#   cloud/                  the service (zero dependencies), with this deploy/ folder
#   packages/verify/        package.json + src/: cloud imports it by relative path
#   site/                   site/dist/site/: browser/ and the self-contained server/
#
# Rollback: ssh in, `ln -sfn /srv/siteread/releases/<older> /srv/siteread/current`, then
# `systemctl restart siteread-cloud siteread-site`.

set -euo pipefail

HOST=${1:-${SITEREAD_SSH:-root@siteread.dev}}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ID="$(date -u +%Y%m%dT%H%M%SZ)-$(git -C "$ROOT" rev-parse --short HEAD)"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "ship: the working tree has uncommitted changes; the release id names $(git -C "$ROOT" rev-parse --short HEAD) anyway" >&2
fi

(cd "$ROOT/packages/verify" && npm test --silent)
(cd "$ROOT/cloud" && npm test --silent)
(cd "$ROOT/site" && npm ci --no-audit --no-fund --loglevel=error && npm test --silent && npm run build --silent)

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/cloud" "$STAGE/packages/verify" "$STAGE/site"
rsync -a --exclude test/ --exclude .data/ --exclude node_modules/ "$ROOT/cloud/" "$STAGE/cloud/"
rsync -a "$ROOT/packages/verify/package.json" "$ROOT/packages/verify/src" "$STAGE/packages/verify/"
rsync -a "$ROOT/site/dist/site/" "$STAGE/site/"

# Root owns the code (the receiving user, since owners are not copied), readable by the service
# user, writable by no one else. Modes are set here: macOS's openrsync has no --chmod.
chmod -R u=rwX,go=rX "$STAGE"
ssh "$HOST" "install -d -m 0755 /srv/siteread /srv/siteread/releases"
rsync -rlpt "$STAGE/" "$HOST:/srv/siteread/releases/$ID/"
ssh "$HOST" "bash /srv/siteread/releases/$ID/cloud/deploy/install.sh /srv/siteread/releases/$ID"
echo "ship: $ID is live on $HOST"
