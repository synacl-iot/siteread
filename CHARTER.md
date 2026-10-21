# siteread — charter

Decided 2026-10-21. Working name; the domain is not registered yet.

## What it is

A free, open-source way for builders to answer "who read my site this week, was it good, and what
should I write next" from three things they already have: a server log, a Search Console export and
a read beacon. It is the pipeline Synacl Labs built for synacl.com over Sept–Oct 2026, taken out of
that codebase and made general.

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

Default until the owner sets it: **4 h owner time + one agent session (~half a day) per week.**

| Week | Spent | What |
|---|---|---|
| 2026-W43 | one agent session (~15 min wall, 38 tool calls) + owner's design discussion | charter, skeleton, **phase 1 done**: `packages/verify` 42 tests, CLI verified live |

## Owner decisions pending

- Register the domain. Checked 2026-10-21: `siteread.dev` free (recommended), `.fyi` `.report` `.sh` `.page` free,
  `.com` `.io` `.app` taken. npm `siteread` and PyPI `siteread` free.
- ~~GitHub owner~~ decided 2026-10-21: `synacl-iot/siteread`, created private; flip to public when the README and
  licence copy are approved.
- The weekly hour number.
- License (default MIT).

## Non-goals

- Prompt-tracking / "does ChatGPT mention my brand" (Profound, Peec, Otterly do this; we read logs).
- Blocking or rate-limiting crawlers (Cloudflare does this).
- A dashboard. The output is a memo.
- Any feature that needs hostnames or visitor IPs to leave the user's machine.

## Where the code came from

Ported from `iotoneweb/iotone` (the Synacl backend keeps its own copies; nothing flows back):
`services/ai_ip_ranges.js`, `AGENTS` in `services/ai_traffic.js`, `CRAWLER_RE` in `services/edge_log.js`,
`PROBE_RE` in `services/access_log.service.js`, `landing/assets/read-beacon.js`, and the memo method in
`.claude/archives/2026-09-10-seo-audit-growth-plan.md` (Measurement log).
