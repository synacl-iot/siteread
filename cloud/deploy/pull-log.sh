#!/usr/bin/env bash
# Copies siteread.dev's own access log to this machine for the weekly read (the seo-read skill):
#
#   cloud/deploy/pull-log.sh [root@host] [dir]     default dir: ~/siteread-data/siteread.dev/logs
#
# A mirror, deletions included: a file the server dropped after 28 days is dropped here too, which
# is what the privacy page promises. Keep the folder outside any repo.

set -euo pipefail
HOST=${1:-${SITEREAD_SSH:-root@siteread.dev}}
DIR=${2:-$HOME/siteread-data/siteread.dev/logs}
mkdir -p "$DIR"
chmod 700 "$DIR"
rsync -rt --delete "$HOST:/var/log/siteread/" "$DIR/"
echo "pull-log: $(ls -1 "$DIR" | wc -l | tr -d ' ') file(s) in $DIR"
