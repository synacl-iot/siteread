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
   merged crawler-list feed (opt-out) and `share` (opt-in, prints what it sends, returns a
   percentile). Never hostnames, URLs or visitor IPs. Aggregates only.
5. **Paid is deferred.** Revisit after a quarter, and only on repeated "how does my site compare"
   demand. Download counts and stars are not demand.

## Deliverables

| Phase | What | Done when |
|---|---|---|
| 1 | `packages/verify` — npm `siteread`: crawler verification lib + CLI | `npx siteread check <ip> "<ua>"` answers verified / spoofed / unknown from live vendor lists; tests green; README tells the ClaudeBot story |
| 2 | `skill/` — Claude Code skill `seo-read`: GSC export + log file (+ beacon rollup) → weekly memo | Produces a memo in the Synacl Measurement-log shape from a stranger's inputs without editing the skill |
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
| 2026-W43 | agent sessions for phase 2 and release prep + owner's publishes (pre-release, cap not in force) | **phase 2 done** (PR #1): `siteread digest` + `seo-read` skill, 60 tests; npm `siteread` 0.2.0 → 0.2.1, PyPI `siteread` 0.0.1 placeholder |
| 2026-W43 | one agent session for phase 3's cloud part (pre-release, cap not in force) | **`cloud/` built, not deployed** (PR #2): feed, `share` endpoint, aggregate job; `siteread share` in the CLI (0.3.0, unpublished); 87 tests; feed and share round-trip against a local server. `site/` next |
| 2026-W43 | one agent session (pre-release, cap not in force) | hosting brief `cloud/HOSTING.md` (Vultr: existing VM or a new one); operator status, live named row, quartiles from 10 anonymous sites (PR #2); 95 tests; siteread.dev page mockup for the owner's sign-off. `site/` (Angular 22, SSR) after sign-off |

## Owner decisions pending

- ~~Register the domain~~ done 2026-10-21: **`siteread.dev`** bought ($11/yr). Parked, no DNS until phase 3.
  `.com` `.io` `.app` are taken; nothing else was bought.
- ~~GitHub owner~~ decided 2026-10-21: `synacl-iot/siteread`, created private; flip to public when the README and
  licence copy are approved. Held private by the owner 2026-10-21.
- ~~The weekly hour number~~ set 2026-10-21: one day a week, under 6 h (see Weekly budget).
- ~~License~~ decided 2026-10-21: MIT.
- ~~Claim npm `siteread` and PyPI `siteread`~~ done 2026-10-21 by the owner: npm 0.2.0, PyPI 0.0.1 (a placeholder
  that points to npm until the Python twin exists).
- Phase 3 hosting (feed, `share`, aggregate job, public page) and `siteread.dev` DNS: owner picks from checked candidates
  (PR #2's write-up). The CLI's default share address, `https://api.siteread.dev/v1/share` (`packages/verify/src/share.js`),
  follows the DNS pick.
- `share` defaults, set in PR #2 and the owner's to change: at most 100 new sites a day, each site's latest share within
  4 weeks compared, a random per-site id kept in `.siteread/share-id`. Decided 2026-10-22 by the owner: the benchmark
  publishes the 25th/50th/75th percentiles only, from 10 anonymous sites per metric (five percentiles from 5 sites gave
  every value back); synacl.com is the named row, live from its own share.
- Hosting: the owner wants Vultr (one bill with Synacl); `cloud/HOSTING.md` is the brief for choosing between an
  existing VM and a new small one.
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
