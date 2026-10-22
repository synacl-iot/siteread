#!/usr/bin/env bash
# Daily, as root (siteread-log-prune.timer): keeps siteread.dev's access log to 28 days.
#
# Caddy rolls its log only by size, so on a small site one file would hold months. Each run moves
# the lines so far to a dated, gzipped file and empties the live one (Caddy keeps appending to it:
# it opens the file O_APPEND), then deletes every dated file whose newest line is past 27 days, so
# no line is older than 28. Lines written in the instant between the copy and the emptying are lost.

set -euo pipefail
DIR=/var/log/siteread
cd "$DIR"
if [ -s access.log ]; then
    dated="access-$(date -u +%Y-%m-%dT%H%M%SZ).log"
    cp -p access.log "$dated"
    truncate -s 0 access.log
    gzip -f "$dated"
fi
find "$DIR" -maxdepth 1 -name 'access-*.log*' -mmin +$((27 * 1440)) -delete
