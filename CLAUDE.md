# CLAUDE.md — siteread

Open-source "who read my site this week, was it good, what next" tool for builders. Read `CHARTER.md` first:
the principles there are settled. This is a SIDE project of Synacl Labs with a weekly time cap; when the
cap is spent, stop and say so.

## Layout

| Dir | What |
|---|---|
| `packages/verify/` | npm `siteread`: crawler verification (vendor IP lists + UA table + scanner signatures), CLI |
| `plugins/siteread/` | Claude Code plugin `siteread` with the skill `seo-read`: GSC export + log → weekly memo (phase 2); the repo root's `.claude-plugin/marketplace.json` makes this repo its marketplace. Bump `plugin.json`'s `version` whenever the skill changes: installs update only on a new version |
| (none) | the hosted service behind siteread.dev and api.siteread.dev (list feed, `share` endpoint, aggregate job, deploy) is closed source, in the private repo `synacl-iot/siteread-cloud`, which pins this repo as a submodule |
| `site/` | siteread.dev in Angular 22, no SSR server (the owner's call): public pages prerendered at build, served as static files by Caddy: home, benchmark with `n`, docs from the READMEs, privacy, the account page (client-only, `noindex`; the operator page became the private repo's admin panel, 2026-10-22) |

## Starting a session here

- State (end of 2026-10-23): all four phases are live. `packages/verify` (npm `siteread` 0.2.2, published by the
  owner 2026-10-22; 77 tests), the `seo-read` skill as the Claude Code plugin `siteread` (`plugins/siteread/`),
  the hosted service (private repo) and `site/` (siteread.dev: home, benchmark, docs, privacy, blog with the launch
  post at `/blog/introducing-siteread`, `/account`; 47 tests, `npm test` in `site`, Node >= 22.22 for the site alone).
  PRs #1 to #18 are merged or closed; none is open. The repo has been public since 2026-10-22. The initial release
  completed 2026-10-22 17:22 UTC, so the weekly cap applies. Further npm releases and the PyPI `siteread` 0.0.1
  placeholder are the owner's publishes. The name `siteread` and the domain are final; further names stay the owner's call.
- Deploys: merge here, then pin this repo's `main` as the `public` submodule in the private repo and ship from there
  (build on the owner's machine, ship `dist/`). Merging a PR needs the owner's word "merge"; deploying needs "deploy".
- Server-side work and plans are tracked in the private repo's `docs/HANDOFF.md`, with dated session
  archives in its `docs/archives/`. Read it first when the work touches the service.
- Open on this repo's side (2026-10-24):
  - Mon 2026-10-26: run the `seo-read` skill on real data next to the owner's own Monday SEO review and compare the
    memos. It has not had a real-data run yet; this is its review. Fix what the run shows and bump the plugin version.
  - Around 2026-10-26: the first named row's weekly share (run on that site's side, not from here). Check the row renders.
  - Around 2026-10-29: siteread.dev's own first automatic share, once its log holds a full week; then its first
    weekly read.
  - Phase 4 is "done when" posted to dev.to and HN: both are the owner's to post. HN refused siteread.dev as a
    link for the owner's account (2026-10-23); the owner parked HN. If picked up again: a Show HN with the GitHub
    repo URL. Drafts are in the private repo's `docs/launch-drafts.md`.
  - Owner items not confirmed done: Namecheap's CAA record, no-mail records, a Search Console TXT for siteread.dev;
    the browser checklist (light/dark, phone width, copy buttons, keyboard only, the platinum headings); whether the
    footer credits the maker.
  - The Synacl workspace names under "History" below, and the "Port by copying" rule, mention `iotoneweb` in a
    public file. Flagged 2026-10-22, left for the owner.
- The weekly cap in `CHARTER.md` applies since the initial release (2026-10-22). It is real: log the week's spend
  in its table, stop when spent, and say so.
- History before this repo existed lives in the Synacl workspace's memory (`project_siteread_side_tool`,
  `project_seo_audit_sept`, `project_ai_traffic_view`) and the archive
  `iotoneweb/.claude/archives/2026-09-10-seo-audit-growth-plan.md` (Measurement log = the memo shape to copy).
- Working style carried over from the owner: names, domains, bylines and prices are the owner's decisions,
  present checked candidates; verify the outcome (run the thing), not the report; write-ups go in an HTML
  artifact, not chat tables; subagents run on Opus; never `git stash`; no Playwright QA, hand over a checklist.

## Rules

- All server code for siteread.dev and api.siteread.dev (free and paid) is closed source, in the private repo
  synacl-iot/siteread-cloud. This repo is PUBLIC: never commit server code, deploy config, server addresses,
  secrets, pricing or business plans here.
- Node ≥ 20, ESM, zero runtime dependencies in `packages/verify`. Tests with `node:test`, never jest.
- Nothing here imports from or writes to `../iotoneweb`. Port by copying; Synacl keeps its copies. Never say where
  code came from: no "ported from" credits in code, READMEs, package metadata or the charter (owner, 2026-10-21).
  A measured story names "one site", not synacl.com.
- Never send hostnames, URLs or visitor IPs anywhere. `share` prints the exact payload before sending.
- On the VM, only `siteread.dev` keeps an access log (28 days, the owner's call); `api.siteread.dev` and `www` never
  log, and no error log may carry a client address (Caddy's `http` loggers stay excluded). The private repo's `cloud/HOSTING.md` has why.
- The feed exists (api.siteread.dev/v1/lists.json), so the CLI reads it by default as the charter says (opt-out:
  `--no-feed`), falling back to the vendors for anything it cannot give. The library defaults to the vendors, which
  the hosted feed job relies on.
- Keep the WHY comments: they are the product knowledge (the 444 rule, the ClaudeBot
  README-link incident, Claude-User from claude-code being the user's own IP, Google-Extended never being a UA).
- No Synacl branding in this repo. Synacl appears only as the first honest data row and in the post's byline.
  The GitHub home is `synacl-iot/siteread` (origin): the org is the maker, which is not branding.
