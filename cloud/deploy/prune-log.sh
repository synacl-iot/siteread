#!/usr/bin/env bash
# Daily, as root (siteread-log-prune.timer): keeps siteread.dev's access log to 28 days.
#
# Caddy rolls its log only by size, so on a small site one file would hold months. Each run renames
# the live file to a dated one and restarts Caddy, which opens a fresh access.log. Until the restart
# Caddy keeps writing to the renamed file, so no line is lost. Then every dated file whose newest
# line is past 27 days is deleted, so no line is older than 28.
#
# Why a restart (352 ms; 40 requests sent across one all got a 200), measured on Caddy 2.6:
# - copy-and-truncate corrupts the log: Caddy does not open it O_APPEND, so after a truncate it
#   wrote at its old offset, behind a run of NUL bytes;
# - a reload, even --force, keeps the open file: writers are reused by filename;
# - a reload under a new filename opens the new file but never closes the old one, so a deleted
#   day stayed readable through /proc until the next restart. Deleted has to mean gone.

set -euo pipefail
DIR=/var/log/siteread
cd "$DIR"
if [ -s access.log ]; then
    dated="access-$(date -u +%Y-%m-%dT%H%M%SZ).log"
    mv access.log "$dated"
    systemctl restart caddy
    gzip -f "$dated"
fi
find "$DIR" -maxdepth 1 -name 'access-*.log*' -mmin +$((27 * 1440)) -delete
