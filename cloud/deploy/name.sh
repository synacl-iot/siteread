#!/usr/bin/env bash
# Names a site on the benchmark from its share id, read from stdin so it is never typed or pasted:
#
#   ssh root@<vm> bash /srv/siteread/current/cloud/deploy/name.sh synacl.com < .siteread/share-id
#
# Restarts the service, which rebuilds the benchmark at start, so the row shows at once.

set -euo pipefail
LABEL=${1:?usage: name.sh <label> < share-id-file}
read -r ID
/opt/node/bin/node /srv/siteread/current/cloud/deploy/named-env.mjs /etc/siteread/env "$ID" "$LABEL"
systemctl restart siteread-cloud
