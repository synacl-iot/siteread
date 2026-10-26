---
name: seo-read
description: Weekly read of a website's search and reader traffic. Turns a Google Search Console export plus the server's access log into a dated memo (who read the site, whether it went well, what to write or fix next) and appends it to the site's read log. Use when the user asks for their weekly SEO read, a traffic or Search Console review, "who read my site this week", or hands over a GSC export zip or an access log.
---

# seo-read: the weekly memo

You turn two files the user already has into one dated memo. The numbers come from
`siteread digest`, which is deterministic; you write the prose around them. You never compute a
number the digest can give you, and you never send the user's data anywhere: the digest runs
locally, and its only network traffic is GETs of public crawler lists (the siteread feed, or the
vendors' own with `--no-feed`). The one
exception is the last step's share, a week of totals, and only on the user's yes.

## 1. Find the inputs

Look in the current directory first, then ask once for whatever is missing. Ask for everything in
one message.

| Input | What it is | If missing |
|---|---|---|
| Search Console export | the zip (or the folder it unzips to) from Search Console → Performance → set the range to **Last 28 days** → Export → **Download CSV** | ask; the read can run on the log alone, so say what will be missing |
| Access log | nginx or Apache "combined", Caddy's JSON access log, or an nginx JSON `log_format` (one object per line); `.gz` rotations are fine; pass every file that covers the period | ask; the read can run on GSC alone |
| Site host | e.g. `example.org` | the digest guesses it and warns; confirm the guess |
| Hosts in the log | a JSON log that holds several sites (an API, an app, other domains on the same server) | if the log's lines carry a host, ask which are this site's and pass each as `--host` (`www.` is a different host); otherwise their traffic counts as this site's |
| Sitemap | a local copy of `sitemap.xml` | optional; without it crawler counts include every page fetch |
| Goals | what a reader *doing something* looks like in the log, e.g. a signup `POST /signup` 201 | optional; ask once |
| Team | how to tell the owner's team from readers: an admin path on this site (`--team-path`), or an admin/app host in the same log (`--team-host`) | optional; ask once. Prefer a path or host to IPs (see below) |

If `.siteread/config.json` exists, read it first and ask only for what it lacks. Once the inputs
are settled, write the answers there so next week needs no questions. Each key is the digest option of the same name; a list means "repeat the option":

```json
{ "logs": ["logs/access.log.1.gz", "logs/access.log"],
  "site": "example.org", "sitemap": "public/sitemap.xml",
  "goals": ["signup=^POST /signup 2", "tool=^POST /api/"],
  "hosts": ["example.org", "www.example.org"],
  "teamPath": "^/admin/", "teamHosts": [], "excludeIps": [], "allowPath": null }
```

`logs` → `--log` each, `hosts` → `--host` each, `goals` → `--goal` each, `teamPath` → `--team-path`, `teamHosts` →
`--team-host` each, `excludeIps` →
`--exclude-ip` each, `allowPath` → `--allow-path`. The export is new every week, so it is not
saved: take the newest export zip or folder in the directory, and confirm it if there are several.
A goal regex is matched against `METHOD /path status`, so "a POST to /signup that returns 2xx" is
`^POST /signup 2`.

Team by IP is the last resort. Mobile carriers (CGNAT), VPNs and iCloud Private Relay give one
address to many strangers, so excluding such an IP drops real readers with it. Before saving an
`excludeIps` entry, look at it: if it belongs to a carrier, VPN or Private Relay range (Apple
publishes Private Relay's at https://mask-api.icloud.com/egress-ip-ranges.csv), leave it out and say so, and
offer `--team-host` or `--team-path` instead. `--team-host` needs a log whose lines carry the
host and that still holds the admin host's lines (filter the log to the site *and* the admin host).

If the log is in none of those formats (the digest warns when most lines don't parse), say so and
ask the user how their server logs; don't guess a format.

## 2. Run the digest

```sh
npx -y siteread@0.3 digest \
  --gsc <export.zip> --log <access.log.1.gz> --log <access.log> \
  --site <host> [--host <host> …] --sitemap <sitemap.xml> \
  --goal '<label=regex>' --team-path '<regex>' \
  --out .siteread/digests
```

- `--out` names the file for the last day the read covers (after GSC's lag is cut), prints its
  path, and compares with the newest earlier digest in that folder by itself. stderr says which
  one, or "no earlier digest": that means this is the first read.
- `--split <YYYY-MM-DD>` when the user changed something on a known day (a retitle, a launch)
  and wants before/after: it compares per day, so unequal windows are fair.
- `--from/--to` trims the log to a range. The digest warns, with the exact days, when the log runs
  past the export (GSC lags 2–3 days); rerun with them. A log that sits inside the export needs
  nothing.
- Warnings go to stderr. Read every one; each belongs in the memo's method notes or changes how
  you read a number.
- If `siteread` is installed (`siteread --version` prints 0.3.0 or later), `siteread digest …` is the
  same command without npx.
- Run `npx -y siteread@0.3 --help` for every option. Exit 1 is a usage or input problem: fix it, don't
  work around it by reading the CSVs yourself.

## 3. Read the digest

The JSON has `gsc` and `log` halves (either may be null) and `warnings`. What each number means:

- `gsc.totals` / `gsc.weeks`: from the daily series, with `impressionsPerDay` / `clicksPerDay`.
  Position is impression-weighted. Trailing zero days (GSC lag) are already cut:
  `gsc.range.trimmedTrailingDays`.
- `gsc.countries` / `gsc.devices` don't add up to the totals: GSC drops anonymised rows from
  them. Don't present them as a breakdown of the total.
- `gsc.pages.rows[]` with a `#fragment` (`/guide/#step-2`) are GSC's own jump-link rows. They
  are not summed into the page (their impressions overlap with it); name them on their own line.
- `gsc.namedQueries.shareOfTotal`: the % of impressions the query table names. The rest are
  anonymised. Say this whenever you discuss queries.
- `gsc.pages|queries|countries.rows[].prev` and `gsc.prevTotals`: last read's numbers (null on
  the first read, and for a row that is new this read).
- `log.people`: a person is an IP with a browser UA, no scanner path or 444, that loaded an
  asset. `weeks[]` has, per 7-day week, `people` (unique people with a page view that week,
  returning readers included), `firstArrivals` (people whose first page view in the whole log
  falls in that week, the count `log.sources` splits up) and goal counts (a goal counts in the
  week the person first arrived). Label which one you quote; never set one beside the other as a
  change. Days are US Pacific, like GSC.
- `log.people.setAside`: browsers that were excluded, by reason. `scanners` here is only scanners
  that wore a browser UA; `log.scanners.ips` counts every IP that probed. `cloudFakes` is a cloud
  IP whose first visit claimed a search-engine Referer; `cloudFakeReferers` says which engine.
- `log.sources`: people by **first touch** (utm_source beats Referer, which is how ChatGPT
  visits show up), each with landing pages and goal counts.
- `log.crawlers[]`: per agent, `verified` (IP in the vendor's published list), `spoofed` (not in
  it, or the IP probed scanner paths), `unknown` (no list exists). Only `verified` is crawling.
  With a sitemap, report `verified.sitemapFetches` and `perWeek[].fetches` (both sitemap URLs
  only); `pageFetches` also counts pages outside the sitemap, listed in `offSitemapPages` (old
  URLs still being crawled are worth a line).
- `unknown` agents: `claude-code` is Claude Code's WebFetch, run from someone's own machine; it is
  a person (often the site owner) asking Claude about a page, not a crawler. Others (PetalBot,
  Amazonbot …) publish no IP list, so they can't be verified either way; report them as
  unverified, never as crawling.
- `log.sitemap.neverFetched`: sitemap URLs no verified search crawler fetched in the log.
- `crossCheck`: GSC clicks vs people the log saw arrive from Google, over the days both cover.
  Close numbers mean the log rules see the same readers Google does. A big gap usually means
  clicks arrived without a Referer (some browsers and apps strip it, so they read as direct), or
  the people rule excluded real readers (no asset loads: an aggressive cache or CDN serving the
  assets). Say which is more likely given `setAside` and the direct count; if neither fits, say
  the gap is unexplained rather than inventing a cause. Never fix it by adding.
- `log.lines.unparsed`: mention only when the digest warned about it. `log.lines.otherHost` is
  the lines `--host` set aside as another site's; `noHost` the lines it could not check.

## 4. Write the memo

Use this shape. The table compares the last two 7-day weeks unless the user asked for a `--split`
comparison. Leave out any section whose input is missing, and say it was missing.

```markdown
### <today's date, YYYY-MM-DD>: GSC <from>→<to> (export `<file name>`) + log <from>→<to>

<One or two sentences: the answer to "was it a good week", with the number that says so.>

| | <week before: from→to> | <last week: from→to> |
|---|---|---|
| Impressions / day | | |
| Clicks | | |
| CTR | | |
| Weighted position | | |
| People (log, unique, returning included) | | |
| First arrivals (log) | | |
| <each goal> (people) | | |

<On the first read (no earlier digest), say so in one line, and the "vs last read" parts below
become "first read; next week compares with this one".>

**Search Console.** <28-day totals vs last read; the weekly trend; named-query share. Pages that
moved (impressions and position, with last read's numbers from `prev`); queries grouped into
clusters by intent with impressions @ position; countries and devices only if they say something.>

**People (log).** <first-touch sources as "source people / goal hits", landings that matter, what
people did after landing, and the `crossCheck` line. Then one line on who was set aside: "Set
aside: N with no asset loads, N cloud IPs faking a <engine> Referer, N team, N browsers that
probed scanner paths".>

**Crawlers.** <verified fetches per agent, week before vs last week (`perWeek`), sitemap coverage,
never-fetched and off-sitemap URLs; unverified agents on one line; then spoofed traffic and
scanners on their own line, so nobody reads them as crawling. `otherBots` (monitors, curl) only if
they are a large share of requests.>

**Recommended next (owner to pick):** <2–4 bullets, each tied to a number above and to one
action: a page to link to, a title to test, a page to request indexing for, a thing to stop
doing. The owner chooses; don't rank them as orders.>

**Method notes:** <anything that changes how this read compares with earlier ones: a new option,
a warning, a range mismatch. Omit when there is nothing.>
```

Rules for the prose:

- **Every number comes from the digest.** If you want one it doesn't have, say it's not measured.
- **Small numbers stay small.** 3 clicks is "3 clicks", not "a 50 % rise". Under ~20 per side,
  give counts, not percentages, and say the sample is small. When everything is small, judge the
  week on direction across several weeks (impressions and position in `gsc.weeks`) and on single
  real events (the first signup, the first visitor from a new source), and say that is the basis.
- **GSC clicks and log people are different counts.** Compare them only as a cross-check
  ("GSC 9 clicks vs 8 people from Google"), never add them.
- **Failures ship.** A launch that brought nobody is written down as nobody, with where you looked.
- **No causes without evidence.** "Impressions rose after the 10-05 retitle" is a timing fact;
  "because of the retitle" needs the page-level numbers to back it.
- Name pages by path and queries verbatim. No visitor IPs in the memo.
- Plain sentences, no hype words, no emoji.

## 5. Save and show

Append the memo to `siteread-log.md` in the directory you ran in (create it with a
`# Read log: <site>` heading if new; reads go oldest first, newest at the bottom). Keep the
digest JSON in `.siteread/digests/`: next week's `--out` compares with it. Then show the user the memo
and ask which of the recommended next steps they want to take.

## 6. Offer the benchmark (opt-in)

The public benchmark at siteread.dev compares sites by these same weekly numbers. Offer it once
per read, after the memo; never send without a yes.

1. Run `npx -y siteread@0.3 share --dry-run`. It prints the exact payload it would send (a week
   label, the version, a random id and the week's totals: no host, URL, path, IP or query) and
   sends nothing.
2. Show the user that payload and the CLI's notes (a part with less than a full week is left
   out), and ask whether to send it. If `.siteread/config.json` says `"share": false`, skip this
   step; if the user says never, write that there.
3. On a yes, run `npx -y siteread@0.3 share --yes` and show its answer: for each number, the
   band it falls in among the benchmark's published quartiles, or how many sites report it so
   far. Add one line to the memo's method notes: "Shared <week> to the siteread benchmark."
4. The id in `.siteread/share-id` keeps the site one row from week to week; never print it or
   put it in the memo.
