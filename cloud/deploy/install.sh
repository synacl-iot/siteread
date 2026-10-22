#!/usr/bin/env bash
# Runs ON the VM, as root, from a release ship.sh just copied over:
#
#   bash /srv/siteread/releases/<id>/cloud/deploy/install.sh /srv/siteread/releases/<id>
#
# Brings the VM to the state HOSTING.md asks for, then switches to that release. Every step is
# safe to repeat, so a fresh Debian 13 VM and the tenth deploy run the same script:
#
#   1. SSH by key only.
#   2. Node 24 LTS from nodejs.org, checksum-checked, in /opt, for the service and the jobs.
#      Debian's nodejs is 20. A Node update is a new NODE_VERSION here, then a deploy.
#   3. Caddy from Debian (its security updates come with unattended-upgrades) as the TLS proxy,
#      which also serves the site: it runs in the browser, so it is files only.
#   4. The `siteread` system user. It owns only its data dir; the code is root's, read-only to it.
#   5. /etc/siteread/env (0600) with an operator token made here, kept on later runs, and
#      siteread.dev's own share id, made here once and named siteread.dev.
#   6. The units, the Caddyfile and siteread.dev's log folder; the firewall opened for 80/443.
#   7. `current` switched to the release, the service restarted and checked; 5 releases kept.

set -euo pipefail

NODE_VERSION=v24.22.1
RELEASE=${1:?usage: install.sh /srv/siteread/releases/<id>}
DEPLOY="$RELEASE/cloud/deploy"
[ -d "$DEPLOY" ] || { echo "install.sh: $DEPLOY is not a release" >&2; exit 1; }
[ -f "$RELEASE/site/browser/index.html" ] || { echo "install.sh: $RELEASE has no built site" >&2; exit 1; }
say() { printf 'install: %s\n' "$*"; }

# 1. SSH. sshd keeps the first value it reads, and the image's 50-cloud-init.conf turns
# passwords on, so this file sorts first.
cat > /etc/ssh/sshd_config.d/00-siteread.conf <<'EOF'
# Keys only (cloud/deploy/install.sh). Sorts before the image's 50-cloud-init.conf, which sshd
# would otherwise obey: sshd keeps the first value it reads.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh
say "ssh: keys only"

# 2. Node.
if [ "$(/opt/node/bin/node --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
    tmp=$(mktemp -d)
    tarball="node-$NODE_VERSION-linux-x64.tar.xz"
    curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
    curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
    (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c --quiet -)
    mkdir -p "/opt/node-$NODE_VERSION"
    tar -xJf "$tmp/$tarball" -C "/opt/node-$NODE_VERSION" --strip-components=1
    ln -sfn "/opt/node-$NODE_VERSION" /opt/node
    rm -rf "$tmp"
fi
say "node: $(/opt/node/bin/node --version)"

# 3. Caddy. The package starts it on a placeholder page; the firewall keeps 80 closed until our
# Caddyfile is in (step 6).
if ! command -v caddy >/dev/null; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null
fi
say "caddy: $(caddy version | cut -d' ' -f1)"

# 4. User and folders.
id siteread >/dev/null 2>&1 || useradd --system --home-dir /var/lib/siteread --no-create-home --shell /usr/sbin/nologin siteread
install -d -m 0755 -o root -g root /srv/siteread /srv/siteread/releases
install -d -m 0700 -o root -g root /etc/siteread
# siteread.dev's own access log (HOSTING.md, requirement 2): the proxy writes it, root reads it.
install -d -m 0700 -o caddy -g caddy /var/log/siteread

# 5. Secrets. systemd reads the file as root before it drops to the service user.
if [ ! -f /etc/siteread/env ]; then
    (umask 077; {
        echo "# Read by siteread-cloud.service. Keep 0600, root only."
        echo "SITEREAD_OPERATOR_TOKEN=$(openssl rand -hex 32)"
        echo "SITEREAD_OPERATOR_ORIGIN=https://siteread.dev"
        echo '# SITEREAD_NAMED={"<share id>":"synacl.com"}'
    } > /etc/siteread/env)
    say "secrets: new operator token in /etc/siteread/env"
fi
chmod 0600 /etc/siteread/env
# siteread.dev shares its own week from here (self-share.sh); its id never leaves the VM.
install -d -m 0700 -o root -g root /var/lib/siteread-self /var/lib/siteread-self/.siteread
if [ ! -f /var/lib/siteread-self/.siteread/share-id ]; then
    (umask 077; openssl rand -hex 16 > /var/lib/siteread-self/.siteread/share-id)
fi
/opt/node/bin/node "$DEPLOY/named-env.mjs" /etc/siteread/env "$(cat /var/lib/siteread-self/.siteread/share-id)" siteread.dev | sed 's/^/install: named: /'

# 6. Units, proxy, firewall.
install -m 0644 "$DEPLOY/siteread-cloud.service" \
    "$DEPLOY/siteread-log-prune.service" "$DEPLOY/siteread-log-prune.timer" \
    "$DEPLOY/siteread-self-share.service" "$DEPLOY/siteread-self-share.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now siteread-log-prune.timer siteread-self-share.timer >/dev/null 2>&1
install -m 0644 "$DEPLOY/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; exit 1; }
systemctl reload-or-restart caddy
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
say "proxy and firewall: 22, 80, 443 open"

# 7. Switch, restart, check, prune.
ln -sfn "$RELEASE" /srv/siteread/current.new
mv -Tf /srv/siteread/current.new /srv/siteread/current
# The site's Node server from before it ran in the browser: Caddy serves its files now.
if [ -f /etc/systemd/system/siteread-site.service ]; then
    systemctl disable --now siteread-site >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/siteread-site.service
    systemctl daemon-reload
    say "site: the old Node server is stopped and removed"
fi
systemctl enable siteread-cloud >/dev/null 2>&1
systemctl restart siteread-cloud
ok=""
for _ in $(seq 1 30); do
    if curl -fs -o /dev/null http://127.0.0.1:8787/healthz; then ok=1; break; fi
    sleep 1
done
[ -n "$ok" ] || { systemctl --no-pager status siteread-cloud | tail -30; exit 1; }
say "live: $(readlink /srv/siteread/current)"
say "healthz: $(curl -fsS http://127.0.0.1:8787/healthz)"
ls -1dt /srv/siteread/releases/*/ | tail -n +6 | xargs -r rm -rf
