# siteread cloud

The three network pieces behind `siteread.dev`, as one small service with zero dependencies:

| Path | What |
|---|---|
| `GET /v1/lists.json` | the merged crawler-list feed: every vendor's IP list in the one document `createVerifier({ feedUrl })` reads |
| `POST /v1/share` | one site's week of aggregate numbers in, its percentile per metric back |
| `GET /v1/benchmark.json` | the public aggregate the benchmark page renders, with `n` printed |
| `GET /healthz` | when the feed and the aggregate were last built |

Plus two jobs: **feed** (fetch the vendor lists, publish the feed; every 6 h) and **aggregate**
(every stored share → `benchmark.json`; hourly).

The handler is Web-standard `Request` → `Response` (`src/app.js`) over a five-method key/value store
(`src/store.js`), so it runs behind `node:http` today and behind any host that speaks fetch with a
small adapter. The feed and the share schema are the package's own code (`../packages/verify/src`),
imported by path so the service and the client can never disagree.

## Run it

```sh
node bin/serve.js --port 8787 --data .data          # endpoints + both jobs on timers
node bin/job.js feed --data .data                   # or run a job once, from cron
node bin/job.js aggregate --data .data
npm test
```

`serve.js` options: `--host` (default `127.0.0.1`), `--public-url` (where the benchmark page lives,
named in share's answer; default `https://siteread.dev`), `--no-jobs`. Each also reads `PORT`,
`HOST`, `SITEREAD_DATA`, `SITEREAD_PUBLIC_URL`. Data is one file per key under `--data`.

Point the CLI at it with `siteread share --endpoint http://127.0.0.1:8787/v1/share`, and the library
with `createVerifier({ feedUrl: 'http://127.0.0.1:8787/v1/lists.json' })`.

## The feed

```json
{ "siteread": "0.3.0", "generatedAt": "2026-10-21T17:28:48.171Z",
  "lists": { "claudebot": { "prefixes": ["216.73.216.0/22", "…"], "fetchedAt": "2026-10-21T17:28:46.433Z",
                            "source": "https://claude.com/crawling/bots.json" }, "…": {} } }
```

It is built by the package's verifier, so it keeps the package's rules: a failed vendor fetch keeps
the previous copy with its old `fetchedAt`, a copy nobody could refresh for 8 days is dropped, every
prefix is bounded and re-validated. `fetchedAt` is when the feed got the list from the vendor, and
the client keeps that time, so its 24 h / 8 day rules measure the vendor data's age, not the hop.
Every run refetches: a client takes a feed copy only when it is newer than its own.

## Share

The CLI's `siteread share` builds the payload (`packages/verify/src/share.js`) and the endpoint
checks it with the same module's `validateShare`:

```json
{ "schema": 1, "id": "<32 random hex digits>", "week": "2026-W42", "siteread": "0.3.0",
  "metrics": { "people": 4, "gscClicks": 3, "…": 0 } }
```

- **Refused, not trimmed:** an unknown field, an unknown metric, a string where a number goes, a
  number out of bounds, a week that has not started or is more than 8 weeks ago, a body over 8 KiB,
  anything but `application/json`. A client bug that would leak a hostname fails loudly.
- **One row per site per week:** the id is random and kept by the site (`.siteread/share-id`); the
  same id and week again replaces the row. At most 100 new ids a day are taken (`429` after), which
  bounds how fast made-up sites can move the benchmark.
- **Stored:** the validated share plus the day it arrived (`receivedOn`, not a time).
- **Answer:** per metric, the mid-rank percentile among each site's latest share in the 4 weeks
  ending at that week, with the number of sites that report that metric.

## The aggregate

`benchmark.json` holds, per metric, its definition, the number of sites that report it, and the
10th/25th/50th/75th/90th percentiles once at least 5 sites do (below that, the count only), plus
`history`: how many sites shared each week. No ids, no rows.

## Privacy

- The sender's IP is never read by this code: not stored, not logged, not used for rate limits.
  `src/node.js` writes no access log. A proxy or platform in front of it may log requests; turning
  that off is part of choosing the host.
- What arrives is numbers, a random id, an ISO week and a version; the allowlist is the only way in.
- The public aggregate never carries a row or an id, and no quantile is published from fewer than
  5 sites.

## License

MIT.
