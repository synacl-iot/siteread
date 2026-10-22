# siteread.dev

The public site (home, benchmark, docs, privacy) and the private operator page, in Angular 22
with server-side rendering. Its npm dependencies live in this folder only: `packages/verify` stays at
zero. Node `^22.22.3 || ^24.15 || >=26`, for this folder alone.

```sh
npm ci
npm start          # dev server on :4200; the browser and the server use the API at http://127.0.0.1:8787
npm test           # Vitest
npm run build      # dist/site/: browser/ (static and prebuilt pages) and server/ (the SSR bundle)
npm run serve      # node dist/site/server/server.mjs on :4000
```

Each script first runs `npm run docs`: `scripts/docs.mjs` renders the docs page from named sections
of the repo's READMEs into `src/app/generated/` (gitignored), so the page cannot drift from them.

## Pages

| Path | Rendered | |
|---|---|---|
| `/`, `/docs`, `/privacy` | at build time | change only with a release; cached 10 min |
| `/benchmark` | per request, on the server | the numbers are in the HTML, for crawlers and AI agents that run no JavaScript; cacheable 5 min. When the service does not answer within 3 s: a 503 with `retry-after` and `no-store`, so no cache keeps an empty benchmark |
| `/operator` | in the browser only | the token lives in a component signal, never in storage or the URL; `noindex`, `no-store`, disallowed in `robots.txt` |
| anything else | on the server | 404 |

## Configuration

| | |
|---|---|
| The API address the browser uses | build time, `angular.json` `define`: production `https://api.siteread.dev`, development `http://127.0.0.1:8787` |
| `SITEREAD_API_INTERNAL` | the SSR server's own way to the service, default `http://127.0.0.1:8787`. Its answer reaches the browser through hydration's transfer cache, keyed by the public address, so the browser does not fetch again |
| `PORT`, `HOST` | default `4000`, `127.0.0.1` |
| Allowed `Host` headers | `siteread.dev`, `localhost`, `127.0.0.1` (`angular.json` `security.allowedHosts`); anything else gets a 400 |

The operator page calls `GET /v1/operator/status` from the browser, so the service must allow this
page's origin: `SITEREAD_OPERATOR_ORIGIN` (`https://siteread.dev` by default; `http://localhost:4200`
for `npm start`).

## Deploy

Built on the owner's machine; only `dist/site/` goes to the server, which needs no `node_modules`:
`node --max-old-space-size=96 server/server.mjs` from inside it. Memory, caps, the proxy and the
deploy itself are in the hosted service's private repo.

## Privacy

- `src/server.ts` writes no access log: no address, path or user-agent of any request.
- No cookies, analytics or third-party requests. The fonts are served from this site
  (`public/fonts/`, SIL Open Font License 1.1, each licence beside its font), because a font CDN
  would see every visitor's IP.
- Static files are served from a map built at startup, matched exactly; no request path is ever
  joined onto the folder.
