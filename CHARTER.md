# siteread — charter

Decided 2026-10-21. Name `siteread`, domain `siteread.dev` (owned), GitHub `synacl-iot/siteread`.

## What it is

A free, open-source way for builders to answer "who read my site this week, was it good, and what
should I write next" from three things they already have: a server log, a Search Console export and
a read beacon.

For: indie builders and developers who use AI tools and run a content-driven site. Not Synacl's
IoT customers. Different audience, different brand, different domain.

## Principles (settled, don't re-litigate)

1. **Separate from Synacl, made by Synacl Labs.** Own domain and own name; the repo lives under the
   company's GitHub org (`synacl-iot/siteread`) because the maker is named honestly. synacl.com gets
   one story post that links here. Nothing of this product's docs, benchmark or changelog lives on synacl.com.
2. **Honest.** Synacl's own numbers are public and named: the first row in the benchmark and the
   worked example in the post. Small, growing and dated beats big and vague. The failures ship.
3. **Time-capped.** A fixed weekly budget (owner sets the number; default below). When it is spent
   the work stops and says so. The Monday read stays about Synacl.
4. **Free first, data by reciprocity.** Local tools send nothing. The only network paths are the
   merged crawler-list feed (opt-out) and `share` (opt-in, prints what it sends, returns where each
   number stands among the published quartiles). Never hostnames, URLs or visitor IPs. Aggregates only.
5. **Paid is deferred.** Revisit after a quarter, and only on repeated "how does my site compare"
   demand. Download counts and stars are not demand.

## Deliverables

| Phase | What | Done when |
|---|---|---|
| 1 | `packages/verify` — npm `siteread`: crawler verification lib + CLI | `npx siteread check <ip> "<ua>"` answers verified / spoofed / unknown from live vendor lists; tests green; README tells the ClaudeBot story |
| 2 | `plugins/siteread/` (was `skill/`) — Claude Code skill `seo-read`: GSC export + log file (+ beacon rollup) → weekly memo | Produces a memo in the Synacl Measurement-log shape from a stranger's inputs without editing the skill |
| 3 | `cloud/` + `site/` — list feed, `share` endpoint, public aggregate page with `n` printed | Synacl is row 1; the page is linkable; `share` round-trips |
| 4 | The post on synacl.com/guides/ with real numbers, linking the package and the skill | Live, IndexNow'd, posted to dev.to + HN |

Python twin: later, as a thin client of the feed, not a port.

## Weekly budget

Set by the owner 2026-10-21: **one day a week, under 6 h, starting after the initial release.** Until
then the build runs at full pace. The initial release is the whole solution live end to end, cloud
included: package, skill, list feed, `share` endpoint, aggregate job and the public page.

| Week | Spent | What |
|---|---|---|
| 2026-W43 | one agent session (~15 min wall, 38 tool calls) + owner's design discussion | charter, skeleton, **phase 1 done**: `packages/verify` 42 tests, CLI verified live |
| 2026-W43 | agent sessions for phase 2 and release prep + owner's publishes (pre-release, cap not in force) | **phase 2 done** (PR #1): `siteread digest` + `seo-read` skill, 60 tests; npm `siteread` 0.2.0 (a 0.2.1 was prepared but never reached npm; phase 3 shipped as 0.2.1, published 2026-10-22), PyPI `siteread` 0.0.1 placeholder |
| 2026-W43 | one agent session for phase 3's cloud part (pre-release, cap not in force) | **`cloud/` built, not deployed** (PR #2): feed, `share` endpoint, aggregate job; `siteread share` in the CLI (0.3.0, unpublished); 87 tests; feed and share round-trip against a local server. `site/` next |
| 2026-W43 | one agent session (pre-release, cap not in force) | hosting brief `cloud/HOSTING.md` (Vultr: existing VM or a new one); operator status, live named row, quartiles from 10 anonymous sites (PR #2); 95 tests; siteread.dev page mockup for the owner's sign-off. `site/` (Angular 22, SSR) after sign-off |
| 2026-W43 | one agent session (pre-release, cap not in force) | site look decided (A · Ledger, from six directions); **`site/` built, not deployed** (PR #3): Angular 22 SSR, home, benchmark (early, populated, unavailable), docs rendered from the READMEs, privacy, operator; 42 tests; shipped-bundle and end-to-end checks against a local `cloud`; SSR memory measured into HOSTING.md; deployed to a new Vultr VM with `cloud/deploy/` (siteread.dev live; `api`/`www` wait on DNS); found and closed Caddy logging client IPs on failed requests |

## Owner decisions pending

- ~~Register the domain~~ done 2026-10-21: **`siteread.dev`** bought ($11/yr). Parked, no DNS until phase 3.
  `.com` `.io` `.app` are taken; nothing else was bought.
- ~~GitHub owner~~ decided 2026-10-21: `synacl-iot/siteread`, created private; flip to public when the README and
  licence copy are approved. Held private by the owner 2026-10-21; made public by the owner 2026-10-22.
- ~~The weekly hour number~~ set 2026-10-21: one day a week, under 6 h (see Weekly budget).
- ~~License~~ decided 2026-10-21: MIT.
- ~~Claim npm `siteread` and PyPI `siteread`~~ done 2026-10-21 by the owner: npm 0.2.0, PyPI 0.0.1 (a placeholder
  that points to npm until the Python twin exists).
- ~~Phase 3 hosting and `siteread.dev` DNS~~ decided 2026-10-22 by the owner: a new Vultr VM of its own (Frankfurt,
  1 vCPU, 1 GB, Debian 13), set up and deployed by `cloud/deploy/` the same day; DNS stays at Namecheap. The page is
  `siteread.dev`, the service `api.siteread.dev`, the CLI's default share address (`packages/verify/src/share.js`).
- `share` defaults, set in PR #2 and the owner's to change: a new site pays a proof of work whose price rises with the
  day's new sites (2026-10-22, replacing a cap of 100 a day that one sender could use up), each site's latest share within
  4 weeks compared, a random per-site id kept in `.siteread/share-id`. Decided 2026-10-22 by the owner: the benchmark
  publishes the 25th/50th/75th percentiles only, from 10 anonymous sites per metric (five percentiles from 5 sites gave
  every value back). Named rows, the owner's pick 2026-10-22: synacl.com (from Synacl's own weekly share, which the
  Synacl side runs) and siteread.dev (shared daily by its own VM from its own log, latest 7 days).
- ~~Does siteread read its own site?~~ decided 2026-10-22 by the owner: yes. `siteread.dev` keeps an access log (Caddy
  JSON, root-only on the VM, every line deleted after 28 days; `cloud/deploy/pull-log.sh` mirrors it for the weekly
  read). `api.siteread.dev` and `www` keep none, so a share or a feed fetch is never tied to an address. The privacy
  page says so.
- ~~Site look~~ decided 2026-10-22 by the owner: **A · Ledger** (cool slate, teal and orange, expanded grotesk, numbers
  in mono), from six directions on a private mockup canvas (https://claude.ai/artifact/TLSBMYHxqw5NKxpYWnVXaK). `site/`
  is Angular 22 with SSR (owner's pick), built on the owner's machine with only `dist/` shipped. Still open: whether the
  footer credits the maker, and synacl.com's row label ("the site siteread was first built to read").

## Non-goals

- Prompt-tracking / "does ChatGPT mention my brand" (Profound, Peec, Otterly do this; we read logs).
- Blocking or rate-limiting crawlers (Cloudflare does this).
- A dashboard. The output is a memo. (The private operator page on siteread.dev shows the service's own health to
  its operator; it is not a product feature.)
- Any feature that needs hostnames or visitor IPs to leave the user's machine.
