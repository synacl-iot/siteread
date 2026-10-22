# siteread.dev

The public site (home, benchmark, docs, privacy) and the private operator page, in Angular 22,
static: the build prerenders the public pages into HTML and nothing runs on the server. Its npm dependencies live in
this folder only: `packages/verify` stays at zero. Node `^22.22.3 || ^24.15 || >=26`, for this folder alone.

```sh
npm ci
npm start          # dev server on :4200, using the API at http://127.0.0.1:8787
npm test           # Vitest
npm run build      # dist/site/browser/: a prerendered index.html per public page, index.csr.html, the hashed bundles, fonts, robots.txt, sitemap.xml
```

Each script first runs `npm run docs`: `scripts/docs.mjs` renders the docs page from named sections
of the repo's READMEs into `src/app/generated/` (gitignored), so the page cannot drift from them.

## Pages

The public pages are prerendered at build time (`outputMode: "static"`, `src/app/app.routes.server.ts`),
so crawlers and AI agents that run no JavaScript read their text; the browser then hydrates the same
HTML. The rest comes from the plain shell, `index.csr.html`. The proxy (in the hosted service's
private repo) sends each path its file with the headers below, and the bundles they name by their hashes.

| Path | File | Headers | |
|---|---|---|---|
| `/`, `/docs`, `/privacy` | `index.html`, `docs/index.html`, `privacy/index.html` | `no-cache` | change only with a release |
| `/benchmark` | `benchmark/index.html` | `no-cache` | holds the numbers as of the build, stamped `built <time>`; once running, the browser fetches `api.siteread.dev/v1/benchmark.json` and shows the live numbers over them. A build that cannot reach the service still succeeds, and the page says the service did not answer until the live fetch does |
| `/operator` | `index.csr.html` | `no-store`, `noindex` | the token lives in a component signal, never in storage or the URL; disallowed in `robots.txt` |
| anything else that is not a file | `index.csr.html` | 404 | the shell, which shows the not-found page |

The benchmark snapshot is only as fresh as the last deploy, for readers without JavaScript; a
scheduled rebuild would narrow that without a server.

## Configuration

| | |
|---|---|
| The API address the browser uses | build time, `angular.json` `define`: production `https://api.siteread.dev`, development `http://127.0.0.1:8787` |

The operator page calls `GET /v1/operator/status` from the browser, so the service must allow this
page's origin: `SITEREAD_OPERATOR_ORIGIN` (`https://siteread.dev` by default; `http://localhost:4200`
for `npm start`).

## Deploy

Built on the owner's machine; only `dist/site/` goes to the server, where Caddy serves its
`browser/` folder. Nothing in it runs there. The proxy and the rest of the host are in the hosted
service's private repo.

## Privacy

- siteread.dev's access log is the proxy's, the one the privacy page describes; the site adds none.
- No cookies, analytics or third-party requests. The fonts are served from this site
  (`public/fonts/`, SIL Open Font License 1.1, each licence beside its font), because a font CDN
  would see every visitor's IP.
