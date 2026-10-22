#!/usr/bin/env bash
# Weekly, as root (siteread-self-share.timer): siteread.dev shares its own week to its own benchmark.
#
# Nothing leaves the server for this: the digest reads /var/log/siteread here and the share goes to
# the service on loopback. Log numbers only: the Search Console export lives on the owner's
# machine. The id is the same every week (.siteread/share-id here, which install.sh made and named
# siteread.dev). An address that loaded /operator is the owner checking the service, not a reader.
# Until the log holds a full week the CLI has nothing to share, and this says so and stops.

set -euo pipefail
cd /var/lib/siteread-self
CLI=/srv/siteread/current/packages/verify/bin/siteread.js
logs=()
for f in /var/log/siteread/access.log /var/log/siteread/access-*.log.gz; do [ -f "$f" ] && logs+=(--log "$f"); done
[ ${#logs[@]} -gt 0 ] || { echo "self-share: no log yet"; exit 0; }
/opt/node/bin/node "$CLI" digest --site siteread.dev --team-path '^/operator(/|$)' "${logs[@]}" --out digests >/dev/null
if out=$(/opt/node/bin/node "$CLI" share digests --yes --endpoint http://127.0.0.1:8787/v1/share 2>&1); then
    echo "$out"
elif grep -q "nothing to share" <<<"$out"; then
    echo "self-share: the log has no full week yet"
else
    echo "$out" >&2
    exit 1
fi
# A digest holds counts, paths and bot names, no address; keep the last 8.
ls -1t digests/*.json 2>/dev/null | tail -n +9 | xargs -r rm -f
