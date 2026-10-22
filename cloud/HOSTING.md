# Hosting siteread.dev: requirements

What a machine needs to provide to run siteread's service and public site. Written for whoever
decides where it runs (a person or an agent), so it can be checked item by item against a
candidate VM. Numbers were measured on 2026-10-21 unless marked as estimates.

## What runs

One long-running Node process, listening on `127.0.0.1` only, behind a TLS reverse proxy that also
serves the site's files:

| What | Serves | How | Port |
|---|---|---|---|
| `cloud` | `api.siteread.dev`: the crawler-list feed, the `share` endpoint, the benchmark JSON | `node cloud/bin/serve.js --port 8787 --data <data dir> --public-url https://siteread.dev` | 8787 |
| `site` | `siteread.dev`: the public pages (Angular, client-only) | static files from `site/browser/`, served by the proxy | — |

- `cloud` has zero npm dependencies. It runs its two jobs on internal timers (feed every 6 h,
  aggregate hourly). Alternatively, start it with `--no-jobs` and run
  `node cloud/bin/job.js feed|aggregate --data <data dir>` from systemd timers.
- `site` runs in the browser, built elsewhere; the VM gets the built files only. Every page path
  gets the one `index.html` shell; any other path that is not a file gets it too, with a 404.
- **Node 24 LTS.** `cloud` needs ≥ 20.

## Footprint

| | cloud (measured) | site |
|---|---|---|
| Memory (RSS) | 58 MB idle, 71 MB after a feed build, ~100 MB after a burst of 200 requests | none of its own: the proxy serves files |
| CPU | a feed build takes 1.3–3 ms (10.6 ms cold); a share is well under that | file serving only; each `/benchmark` view is one `benchmark.json` fetch from the browser, cacheable an hour |
| Disk | under 5 MB a year (a share row is ~0.5 KB; the feed is 15.3 KB) | under 1 MB of built files |
| Traffic | the feed is 15.3 KB; even 10,000 fetches a day is ~4.6 GB a month before gzip | small |

Suggested caps for `cloud`: `MemoryMax=256M` and a low `CPUQuota` (e.g. 25 %). Linux with Node 24 may measure differently; re-check on the VM.

## Network

- **Inbound:** HTTPS on 443 for `siteread.dev`, `www.siteread.dev` (permanent redirect to the
  apex) and `api.siteread.dev`. `.dev` is HSTS-preloaded, so HTTPS only; certificates from
  Let's Encrypt via the proxy. Port 80 only for ACME and redirects.
- **Outbound:** HTTPS GETs every 6 h to the crawler vendors' public IP lists, on these hosts:
  `openai.com`, `www.perplexity.com`, `search.developer.apple.com`, `claude.com`,
  `developers.google.com`, `www.bing.com`. Nothing else.
- **Proxy routes:** `api.siteread.dev` → `127.0.0.1:8787`; `siteread.dev` → the files in `site/browser/`.
  Pass the `Host` header through.

## Privacy: hard requirements

siteread promises its users that the service never keeps the IP address of anyone who sends a share
or fetches the feed. The application code never reads it. The host must not keep it either:

1. **No access log with client IPs for `api.siteread.dev` or `www.siteread.dev`.** Caddy writes
   none unless a `log` directive is added. nginx needs `access_log off;` in these server blocks.
2. **The one exception: `siteread.dev`'s own access log** (the owner's decision, 2026-10-22), so
   siteread can read its own site like any of its users' sites. Page requests only, in a folder
   only root and the proxy can read, every line gone after 28 days; the privacy page says so. A
   share or a feed fetch never goes to this name, so it cannot tie a share to an address.
3. **No client IPs in error logs, for any of the three.** nginx's `error_log` lines carry
   `client: <ip>`; set it to a level or destination that does not keep them (`crit`, or
   `/dev/null`). Caddy logs every failed request (a 502 while an upstream restarts) under
   `http.log.error` with the client's IP and user-agent, access log or not: exclude its `http`
   loggers from the default log, as `deploy/Caddyfile` does. Learned on the first deploy.
4. **Nothing else that persists client IPs** for these names: no WAF or fail2ban log, no
   analytics, no log shipping of these vhosts.
5. **Allowed:** in-memory rate limiting (nginx `limit_req`, Caddy rate-limit), because it is never
   written down.
6. **How to check:** send a request from a known IP to each name, including one that is refused (a
   `POST /v1/share` with a 20 KB body) and one that fails upstream, then `grep -r <that ip> /var/log`
   and the journal must find nothing outside `siteread.dev`'s own access log.

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
  it by relative path), and the built site (`site/dist/site/`, its `browser/` folder).
- **How:** `rsync` over SSH into a new release directory, then switch a `current` symlink and
  restart the service. A script and the unit files will live in this repository under
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
