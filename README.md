# siteread

Who read your site this week, was it good, and what should you write next.

Work in progress. See `CHARTER.md`.

- [`packages/verify`](packages/verify/README.md): npm `siteread`, checks a crawler's IP against its vendor's published list
  (phase 1), plus `siteread digest` and `share` for the weekly read (phases 2 and 3).
- [`plugins/siteread/`](plugins/siteread/README.md): the Claude Code plugin with the `seo-read` skill that writes the weekly
  memo (phase 2); this repo is its marketplace (`claude plugin marketplace add synacl-iot/siteread`).
- The hosted service at api.siteread.dev (closed source): the merged crawler-list feed, the `share` endpoint and the
  aggregate job (phase 3).
- [`site/`](site/README.md): siteread.dev itself (phase 3).
