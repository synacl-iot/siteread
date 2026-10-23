# siteread.dev

The public site (home, benchmark, docs, privacy, blog) and a person's account page, in Angular 22,
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
| `/blog`, `/blog/<slug>` | `blog/index.html`, `blog/<slug>/index.html` | `no-cache` | one entry per post in `src/app/pages/posts.ts`, with its own canonical and Open Graph tags (`src/app/seo.ts`); add each post to `public/sitemap.xml` too |
| `/benchmark` | `benchmark/index.html` | `no-cache` | holds the numbers as of the build, stamped `built <time>`; once running, the browser fetches `api.siteread.dev/v1/benchmark.json` and shows the live numbers over them. A build that cannot reach the service still succeeds, and the page says the service did not answer until the live fetch does |
| `/account`, `/account/verify` | `index.csr.html` | `no-store`, `noindex` | sign in by an emailed link (its code after `#`, so in no log), then the plan, an API key and linked share ids; the session in localStorage, never the email; disallowed in `robots.txt`, not linked from the navigation yet |
| `/d53641fcf1daa066fc2634e51ab6ac04.txt` | `d53641fcf1daa066fc2634e51ab6ac04.txt` (`public/`) | default | the IndexNow key: a ping to `api.indexnow.org` names it, and the engines fetch it to check the ping came from this site. Public by design |
| anything else that is not a file | `index.csr.html` | 404 | the shell, which shows the not-found page |

The benchmark snapshot is only as fresh as the last deploy, for readers without JavaScript; a
scheduled rebuild would narrow that without a server.

## Configuration

| | |
|---|---|
| The API address the browser uses | build time, `angular.json` `define`: production `https://api.siteread.dev`, development `http://127.0.0.1:8787` |

The account pages call `/v1/account/*` from the browser, so the service must allow this page's
origin (`https://siteread.dev` by default; `http://localhost:4200` for `npm start`). The service's
operator status moved to its private admin panel.

## Deploy

Built on the owner's machine; only `dist/site/` goes to the server, where Caddy serves its
`browser/` folder. Nothing in it runs there. The proxy and the rest of the host are in the hosted
service's private repo.

## Privacy

- siteread.dev's access log is the proxy's, the one the privacy page describes; the site adds none.
- No cookies, analytics or third-party requests. The fonts are served from this site
  (`public/fonts/`, SIL Open Font License 1.1, each licence beside its font), because a font CDN
  would see every visitor's IP.
