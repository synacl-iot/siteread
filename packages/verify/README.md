# siteread

**Was that really ClaudeBot?** `siteread` takes the IP and User-Agent of a request from your access
log and checks the IP against the list the claimed vendor publishes: `verified`, `spoofed` or `unknown`.

Node ≥ 20, zero dependencies, nothing leaves your machine except GETs of the vendors' public IP lists
(and a `share`, if you choose to send one).

## Install

```sh
npm install siteread        # the library
npx siteread --help         # the CLI, no install
```

## CLI

`check` answers one request. The first call fetches the crawler lists into a cache file; later calls
reuse a copy younger than 24 h. The lists come from the siteread feed (one GET instead of thirteen;
below); `--no-feed` fetches each from its vendor instead, and any list the feed cannot give comes
from its vendor anyway.

```console
$ npx siteread check 216.73.216.12 "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"
verified  216.73.216.12 is claudebot (claude, training): in claude.com/crawling/bots.json (38 prefixes, fetched 2026-10-20T20:04:53Z)

$ npx siteread check 203.0.113.9 "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"
spoofed   203.0.113.9 claims chatgpt-user (chatgpt, answer) but is not in openai.com/chatgpt-user.json (234 prefixes, fetched 2026-10-20T20:04:53Z)

$ npx siteread check 203.0.113.9 "Claude-User (claude-code/2.1.292; +https://support.anthropic.com/)"
unknown   203.0.113.9 claims claude-code (claude, answer): Claude Code's WebFetch runs from the user's own machine, so no vendor list can cover it. If this IP also requested scanner paths in your log, treat it as spoofed
```

| Exit | Meaning |
|---|---|
| `0` | verified: the IP is in the vendor's list for that agent |
| `2` | spoofed: the vendor publishes a list and the IP is not in it |
| `3` | unknown: no list to check against, or the UA is not a known AI agent or search crawler |
| `1` | usage error, or the IP is not an IP address |

`lists` shows what the cache holds:

```console
$ npx siteread lists
agent             prefixes  fetched (UTC)         source
chatgpt-user           234  2026-10-20T20:04:53Z  https://openai.com/chatgpt-user.json
oai-searchbot           39  2026-10-20T20:04:53Z  https://openai.com/searchbot.json
gptbot                  18  2026-10-20T20:04:53Z  https://openai.com/gptbot.json
perplexity-user          4  2026-10-20T20:04:53Z  https://www.perplexity.com/perplexity-user.json
perplexitybot            8  2026-10-20T20:04:53Z  https://www.perplexity.com/perplexitybot.json
applebot                24  2026-10-20T20:04:53Z  https://search.developer.apple.com/applebot.json
claude-user             38  2026-10-20T20:04:53Z  https://claude.com/crawling/bots.json
claude-searchbot        38  2026-10-20T20:04:53Z  https://claude.com/crawling/bots.json
claudebot               38  2026-10-20T20:04:53Z  https://claude.com/crawling/bots.json
googlebot              317  2026-10-20T20:04:53Z  https://developers.google.com/static/search/apis/ipranges/googlebot.json
bingbot                 28  2026-10-20T20:04:53Z  https://www.bing.com/toolbox/bingbot.json
```

Options: `--no-cache` refetches every list now (a failed fetch still falls back to the cached copy),
`--json` prints the whole result. The cache is `<os.tmpdir()>/siteread/lists.json`; set
`SITEREAD_CACHE` to put it elsewhere. `siteread --help` prints all of this.

## Digest (for the `seo-read` skill)

`digest` reads a Search Console export (the Performance → Export → Download CSV zip) and your
access logs (nginx/Apache combined, Caddy's JSON, or an nginx JSON `log_format`; `.gz` fine) and prints one JSON document: weekly GSC totals with
impression-weighted position, people by first-touch source (an IP that sent a browser UA, loaded
an asset and never probed a scanner path), goal counts, and every crawler checked against its
vendor's list.

```console
$ npx siteread digest --gsc export.zip --log access.log.1.gz --log access.log \
    --site example.org --sitemap sitemap.xml --goal 'signup=^POST /signup 2' --out .siteread/digests
.siteread/digests/2026-10-18.json
```

A JSON log that holds several sites (one nginx serving an API, an app and a blog) is cut to one
with `--host`, repeated for each name (`www.` is a different host). Combined lines carry no host,
so `--host` keeps them and says so. For nginx JSON, the common field names are read
(`remote_addr`, `request_uri` or `request`, `status`, `time`/`time_iso8601`/`time_local`/`msec`,
`http_user_agent` or `user_agent`, `http_referer` or `referer`, `host` or `http_host`), with
`escape=json` or nginx's default escaping.

`npx siteread --help` lists every option. The `seo-read` skill, in siteread's Claude Code plugin
(`/plugin install siteread@siteread` after `/plugin marketplace add synacl-iot/siteread`), turns the
JSON into a weekly memo.

## Share (opt-in)

`share` sends one week of a digest's aggregate numbers to the public benchmark and prints where each
number stands among the quartiles the benchmark publishes. It prints the exact bytes first and sends nothing without a yes (a
prompt, or `--yes` in a script). `--dry-run` prints and stops.

```console
$ npx siteread share --dry-run
siteread: the whole payload from .siteread/digests/2026-10-18.json, byte for byte, for https://api.siteread.dev/v1/share:
{
  "schema": 1,
  "id": "3803e566762f2e56ba381b993ddf466e",
  "week": "2026-W42",
  "siteread": "0.2.1",
  "metrics": {
    "people": 4,
    "peopleFromSearch": 1,
    "peopleFromAi": 0,
    "peopleFromSocial": 2,
    "aiAnswerFetches": 0,
    "aiSearchFetches": 0,
    "aiTrainingFetches": 2,
    "searchEngineFetches": 8,
    "aiSpoofedPct": 25,
    "gscImpressions": 238,
    "gscClicks": 3,
    "gscCtrPct": 1.3,
    "gscPosition": 17.9
  },
  "proof": "2746561"
}
siteread: not sent (--dry-run)
```

The answer places each number in a band among the published 25th, 50th and 75th percentiles, and
only for numbers the benchmark page already shows a spread for; for the rest it gives the count of
sites so far. It is read from the published benchmark (rebuilt hourly), not from other sites' rows,
so it never tells you more than the page does. With 14 anonymous sites, 9 of them with Search
Console numbers (made up for this example):

```console
sent 2026-W42. Against the benchmark built 2026-10-21 09:00 UTC: 14 anonymous sites, 2026-W39 to 2026-W42

metric                   yours  where
people                       4  below the 25th percentile
peopleFromAi                 0  25th to 50th percentile
gscImpressions             238  9 sites; shown from 10
gscPosition               17.9  9 sites; shown from 10
…
```

- **What is sent:** the numbers above for the digest's last 7 days (`aiSpoofedPct` is over the whole
  log), a week label, the version, and a random id. `SHARE_METRICS` defines each one.
- **What is never sent:** hostnames, URLs or paths, visitor IPs, user-agents, query text, goal
  labels. The payload is built from an allowlist of numbers, and the endpoint refuses anything else.
- **The id** is 128 random bits in `.siteread/share-id`, made on first use. It makes the benchmark
  count sites rather than shares, and a second share of the same week replaces the first. Delete the
  file to start over as a new site.
- **The proof** is a proof of work tied to the id: a number that makes SHA-256 of the id start with
  22 zero bits, a few seconds of CPU once, kept in `.siteread/share-proof`. Only a site's first
  share needs it. Ids are free to make, so without it one sender could invent a flood of sites; the
  service never reads an address, so it makes each new site cost time instead, and the price rises
  by one bit for every 50 new sites in a day. On a busy day the service asks for more; the CLI makes
  it and tells you to run `share` again.
- A part with less than a full week (a 4-day log, an export whose last week is cut short) is left
  out and the CLI says so. `--endpoint` (or `SITEREAD_SHARE_URL`) sends elsewhere: `https://` only,
  plain `http://` only to localhost.

In the library, `sharePayload(digest, { id })` returns `{ payload, notes }`, and `validateShare(body)`
is the endpoint's check.

## Library

```js
import { createVerifier, isScannerPath } from 'siteread';

const verifier = createVerifier();
await verifier.refresh();                 // fetch the lists; call again every few hours
verifier.check('216.73.216.12', 'Mozilla/5.0 … ClaudeBot/1.0; +claudebot@anthropic.com)');
// {
//   agent: 'claudebot', kind: 'ai', assistant: 'claude', purpose: 'training',
//   source: 'https://claude.com/crawling/bots.json', verdict: 'verified', reason: 'in-vendor-list'
// }
```

### `createVerifier(options)`

| Option | Default | |
|---|---|---|
| `fetch` | `globalThis.fetch` | any WHATWG fetch |
| `store` | in memory | `{ get(): Promise<doc \| null>, set(doc): Promise<void> }`; `fileStore(path)` keeps it in a JSON file |
| `sources` | `SOURCES` | `[{ agent, url }]`, which lists to fetch |
| `now` | `Date.now` | a clock, for tests |
| `log` | `console` | `{ warn, error }`; pass `{}` for silence |
| `isKnownScannerIp` | none | `(ip) => boolean`, the 444 rule (below) |
| `feedUrl` | none | one merged document instead of the vendor URLs (below); `FEED_URL` is the hosted one |
| `fallback` | `false` | with `feedUrl`: fetch from the vendors what the feed could not give |

It returns:

- **`refresh({ force })`** reads the store, fetches every list that is due, drops what is too old and
  writes back. It never throws and returns `{ fetched, failed, fresh, dropped, errors }` (agent keys;
  `errors` maps a failed agent to its reason). `force` refetches lists that are still fresh.
- **`check(ip, ua)`** is synchronous and uses the lists the last `refresh()` or `load()` saw. It
  returns `{ agent, kind, assistant, purpose, source, verdict, reason }`:

  | verdict | reason | when |
  |---|---|---|
  | `verified` | `in-vendor-list` | the IP is in the list for the agent the UA claims |
  | `spoofed` | `not-in-vendor-list` | that agent has a list and the IP is not in it |
  | `spoofed` | `robots-token-not-a-user-agent` | the UA says Google-Extended (a robots.txt token, never sent as a UA) |
  | `spoofed` | `known-scanner-ip` | no list, and your `isKnownScannerIp(ip)` said yes |
  | `unknown` | `no-vendor-list` | the operator publishes no list (CCBot, YandexBot, Claude Code, …) |
  | `unknown` | `list-unavailable` | it has one, but it could not be loaded and there is no copy younger than 8 days |
  | `unknown` | `invalid-ip` | the IP did not parse |
  | `n/a` | `not-a-known-agent` | the UA claims to be no known AI agent or search crawler (`agent: null`) |

  `kind` is `'ai'` (an `AGENTS` entry) or `'crawler'` (a `CRAWLERS` entry). An IPv4-mapped IPv6
  address (`::ffff:1.2.3.4`, as a dual-stack listener logs it) is checked as the IPv4 it is.
- **`load()`** rebuilds the matcher from the store without fetching: for workers that share a store
  with one process that refreshes.
- **`lists()`** returns `[{ agent, url, prefixes, fetchedAt, fresh }]` in `sources` order.

### The 444 rule, for agents without a list

Most operators publish no IP list. For those, `siteread` says `unknown` rather than guess. If you
know which IPs probed your site for scanner paths, pass that and an `unknown` becomes `spoofed`:

```js
import { readFileSync } from 'node:fs';
import { createVerifier, fileStore, isScannerPath } from 'siteread';

const lines = readFileSync('access.log', 'utf8').trim().split('\n').map(JSON.parse);   // your log format here
const scanners = new Set(lines.filter(l => isScannerPath(l.request_uri)).map(l => l.remote_addr));

const verifier = createVerifier({ store: fileStore('.siteread.json'), isKnownScannerIp: ip => scanners.has(ip) });
await verifier.refresh();
for (const l of lines) {
  const r = verifier.check(l.remote_addr, l.http_user_agent);
  if (r.agent) console.log(r.verdict, r.agent, l.request_uri);
}
```

The hook only ever turns `unknown` into `spoofed`. When the agent has a vendor list, the list wins,
even for an IP that hit a scanner path. The ClaudeBot story below is why.

### UA tables and scanner paths

- **`AGENTS`** lists 23 AI agents as `{ key, re, assistant, purpose }`, where `purpose` is `answer`
  (fetched live for a person), `search` (an assistant's index) or `training`. The FIRST match wins.
  **`detectAgent(ua)`** returns the entry or `null`.
- **`CRAWLERS`** lists classic search and SEO crawlers (Googlebot, bingbot, YandexBot, DuckDuckBot,
  Slurp, PetalBot, AhrefsBot, SemrushBot, MJ12bot, facebookexternalhit). **`detectCrawler(ua)`**
  returns the entry, and **`isSearchCrawler(ua)`** returns a boolean. AI agents are never search
  crawlers here: Applebot, GPTBot and the rest are in `AGENTS`.
- **`isScannerPath(path, { allow })`** is true for a vulnerability-scanner request target: dotfiles
  (but not `/.well-known/`), `.php`/`.asp`/`.jsp`/`.env`/`.sql`/`.bak`/`.sh`…, `wp-*`, phpMyAdmin,
  `cgi-bin`, router exploits, percent-encoded dots (`/%2eenv`), secret and config file names,
  `Dockerfile`. Pass the raw request target (path + query, not URL-decoded: nginx's
  `$request_uri`). If a real path of yours matches, exempt it:
  `isScannerPath(p, { allow: /^\/(install\.sh|admin\/config\.yml)(\?|$)/ })`.
- **`parseCidr`**, **`parseList`**, **`normIp`** and **`SOURCES`** are exported for tests and extensions.

## Why

This code was built to count AI traffic on one small site's nginx log, and every simple approach
gave the wrong answer.

**Scanners wear AI user-agents.** One scanner cycles through them. In 30 days of the log
(to 2026-10-16), 217 of the 221 ChatGPT-User requests from outside OpenAI's list came from IPs that
also drew a 444 (nginx's "close, send nothing" reply to a scanner path). Every request claiming to be
DeepSeekBot, CCBot, Grok, Perplexity-User or Claude-SearchBot was fake. A UA count is a count of
what scanners chose to say.

**The 444 rule cannot clear a real crawler that follows a bad link.** Before Anthropic's list was
used, the test was "this IP never hit a scanner path." Then ClaudeBot resolved a GitHub README's
relative links against the site and asked for `/protocol//blob/master/examples/docker-compose.yml`.
It drew one 444, and all 50 of that IP's reads that day were counted as spoofed. Anthropic publishes
one list for its bots (`claude.com/crawling/bots.json`). In those 30 days every ClaudeBot IP and
every page-reading Claude-User IP was in it, and the four IPs probing `/.env`-style paths under
Claude names were not. Hence the rule: where a list exists, it decides.

**Claude Code is not Anthropic's crawler.** Claude Code's WebFetch sends
`Claude-User (claude-code/…)` from the user's own machine and IP, so no list can cover it. It is
matched before `Claude-User` and always comes back `unknown`.

**Google-Extended is not a User-Agent.** It is a robots.txt token that Google's crawlers obey while
fetching as Googlebot. A request that sends it as a UA is not from Google.

## Vendor lists

| Agent(s) | List |
|---|---|
| chatgpt-user | https://openai.com/chatgpt-user.json |
| oai-searchbot | https://openai.com/searchbot.json |
| gptbot | https://openai.com/gptbot.json |
| perplexity-user | https://www.perplexity.com/perplexity-user.json |
| perplexitybot | https://www.perplexity.com/perplexitybot.json |
| applebot | https://search.developer.apple.com/applebot.json |
| claude-user, claude-searchbot, claudebot | https://claude.com/crawling/bots.json (fetched once for all three) |
| googlebot | https://developers.google.com/static/search/apis/ipranges/googlebot.json |
| bingbot | https://www.bing.com/toolbox/bingbot.json |
| duckduckbot | https://duckduckgo.com/duckduckbot.json |
| duckassistbot | https://duckduckgo.com/duckassistbot.json |
| mistralai-user | https://mistral.ai/mistralai-user-ips.json |
| ccbot | https://index.commoncrawl.org/ccbot.json |

All of them answer `{ "creationTime": …, "prefixes": [{ "ipv4Prefix": … } | { "ipv6Prefix": … }] }`.

- **Refresh:** a list is refetched only when the stored copy is more than 24 h old.
- **Failure:** a failed fetch keeps the previous copy, so a vendor's CDN hiccup does not turn its real
  crawlers into `spoofed`. A 200 that is not JSON (an HTML challenge page, a moved list) counts as a
  failure, not as an empty list.
- **Drop:** a copy nobody could refresh for 8 days is dropped, so a vendor's moved ranges cannot mark
  its new IPs as spoofed forever. With no copy, the verdict is `unknown`, never `spoofed`.
- **Bounds:** a body over 2,000,000 characters or more than 20,000 prefixes is rejected, and a list
  holding a prefix broader than /16 (IPv4) or /32 (IPv6) is refused whole, keeping the previous
  copy. The broadest real prefix in any list is a /16 (IPv4) and a /64 (IPv6); a `/0` would verify
  every address, and since the CLI reads the hosted feed, the limit is what stops a tampered feed
  from vouching for a whole provider's range. From the feed, a refused list is fetched from its
  vendor instead.

## The feed

`https://api.siteread.dev/v1/lists.json` (`FEED_URL`) is every vendor list above in one document,
rebuilt from the vendors every 6 h by the hosted service:

```json
{ "siteread": "0.2.1", "generatedAt": "2026-10-21T17:28:48.171Z",
  "lists": { "claudebot": { "prefixes": ["216.73.216.0/22", "…"], "fetchedAt": "2026-10-21T17:28:46.433Z",
                            "source": "https://claude.com/crawling/bots.json" }, "…": {} } }
```

It is built by the package's verifier, so it keeps the package's rules: a failed vendor fetch keeps
the previous copy with its old `fetchedAt`, a copy nobody could refresh for 8 days is dropped, every
prefix is bounded and re-validated. `fetchedAt` is when the feed got the list from the vendor, and
the client keeps that time, so its 24 h / 8 day rules measure the vendor data's age, not the hop.
Every run refetches: a client takes a feed copy only when it is newer than its own.

## Privacy

Local use sends nothing anywhere except plain GETs of public crawler lists, with the User-Agent
`siteread/<version>`: the siteread feed by default, or the vendors' URLs above with `--no-feed` (or
`SITEREAD_FEED_URL=off`), and those vendors whenever the feed fails. The feed's service keeps no
address; it counts fetches per day by siteread version. No hostnames, URLs or visitor IPs leave
your machine. There is no reverse-DNS
check for the same reason: a PTR lookup sends the visitor's IP to your resolver. `share` is the one
exception: opt-in, its exact payload printed first, aggregate numbers only.

`feedUrl` points the verifier at one merged document,
`{ "lists": { "<agent>": { "prefixes": [...], "fetchedAt": "..." } } }`, instead of the vendors: the
hosted feed is `https://api.siteread.dev/v1/lists.json` (`FEED_URL`, the hosted service, rebuilt
from the vendors every 6 h; see The feed below). The CLI uses it by default with `fallback: true`, which fetches from the
vendors whatever the feed could not give; the library leaves both off unless you pass them. Every
prefix from a feed is re-validated like a vendor's, and a `fetchedAt` in the future is clamped to
now.

## License

MIT.
