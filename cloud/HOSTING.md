# Hosting siteread.dev: requirements

What a machine needs to provide to run siteread's service and public site. Written for whoever
decides where it runs (a person or an agent), so it can be checked item by item against a
candidate VM. Numbers were measured on 2026-10-21 unless marked as estimates.

## What runs

Two long-running Node processes, both listening on `127.0.0.1` only, behind a TLS reverse proxy:

| Process | Serves | Command | Port |
|---|---|---|---|
| `cloud` | `api.siteread.dev`: the crawler-list feed, the `share` endpoint, the benchmark JSON | `node cloud/bin/serve.js --port 8787 --data <data dir> --public-url https://siteread.dev` | 8787 |
| `site` | `siteread.dev`: the public pages (Angular, server-rendered) | `node site/server/server.mjs` | 4000 |

- `cloud` has zero npm dependencies. It runs its two jobs on internal timers (feed every 6 h,
  aggregate hourly). Alternatively, start it with `--no-jobs` and run
  `node cloud/bin/job.js feed|aggregate --data <data dir>` from systemd timers.
- `site` is a self-contained server bundle built elsewhere; the VM gets the built files only.
- **Node 24 LTS.** The site's server needs Node `^22.22.3 || ^24.15 || >=26`, and `cloud` needs ≥ 20.

## Footprint

| | cloud (measured) | site (estimate, re-measured once built) |
|---|---|---|
| Memory (RSS) | 58 MB idle, 71 MB after a feed build, ~100 MB after a burst of 200 requests | 100–150 MB |
| CPU | a feed build takes 1.3–3 ms (10.6 ms cold); a share is well under that | light; one render per `/benchmark` miss, cached 5 min |
| Disk | under 5 MB a year (a share row is ~0.5 KB; the feed is 15.3 KB) | ~5–10 MB of built files |
| Traffic | the feed is 15.3 KB; even 10,000 fetches a day is ~4.6 GB a month before gzip | small |

Suggested caps per process: `MemoryMax=256M`, a low `CPUQuota` (e.g. 25 %).

## Network

- **Inbound:** HTTPS on 443 for `siteread.dev`, `www.siteread.dev` (permanent redirect to the
  apex) and `api.siteread.dev`. `.dev` is HSTS-preloaded, so HTTPS only; certificates from
  Let's Encrypt via the proxy. Port 80 only for ACME and redirects.
- **Outbound:** HTTPS GETs every 6 h to the crawler vendors' public IP lists, on these hosts:
  `openai.com`, `www.perplexity.com`, `search.developer.apple.com`, `claude.com`,
  `developers.google.com`, `www.bing.com`. Nothing else.
- **Proxy routes:** `api.siteread.dev` → `127.0.0.1:8787`, `siteread.dev` → `127.0.0.1:4000`.
  Pass the `Host` header through.

## Privacy: hard requirements

siteread promises its users that the service never keeps the IP address of anyone who sends a share
or fetches the feed. The application code never reads it. The host must not keep it either:

1. **No access log with client IPs** for these three names. Caddy writes none unless a `log`
   directive is added. nginx needs `access_log off;` in these server blocks.
2. **No client IPs in error logs.** nginx's `error_log` lines carry `client: <ip>`. For these
   server blocks, set `error_log` to a level or destination that does not keep them (`crit`, or
   `/dev/null`).
3. **Nothing else that persists client IPs** for these names: no WAF or fail2ban log, no
   analytics, no log shipping of these vhosts.
4. **Allowed:** in-memory rate limiting (nginx `limit_req`, Caddy rate-limit), because it is never
   written down.
5. **How to check:** send a request from a known IP to each name, including one that is refused (a
   `POST /v1/share` with a 20 KB body), then `grep -r <that ip> /var/log` must find nothing that
   belongs to these names.

## Proxy limits

- Request body for `POST /v1/share`: at most 16 KiB at the proxy (the app refuses over 8 KiB itself).
- An optional per-IP rate limit on `/v1/share`, in memory only, e.g. 30 a minute.
- No caching rules are needed: the app sends its own `cache-control` (feed and benchmark: one hour;
  `/benchmark` page: 5 minutes).

## Isolation

This matters most if the VM already runs other production services, since `POST /v1/share` is a
public endpoint that anyone can call without authentication:

- **Users and permissions:** a dedicated system user (e.g. `siteread`) owns only the data dir
  (mode 0700). It has no access to other services' files, secrets, databases or internal network
  ports.
- **systemd hardening** for both units: `ProtectSystem=strict`, `ReadWritePaths=<data dir>`,
  `ProtectHome=yes`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, `RestrictAddressFamilies=AF_INET
  AF_INET6 AF_UNIX`, plus the memory and CPU caps above.
- **What it would share** with neighbours: the kernel, the reverse proxy process and its config, the
  public IP (a reverse-IP lookup would show the other sites on it), and the Node runtime if
  installed system-wide.
- **Blast radius both ways:** a bug in siteread must not reach the neighbours, and a neighbour's
  deploy or proxy reload must not take siteread down for long (best effort is fine, see below).

## Data, backup, availability

- **Data:** one directory, one file per key. The only irreplaceable data is `shares/` and `sites/`
  (what people chose to share). The feed rebuilds itself on the next run.
- **Backup:** a daily copy of the data dir is enough.
- **Availability:** best effort, no SLA.
  - The feed is opt-in for clients; they keep their copy for 8 days and fall back to the vendors.
  - `share` is opt-in and can be retried.
  - An outage costs freshness, nothing else.

## Secrets

- `SITEREAD_OPERATOR_TOKEN`: unlocks the private operator status page.
- `SITEREAD_NAMED`: maps one site's share id to its public name, which makes it a write credential
  for that row.

Both go in a root-owned, mode 0600 systemd `EnvironmentFile`, never in the repository or the unit
file. If the jobs run from timers (`--no-jobs`), the timer units load the same file: an aggregate
run without `SITEREAD_NAMED` publishes the benchmark without its named row (it warns on stderr).
Optional: `SITEREAD_OPERATOR_ORIGIN` (default `https://siteread.dev`), the one origin allowed to
call the operator route from a browser.

## Deploy

Build on the owner's machine, ship the output; the VM needs no repository access, no npm and no
build headroom.

- **Ship:** `cloud/` together with `packages/verify/src/` in the same relative layout (cloud imports
  it by relative path), and the built site (`site/dist/site/`, its `browser/` and `server/`
  folders).
- **How:** `rsync` over SSH into a new release directory, then switch a `current` symlink and
  restart both units. A script and the two unit files will live in this repository under
  `cloud/deploy/`; the host only needs a user to SSH in as and the paths.
- **Data stays put:** the data dir lives outside the release directories.

## DNS

The domain is registered at Namecheap and sits on Namecheap's DNS with its default parking page and
email forwarding switched on.

| Record | Value |
|---|---|
| `siteread.dev` A / AAAA | the VM |
| `api.siteread.dev` A / AAAA (or CNAME to the apex) | the VM |
| `www.siteread.dev` CNAME | `siteread.dev` (the proxy redirects) |
| `siteread.dev` MX | `0 .` (null MX; the domain sends no mail), or no MX at all |
| `siteread.dev` TXT | `v=spf1 -all` |
| `_dmarc.siteread.dev` TXT | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` |
| `siteread.dev` CAA | `0 issue "letsencrypt.org"` (add the proxy's fallback CA if it has one: Caddy's is ZeroSSL, `sectigo.com`) |
| delete | the parking A record (`162.255.119.221`), the email-forwarding MX records and their SPF TXT |

## Branding

siteread is its own product: nothing on siteread.dev (pages, headers, error pages, certificates)
carries another product's name or look. Sharing a machine or an IP with other sites is fine.

## What to answer

For each candidate machine:

1. Free RAM, disk and CPU headroom now, against the footprint above.
2. Its Node version, or whether Node 24 can sit beside what runs there (e.g. a separate install
   for the `siteread` user).
3. The reverse proxy it runs and how that proxy logs today, and whether privacy requirements 1–5
   can be met without changing logging for anything else on the box.
4. Whether isolation can be met as written, and what would still be shared.
5. The risks to the services already on it, and how bad the worst plausible siteread failure would
   be for them.
6. The recommendation, compared with a new small VM (1 vCPU, 1 GB) on the same account.
