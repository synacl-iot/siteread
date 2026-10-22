# siteread cloud

The three network pieces behind `siteread.dev`, as one small service with zero dependencies:

| Path | What |
|---|---|
| `GET /v1/lists.json` | the merged crawler-list feed: every vendor's IP list in the one document `createVerifier({ feedUrl })` reads |
| `POST /v1/share` | one site's week of aggregate numbers in, its percentile per metric back |
| `GET /v1/benchmark.json` | the public aggregate the benchmark page renders, with `n` printed |
| `GET /v1/operator/status` | counts for the private operator page; needs the operator token, absent without one |
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

Secrets and settings come from the environment, read by `src/config.js` for both `serve.js` and
`job.js`:

| Variable | |
|---|---|
| `SITEREAD_NAMED` | `{"<share id>": "<label>"}`: sites that chose to be named on the benchmark. The id is the only credential a share carries, so keep it secret; errors name an entry by position, never by id |
| `SITEREAD_OPERATOR_TOKEN` | at least 32 characters (`openssl rand -hex 32`); unset, the operator route does not exist |
| `SITEREAD_OPERATOR_ORIGIN` | the one browser origin allowed to call it (default `https://siteread.dev`) |

`serve.js` writes its request counts to the store every hour and on SIGTERM. Where it should run, and
what the host must not log, is in [HOSTING.md](HOSTING.md).

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
  same id and week again replaces the row. A new id must carry a proof of work (`proof`, see
  `PROOF OF WORK` in `share.js`): 22 zero bits on a quiet day, one more for every 50 new sites that
  day (UTC). That bounds how fast made-up sites can move the benchmark without a cap one sender
  could use up, and without reading an address. A refusal names the bits (`need`).
- **Stored:** the validated share plus the day it arrived (`receivedOn`, not a time).
- **Counted:** shares taken and refused per day, by a fixed refusal code (`SHARE_REFUSALS`), never by
  message, since a message can echo a field name the sender chose.
- **Answer:** per metric, its band among the quartiles `benchmark.json` publishes (below the 25th,
  25th to 50th, 50th to 75th, 75th or above), only where it publishes them, and the number of sites
  that report it; read from the hourly snapshot, never the live rows. An exact percentile among the
  live rows let one sender re-share the same week with value after value and recover every other
  site's number (3 sites, 90 requests); a band against published numbers gives away nothing the
  page does not.

## The aggregate

`benchmark.json` holds, per metric, its definition, whether lower is better, the number of
anonymous sites that report it, and its 25th, 50th and 75th percentiles once at least 10 anonymous
sites do (below that, the count only). Then `named`: each named site's label, week and own values,
with its rank against the anonymous sites from the same threshold. And `history`: how many sites
shared each week. No ids, no anonymous rows.

Why three numbers from ten: five interpolated percentiles over five values give all five back
(p25, p50 and p75 are the 2nd to 4th values; p10 and p90 then solve for the 1st and 5th). Three
over ten pin none.

## Privacy

- The sender's IP is never read by this code: not stored, not logged, not used for rate limits.
  `src/node.js` writes no access log. A proxy or platform in front of it may log requests; turning
  that off is part of choosing the host.
- What arrives is numbers, a random id, an ISO week and a version; the allowlist is the only way in.
- The public aggregate never carries an anonymous row or any id, and no percentile is published
  from fewer than 10 anonymous sites.
- The operator status is counts only: feed ages, the last feed run, shares and refusals per day,
  new sites per day, and requests per day by route and kind of client (`clientOf`: siteread with
  its version, a browser, anything else, or `local` for what did not come through the proxy). No
  row, no id, no address, no User-Agent string.

## License

MIT.
