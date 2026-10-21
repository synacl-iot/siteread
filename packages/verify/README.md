# siteread

**Was that really ClaudeBot?** `siteread` takes the IP and User-Agent of a request from your access
log and checks the IP against the list the claimed vendor publishes: `verified`, `spoofed` or `unknown`.

Node ≥ 20, zero dependencies, nothing leaves your machine except GETs of the vendors' public IP lists.

## Install

```sh
npm install siteread        # the library
npx siteread --help         # the CLI, no install
```

## CLI

`check` answers one request. The first call fetches the vendor lists into a cache file; later calls
reuse a copy younger than 24 h.

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
access logs (nginx/Apache combined, `.gz` fine) and prints one JSON document: weekly GSC totals with
impression-weighted position, people by first-touch source (an IP that sent a browser UA, loaded
an asset and never probed a scanner path), goal counts, and every crawler checked against its
vendor's list.

```console
$ npx siteread digest --gsc export.zip --log access.log.1.gz --log access.log \
    --site example.org --sitemap sitemap.xml --goal 'signup=^POST /signup 2' --out .siteread/digests
.siteread/digests/2026-10-18.json
```

`npx siteread --help` lists every option. The skill in [`skill/`](../../skill/README.md) turns
the JSON into a weekly memo.

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
| `feedUrl` | none | one merged document instead of the vendor URLs (below) |

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

All of them answer `{ "creationTime": …, "prefixes": [{ "ipv4Prefix": … } | { "ipv6Prefix": … }] }`.

- **Refresh:** a list is refetched only when the stored copy is more than 24 h old.
- **Failure:** a failed fetch keeps the previous copy, so a vendor's CDN hiccup does not turn its real
  crawlers into `spoofed`. A 200 that is not JSON (an HTML challenge page, a moved list) counts as a
  failure, not as an empty list.
- **Drop:** a copy nobody could refresh for 8 days is dropped, so a vendor's moved ranges cannot mark
  its new IPs as spoofed forever. With no copy, the verdict is `unknown`, never `spoofed`.
- **Bounds:** a body over 2,000,000 characters, more than 20,000 prefixes, or a prefix broader than
  /8 (IPv4) or /16 (IPv6) is rejected. A `/0` would verify every address.

## Privacy

Local use sends nothing anywhere except plain GETs of the URLs above, with the User-Agent
`siteread/<version>`. No hostnames, URLs or visitor IPs leave your machine. There is no reverse-DNS
check for the same reason: a PTR lookup sends the visitor's IP to your resolver.

`feedUrl` points the verifier at one merged document,
`{ "lists": { "<agent>": { "prefixes": [...], "fetchedAt": "..." } } }`, instead of the vendors. It
is for a hosted feed that is planned but **not live yet**, so it is off by default and strictly opt-in.
Every prefix from a feed is re-validated like a vendor's, and a `fetchedAt` in the future is clamped
to now.

## License

MIT.
