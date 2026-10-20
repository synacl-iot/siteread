# CLAUDE.md — whofetched

Open-source "who read my site this week, was it good, what next" tool for builders. Read `CHARTER.md` first:
the principles there are settled. This is a SIDE project of Synacl Labs with a weekly time cap; when the
cap is spent, stop and say so.

## Layout

| Dir | What |
|---|---|
| `packages/verify/` | npm `whofetched`: crawler verification (vendor IP lists + UA table + scanner signatures), CLI |
| `skill/` | Claude Code skill `seo-read`: GSC export + log + beacons → weekly memo (phase 2) |
| `cloud/` | list feed + `share` endpoint + aggregate job (phase 3) |
| `site/` | static public page: benchmark with `n`, docs (phase 3) |

## Rules

- Node ≥ 20, ESM, zero runtime dependencies in `packages/verify`. Tests with `node:test`, never jest.
- Nothing here imports from or writes to `../iotoneweb`. Port by copying and crediting; Synacl keeps its copies.
- Never send hostnames, URLs or visitor IPs anywhere. `share` prints the exact payload before sending.
- Vendor lists are fetched from the vendors by default; the feed is an opt-in override until it exists.
- Keep the WHY comments from the ported code: they are the product knowledge (the 444 rule, the ClaudeBot
  README-link incident, Claude-User from claude-code being the user's own IP, Google-Extended never being a UA).
- No Synacl branding in this repo. Synacl appears only as the first honest data row and in the post's byline.
