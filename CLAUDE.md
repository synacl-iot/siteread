# CLAUDE.md — siteread

Open-source "who read my site this week, was it good, what next" tool for builders. Read `CHARTER.md` first:
the principles there are settled. This is a SIDE project of Synacl Labs with a weekly time cap; when the
cap is spent, stop and say so.

## Layout

| Dir | What |
|---|---|
| `packages/verify/` | npm `siteread`: crawler verification (vendor IP lists + UA table + scanner signatures), CLI |
| `skill/` | Claude Code skill `seo-read`: GSC export + log + beacons → weekly memo (phase 2) |
| `cloud/` | list feed + `share` endpoint + aggregate job (phase 3) |
| `site/` | siteread.dev in Angular 22 with SSR: home, benchmark with `n`, docs from the READMEs, privacy, private operator page (phase 3) |

## Starting a session here

- State: phases 1 (`packages/verify`) and 2 (`siteread digest` + `skill/seo-read`) done 2026-10-21. Phase 3's
  `cloud/` (feed, `share` endpoint, aggregate job, operator status) and `siteread share` (0.2.1) built in PR #2, not
  95 tests (`npm test` in `packages/verify` and in `cloud`). `site/` built 2026-10-22 in the Ledger look
  (owner's pick) on `phase3-site`, PR #3, stacked on PR #2: Angular 22 with SSR, its deps in `site/`
  only, Node ≥ 22.22 for the site alone, 42 tests (`npm test` in `site`). Both deployed 2026-10-22 from `phase3-site`
  to the owner's new Vultr VM (Frankfurt, 80.240.29.219) with `cloud/deploy/ship.sh root@<vm>` (build here, ship
  `dist/`; `install.sh` provisions); `https://siteread.dev` is live. DNS is at Namecheap, the owner's to edit. npm
  `siteread` 0.2.1 (this release, published by the owner 2026-10-22; the earlier 0.2.1 never reached npm) and a PyPI
  `siteread` 0.0.1 placeholder are the owner's publishes; the next npm release is 0.2.2, also the owner's to publish. The name `siteread` is final
  (owner's pick, domain `siteread.dev` bought 2026-10-21); further names stay the owner's call. Repo stays private until the owner says.
- The weekly cap in `CHARTER.md` starts after the initial release (the whole solution live end to end, cloud
  included); until then build. Once it applies, it is
  real: log the week's spend in its table, stop when spent, and say so.
- History before this repo existed lives in the Synacl workspace's memory (`project_siteread_side_tool`,
  `project_seo_audit_sept`, `project_ai_traffic_view`) and the archive
  `iotoneweb/.claude/archives/2026-09-10-seo-audit-growth-plan.md` (Measurement log = the memo shape to copy).
- Working style carried over from the owner: names, domains, bylines and prices are the owner's decisions,
  present checked candidates; verify the outcome (run the thing), not the report; write-ups go in an HTML
  artifact, not chat tables; subagents run on Opus; never `git stash`; no Playwright QA, hand over a checklist.

## Rules

- Node ≥ 20, ESM, zero runtime dependencies in `packages/verify`. Tests with `node:test`, never jest.
- Nothing here imports from or writes to `../iotoneweb`. Port by copying; Synacl keeps its copies. Never say where
  code came from: no "ported from" credits in code, READMEs, package metadata or the charter (owner, 2026-10-21).
  A measured story names "one site", not synacl.com.
- Never send hostnames, URLs or visitor IPs anywhere. `share` prints the exact payload before sending.
- On the VM, only `siteread.dev` keeps an access log (28 days, the owner's call); `api.siteread.dev` and `www` never
  log, and no error log may carry a client address (Caddy's `http` loggers stay excluded). `cloud/HOSTING.md` has why.
- The feed exists (api.siteread.dev/v1/lists.json), so the CLI reads it by default as the charter says (opt-out:
  `--no-feed`), falling back to the vendors for anything it cannot give. The library defaults to the vendors, which
  cloud's feed job relies on.
- Keep the WHY comments: they are the product knowledge (the 444 rule, the ClaudeBot
  README-link incident, Claude-User from claude-code being the user's own IP, Google-Extended never being a UA).
- No Synacl branding in this repo. Synacl appears only as the first honest data row and in the post's byline.
  The GitHub home is `synacl-iot/siteread` (origin): the org is the maker, which is not branding.
