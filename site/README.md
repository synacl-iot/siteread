# siteread.dev

The public site (home, benchmark, docs, privacy) and the private operator page, in Angular 22,
client-only: the build is static files and nothing runs on the server. Its npm dependencies live in
this folder only: `packages/verify` stays at zero. Node `^22.22.3 || ^24.15 || >=26`, for this folder alone.

```sh
npm ci
npm start          # dev server on :4200, using the API at http://127.0.0.1:8787
npm test           # Vitest
npm run build      # dist/site/browser/: index.html, the hashed bundles, fonts, robots.txt, sitemap.xml
```

Each script first runs `npm run docs`: `scripts/docs.mjs` renders the docs page from named sections
of the repo's READMEs into `src/app/generated/` (gitignored), so the page cannot drift from them.

## Pages

Every page is rendered in the browser from the one `index.html`. The proxy (in the hosted service's private repo)
sends that shell for each page path with the headers below, and the bundles it names by their hashes.

| Path | Headers | |
|---|---|---|
| `/`, `/docs`, `/privacy`, `/benchmark` | `no-cache` | the benchmark fetches `api.siteread.dev/v1/benchmark.json` before it renders; when the service does not answer within 3 s the page says so |
| `/operator` | `no-store`, `noindex` | the token lives in a component signal, never in storage or the URL; disallowed in `robots.txt` |
| anything else that is not a file | 404 | the shell, which shows the not-found page |

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
