# siteread

Who read your site this week, was it good, and what should you write next.

Work in progress. See `CHARTER.md`.

- [`packages/verify`](packages/verify/README.md): npm `siteread`, checks a crawler's IP against its vendor's published list
  (phase 1), plus `siteread digest` and `share` for the weekly read (phases 2 and 3).
- [`skill/`](skill/README.md): the Claude Code skill `seo-read` that writes the weekly memo (phase 2).
- [`cloud/`](cloud/README.md): the merged crawler-list feed, the `share` endpoint and the aggregate job (phase 3, not deployed yet).
