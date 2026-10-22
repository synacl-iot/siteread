// An access log (nginx / Apache "combined", Caddy's JSON or an nginx JSON log_format; plain or .gz)
// → people, sources and crawlers. A file that holds several sites is cut to one with `hosts`.
//
// Who counts as a person is the rule one site settled on after its first counts were wrong
// (2026-09-28, stricter than the read a week earlier, so compare only reads made the same way):
//   a person = an IP that sent no bot User-Agent, never asked for a scanner path or drew a 444,
//   and loaded at least one asset (CSS/JS/font/image). Link checkers, previewers and most bots
//   fetch the HTML and stop; a browser always pulls the stylesheet.
// That rule alone let one fleet through: AWS us-west-2 IPs with a single Linux Chrome UA that
// FAKED a Google Referer and loaded assets. They were the whole of one day's "Google bump" that
// Search Console showed as zero clicks. So a person whose first visit claims a search-engine
// Referer from a cloud provider's address space is set aside and counted on its own line.
//
// Crawlers are counted on page fetches (and on sitemap URLs when a sitemap is given), each IP
// checked against its vendor's list. The raw UA count lies: one week that site's log showed
// "Googlebot 6.9k", and it was scanners wearing Googlebot's UA against the bare IP. Googlebot
// also crawls from 192.178.x, not only 66.249.x: a first-octet guess undercounted it by a third.

import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { detectAgent, detectCrawler } from '../agents.js';
import { isScannerPath } from '../scanner.js';
import { classifySource, refererHost } from './referrer.js';

// ip - user [time] "METHOD target PROTO" status bytes "referer" "ua" (anything after is ignored).
// nginx escapes a quote inside a field as \x22, Apache as \"; both are handled.
const LINE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)(?: [^"]*)?" (\d{3}) \S+(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

export const ASSET_RE = /\.(css|js|mjs|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i;
// A page: no extension, a trailing slash, or .html. Feeds, robots.txt, sitemaps and JSON are not.
const PAGE_RE = /^[^?]*(\/|\/[^./?]+|\.html?)(\?|$)/i;
const NOT_PAGE_RE = /^\/(robots\.txt|sitemap[^/]*\.xml|favicon|\.well-known\/|feed\/?$|rss\/?$|api\/)/i;
// UAs that are not a browser and not in the vendor tables: libraries, monitors, previewers.
const GENERIC_BOT_RE = /bot\b|bot\/|crawl|spider|slurp|fetch|scan|curl\/|wget\/|python|go-http|java\/|okhttp|axios|node-fetch|undici|httpclient|libwww|headless|phantom|lighthouse|pingdom|uptime|monitor|preview|validator|feed|^-?$/i;
// First octets of AWS (3, 13, 15, 16, 18, 44, 52, 54) and GCP (34, 35) address space. Crude on
// purpose: it only ever applies to a search-referred "person", where a residential reader on
// these octets is far rarer than a fake. Exported so a site can see what it filters.
export const CLOUD_FIRST_OCTETS = Object.freeze([3, 13, 15, 16, 18, 34, 35, 44, 52, 54]);
const CLOUD = new Set(CLOUD_FIRST_OCTETS);

/** "05/Oct/2026:20:00:00 +0200" (nginx $time_local, Apache %t) → ms, or NaN. */
function clfTime(s) {
    const t = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s);
    if (!t || !(t[2] in MONTHS)) return NaN;
    const off = (t[7] === '-' ? -1 : 1) * (Number(t[8]) * 60 + Number(t[9]));
    return Date.UTC(+t[3], MONTHS[t[2]], +t[1], +t[4], +t[5], +t[6]) - off * 60_000;
}

/**
 * One access-log line → { ip, ts, method, target, status, referer, ua, host }, or null. Combined
 * format, or a JSON object per line: Caddy's (it has a `request` object) or an nginx log_format.
 * `host` is null when the format does not carry one (combined).
 */
export function parseLine(line) {
    if (line.charCodeAt(0) === 123) return parseJsonLine(line);
    const m = LINE_RE.exec(line);
    if (!m) return null;
    const [, ip, time, method, target, status, referer = '-', ua = '-'] = m;
    const ts = clfTime(time);
    if (!Number.isFinite(ts)) return null;
    const unesc = s => s.replace(/\\x22/g, '"').replace(/\\"/g, '"');
    return { ip, ts, method, target, status: Number(status), referer: unesc(referer), ua: unesc(ua), host: null };
}

// nginx writes JSON by hand from a log_format. With `escape=json` it is valid JSON; with the
// default escaping a quote or a non-ASCII byte comes out as \xHH, which JSON does not allow, so a
// line that fails is read again with those as \u00HH.
function parseJsonObject(line) {
    try { return JSON.parse(line); } catch { /* try the nginx default escaping */ }
    if (!line.includes('\\x')) return null;
    try { return JSON.parse(line.replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')); } catch { return null; }
}

function parseJsonLine(line) {
    const e = parseJsonObject(line);
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    return e.request && typeof e.request === 'object' ? caddyEntry(e) : nginxEntry(e);
}

// Caddy writes its access log as JSON (the `log` directive's default) and cannot write "combined"
// without a plugin a distribution's package does not carry; siteread.dev's own log is one. Caddy
// has no 444, so a scanner there shows by its path alone, which the 444 rule reads anyway.
// `client_ip` (Caddy ≥ 2.7, after trusted proxies) wins over `remote_ip`; `ts` is Unix seconds
// unless the log was configured with another time format.
function caddyEntry(e) {
    const r = e.request;
    const ip = r.client_ip || r.remote_ip;
    const ts = typeof e.ts === 'number' ? Math.round(e.ts * 1000) : Date.parse(e.ts);
    if (typeof ip !== 'string' || !ip || !Number.isFinite(ts) || typeof r.method !== 'string' || typeof r.uri !== 'string'
        || !Number.isInteger(e.status)) return null;
    const first = k => (Array.isArray(r.headers?.[k]) && typeof r.headers[k][0] === 'string' ? r.headers[k][0] : '-');
    return { ip, ts, method: r.method, target: r.uri, status: e.status, referer: first('Referer'), ua: first('User-Agent'), host: str(r.host) };
}

// An nginx JSON log_format names its fields as its author chose. These are the names in common use
// for each, first match wins: the variable's own name (remote_addr, http_user_agent) or a short one
// (ip, user_agent). The target is the raw $request_uri where there is one, since a scanner path
// is read undecoded; $uri is decoded, so it is the fallback, with $args put back.
const NGINX = {
    ip: ['remote_addr', 'client_ip', 'remote_ip', 'ip', 'client', 'clientip'],
    time: ['time', 'time_iso8601', 'timestamp', '@timestamp', 'time_local', 'msec', 'ts'],
    method: ['method', 'request_method'],
    target: ['request_uri'],
    uri: ['uri', 'path'],
    args: ['args', 'query_string'],
    status: ['status', 'status_code', 'response'],
    referer: ['referer', 'http_referer', 'referrer', 'http_referrer'],
    ua: ['user_agent', 'http_user_agent', 'agent', 'useragent', 'ua'],
    host: ['host', 'http_host', 'server_name', 'vhost', 'hostname'],
};
const str = v => (typeof v === 'string' && v !== '' ? v : null);
const pick = (e, keys) => { for (const k of keys) { const v = e[k]; if (v != null && v !== '') return v; } return null; };

function nginxEntry(e) {
    const ip = str(pick(e, NGINX.ip));
    if (!ip) return null;
    let method = str(pick(e, NGINX.method));
    let target = str(pick(e, NGINX.target));
    if (!target) {
        const uri = str(pick(e, NGINX.uri));
        const args = str(pick(e, NGINX.args));
        if (uri) target = args && args !== '-' ? `${uri}?${args}` : uri;
    }
    // Or the request line itself, "GET /path?q HTTP/1.1" ($request).
    const line = typeof e.request === 'string' ? /^(\S+) (\S+)/.exec(e.request) : null;
    if (line) { method ??= line[1]; target ??= line[2]; }
    const t = pick(e, NGINX.time);
    // $msec is seconds with a fraction; a number that large is already milliseconds.
    const ts = typeof t === 'number' ? Math.round(t < 1e11 ? t * 1000 : t)
        : typeof t === 'string' ? (/^\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 1000) : Date.parse(t) || clfTime(t)) : NaN;
    const rawStatus = pick(e, NGINX.status);
    const status = rawStatus == null ? NaN : Number(rawStatus);   // Number(null) would be a status 0
    if (!method || !target || !Number.isFinite(ts) || !Number.isInteger(status)) return null;
    return {
        ip, ts, method, target, status,
        referer: str(pick(e, NGINX.referer)) ?? '-', ua: str(pick(e, NGINX.ua)) ?? '-', host: str(pick(e, NGINX.host)),
    };
}

/** A host as a filter compares it: lower case, no port, no trailing dot. */
export const normHost = h => String(h).trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

/** Day (YYYY-MM-DD) of a timestamp in an IANA zone. */
export function dayIn(tz) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    return ts => f.format(ts);
}

const pathOnly = t => String(t).split('?')[0];

function countBy(map, key, n = 1) { map.set(key, (map.get(key) ?? 0) + n); }
function top(map, limit) {
    return [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

/**
 * A streaming digest. add(line) for every log line, then finish(verifier) once.
 * @param {object} o
 * @param {string} [o.site]         the site's host; guessed from Referers when absent
 * @param {string} [o.tz]           zone for days (default America/Los_Angeles, like GSC)
 * @param {string} [o.from] [o.to]  keep only days in [from, to]
 * @param {Set<string>} [o.sitemap] sitemap paths, to count crawler coverage on
 * @param {Array<{label: string, re: RegExp}>} [o.goals] matched against "METHOD path status"
 * @param {RegExp} [o.teamPath]     an IP that got a 2xx on such a path is the site's own team
 * @param {Set<string>} [o.excludeIps]
 * @param {RegExp} [o.allowPath]    a site's own paths that look like scanner probes
 * @param {string[]} [o.hosts]      keep only requests to these hosts (a log of several sites);
 *                                  a line whose format carries no host is kept and counted
 */
export function createLogDigest({
    site = null, tz = 'America/Los_Angeles', from = null, to = null, sitemap = null,
    goals = [], teamPath = null, excludeIps = new Set(), allowPath = null, limit = 15, hosts = [],
} = {}) {
    const keepHosts = hosts.length ? new Set(hosts.map(normHost)) : null;
    const day = dayIn(tz);
    const ips = new Map();       // ip → per-IP facts
    const crawl = new Map();     // `${agent}\t${ip}` → { agent, ip, ua, requests, pages: Map(day → [path]) }
    const generic = { requests: 0, ips: new Set(), uas: new Map() };
    const scannerPaths = new Map();
    const refHosts = new Map();
    let lines = 0, unparsed = 0, outOfRange = 0, otherHost = 0, noHost = 0, firstDay = null, lastDay = null;

    function ipRec(ip) {
        let r = ips.get(ip);
        if (!r) {
            r = { bot: false, scanner: false, asset: false, browser: false, team: false, views: [], goals: new Set() };
            ips.set(ip, r);
        }
        return r;
    }

    function add(line) {
        lines++;
        const q = parseLine(line);
        if (!q) { unparsed++; return; }
        if (keepHosts) {
            if (q.host == null) noHost++;
            else if (!keepHosts.has(normHost(q.host))) { otherHost++; return; }
        }
        const d = day(q.ts);
        if ((from && d < from) || (to && d > to)) { outOfRange++; return; }
        if (!firstDay || d < firstDay) firstDay = d;
        if (!lastDay || d > lastDay) lastDay = d;
        const r = ipRec(q.ip);
        const path = pathOnly(q.target);
        const ok = q.status === 200 || q.status === 304;

        // The 444 rule: a scanner path or a 444 marks the IP for the whole log, whatever its UA.
        if (q.status === 444 || isScannerPath(q.target, { allow: allowPath })) {
            r.scanner = true;
            countBy(scannerPaths, path);
        }
        if (teamPath && q.status >= 200 && q.status < 300 && teamPath.test(path)) r.team = true;

        const named = detectAgent(q.ua) || detectCrawler(q.ua);
        const isPage = q.method === 'GET' && ok && PAGE_RE.test(q.target) && !NOT_PAGE_RE.test(path) && !isScannerPath(q.target, { allow: allowPath });
        if (named) {
            r.bot = true;
            const k = `${named.key}\t${q.ip}`;
            let c = crawl.get(k);
            if (!c) { c = { agent: named.key, ip: q.ip, ua: q.ua, requests: 0, pages: new Map() }; crawl.set(k, c); }
            c.requests++;
            if (isPage) {
                if (!c.pages.has(d)) c.pages.set(d, []);
                c.pages.get(d).push(path);
            }
            return;
        }
        if (GENERIC_BOT_RE.test(q.ua) || !/^Mozilla\//.test(q.ua)) {
            r.bot = true;
            generic.requests++;
            generic.ips.add(q.ip);
            countBy(generic.uas, q.ua.slice(0, 80));
            return;
        }
        r.browser = true;
        if (q.method === 'GET' && ok && ASSET_RE.test(q.target)) {
            r.asset = true;
            // A stylesheet's Referer is the page that loaded it: the site's own host, almost always.
            const h = refererHost(q.referer);
            if (h) countBy(refHosts, h.replace(/^www\./, ''));
        }
        if (isPage) r.views.push({ ts: q.ts, day: d, path, target: q.target, referer: q.referer });
        for (const g of goals) if (g.re.test(`${q.method} ${path} ${q.status}`)) r.goals.add(g.label);
    }

    function finish(verifier) {
        // The site's own host: given, the first --host, or the Referer host asset loads carry most.
        const given = site ?? hosts[0] ?? null;
        const siteHost = given ? normHost(given).replace(/^www\./, '') : (top(refHosts, 1)[0]?.[0] ?? null);

        // People.
        const people = [];
        const set = { bots: 0, scanners: 0, noAssets: 0, team: 0, excluded: 0, cloudFakes: 0 };
        const cloudFakeEngines = new Map();
        for (const [ip, r] of ips) {
            if (!r.views.length && !r.browser) continue;
            if (r.scanner) { if (r.browser) set.scanners++; continue; }
            if (r.bot && !r.browser) continue;
            if (!r.views.length) continue;
            if (excludeIps.has(ip)) { set.excluded++; continue; }
            if (r.team) { set.team++; continue; }
            if (!r.asset) { set.noAssets++; continue; }
            if (r.bot) { set.bots++; continue; }
            r.views.sort((a, b) => a.ts - b.ts);
            const land = r.views[0];
            const src = classifySource(land.referer, land.target, { site: siteHost });
            if (src.kind === 'search' && CLOUD.has(Number(ip.split('.')[0]))) { set.cloudFakes++; countBy(cloudFakeEngines, src.source); continue; }
            people.push({ ip, land, src, views: r.views, goals: r.goals });
        }

        const perDay = new Map();
        const bySource = new Map();
        const pagePeople = new Map();
        for (const p of people) {
            const days = new Set(p.views.map(v => v.day));
            for (const d of days) countBy(perDay, d);
            const key = p.src.source;
            let s = bySource.get(key);
            if (!s) { s = { source: key, kind: p.src.kind, people: 0, landings: new Map(), days: new Map(), goals: new Map() }; bySource.set(key, s); }
            s.people++;
            countBy(s.days, p.land.day);
            countBy(s.landings, p.land.path);
            for (const g of p.goals) countBy(s.goals, g);
            for (const path of new Set(p.views.map(v => v.path))) countBy(pagePeople, path);
        }
        // Every day of the log, zeros included: an average over only the days someone came is not one.
        const dayList = [];
        if (firstDay) {
            for (let t = Date.parse(`${firstDay}T00:00:00Z`); t <= Date.parse(`${lastDay}T00:00:00Z`); t += 86_400_000) {
                const date = new Date(t).toISOString().slice(0, 10);
                dayList.push({ date, people: perDay.get(date) ?? 0 });
            }
        }

        // People per 7-day bucket ending on the last day: unique IPs within each bucket.
        const weeks = [];
        if (lastDay) {
            const end = Date.parse(`${lastDay}T00:00:00Z`);
            const buckets = new Map();
            const goalBuckets = new Map();
            const weekOf = d => Math.floor((end - Date.parse(`${d}T00:00:00Z`)) / (7 * 86_400_000));
            for (const p of people) {
                for (const v of p.views) {
                    const w = weekOf(v.day);
                    if (!buckets.has(w)) buckets.set(w, new Set());
                    buckets.get(w).add(p.ip);
                }
                // A goal belongs to the week of the person's first page view in the log.
                const w = weekOf(p.land.day);
                if (!goalBuckets.has(w)) goalBuckets.set(w, new Map());
                for (const g of p.goals) countBy(goalBuckets.get(w), g);
            }
            for (const w of [...buckets.keys()].sort((a, b) => b - a)) {
                const iso = ms => new Date(ms).toISOString().slice(0, 10);
                const lo = iso(end - (7 * w + 6) * 86_400_000);
                const gb = goalBuckets.get(w);
                weeks.push({
                    from: lo < firstDay ? firstDay : lo, to: iso(end - 7 * w * 86_400_000), people: buckets.get(w).size,
                    goals: Object.fromEntries(goals.map(g => [g.label, gb?.get(g.label) ?? 0])),
                });
            }
        }

        const sources = [...bySource.values()]
            .sort((a, b) => b.people - a.people || a.source.localeCompare(b.source))
            .map(s => ({
                source: s.source, kind: s.kind, people: s.people,
                landings: top(s.landings, 5).map(([path, n]) => ({ path, people: n })),
                // People by the day of their first page view (the click a search console counts).
                landingDays: Object.fromEntries([...s.days].sort((a, b) => a[0].localeCompare(b[0]))),
                goals: Object.fromEntries(top(s.goals, 50)),
            }));
        const goalTotals = Object.fromEntries(goals.map(g => [g.label, people.filter(p => p.goals.has(g.label)).length]));

        // Crawlers: one verdict per (agent, IP). isKnownScannerIp is the 444 rule from this log.
        const isKnownScannerIp = ip => ips.get(ip)?.scanner === true;
        const agents = new Map();
        for (const c of crawl.values()) {
            const v = verifier
                ? verifier.check(c.ip, c.ua)
                : { verdict: 'unknown', reason: 'not-checked', kind: detectAgent(c.ua) ? 'ai' : 'crawler' };
            const verdict = v.verdict === 'unknown' && isKnownScannerIp(c.ip) ? 'spoofed' : v.verdict;
            c.verdict = verdict;
            let a = agents.get(c.agent);
            if (!a) {
                const e = detectAgent(c.ua) || detectCrawler(c.ua);
                a = {
                    agent: c.agent, kind: detectAgent(c.ua) ? 'ai' : 'crawler', purpose: e?.purpose ?? null,
                    requests: 0, ips: 0,
                    verified: { ips: 0, requests: 0, pageFetches: 0, sitemapFetches: 0, pages: new Set(), perDay: new Map(), perDayAll: new Map() },
                    spoofed: { ips: 0, requests: 0 },
                    unknown: { ips: 0, requests: 0, pageFetches: 0 },
                };
                agents.set(c.agent, a);
            }
            a.requests += c.requests;
            a.ips++;
            const fetches = [...c.pages.values()].flat();
            if (verdict === 'verified') {
                const b = a.verified;
                b.ips++; b.requests += c.requests; b.pageFetches += fetches.length;
                for (const [d, ps] of c.pages) {
                    const counted = sitemap ? ps.filter(p => sitemap.has(p)) : ps;
                    countBy(b.perDay, d, counted.length);
                    countBy(b.perDayAll, d, ps.length);
                    b.sitemapFetches += sitemap ? counted.length : 0;
                    for (const p of ps) b.pages.add(p);
                }
            } else if (verdict === 'spoofed') {
                a.spoofed.ips++; a.spoofed.requests += c.requests;
            } else {
                a.unknown.ips++; a.unknown.requests += c.requests; a.unknown.pageFetches += fetches.length;
            }
        }
        const crawlers = [...agents.values()]
            .sort((x, y) => y.verified.pageFetches - x.verified.pageFetches || y.requests - x.requests || x.agent.localeCompare(y.agent))
            .map(a => {
                const v = a.verified;
                const covered = sitemap ? [...v.pages].filter(p => sitemap.has(p)).length : null;
                const offSitemap = sitemap ? [...v.pages].filter(p => !sitemap.has(p)).sort() : null;
                return {
                    agent: a.agent, kind: a.kind, purpose: a.purpose, requests: a.requests, ips: a.ips,
                    verified: {
                        ips: v.ips, requests: v.requests, pageFetches: v.pageFetches,
                        sitemapFetches: sitemap ? v.sitemapFetches : null,
                        uniquePages: v.pages.size, sitemapCovered: covered,
                        offSitemapPages: offSitemap ? offSitemap.slice(0, 10) : null,
                        perWeek: weekly(v.perDay, lastDay, firstDay, v.perDayAll),
                    },
                    spoofed: a.spoofed,
                    unknown: a.unknown,
                };
            });

        let scannerIps = 0;
        for (const r of ips.values()) if (r.scanner) scannerIps++;

        return {
            range: { from: firstDay, to: lastDay, tz },
            site: { host: siteHost, guessed: !given },
            lines: { total: lines, unparsed, outOfRange, otherHost, noHost },
            people: {
                total: people.length,
                perDay: dayList,
                avgPerDay: dayList.length ? Math.round((10 * dayList.reduce((s, d) => s + d.people, 0)) / dayList.length) / 10 : 0,
                weeks,
                setAside: { ...set, cloudFakeReferers: Object.fromEntries(top(cloudFakeEngines, 10)) },
            },
            sources,
            goals: goalTotals,
            pages: top(pagePeople, limit).map(([path, n]) => ({ path, people: n })),
            crawlers,
            sitemap: sitemap ? sitemapCoverage(sitemap, crawlers, crawl, limit) : null,
            otherBots: { requests: generic.requests, ips: generic.ips.size, topUserAgents: top(generic.uas, 5).map(([ua, n]) => ({ ua, requests: n })) },
            scanners: { ips: scannerIps, topPaths: top(scannerPaths, 5).map(([path, n]) => ({ path, requests: n })) },
        };
    }

    return { add, finish };
}

// Sitemap URLs no verified search crawler fetched in this log. On one site a clean guide was
// never fetched by Googlebot in 21 days and had 0 impressions; it was linked from too few pages.
function sitemapCoverage(sitemap, crawlers, crawl, limit) {
    const fetched = new Set();
    for (const c of crawl.values()) {
        if (c.verdict !== 'verified' || crawlers.find(x => x.agent === c.agent)?.purpose !== 'search') continue;
        for (const ps of c.pages.values()) for (const p of ps) fetched.add(p);
    }
    const never = [...sitemap].filter(p => !fetched.has(p));
    return { urls: sitemap.size, fetchedBySearch: sitemap.size - never.length, neverFetched: never.slice(0, limit), neverFetchedCount: never.length };
}

// Verified fetches per 7-day bucket ending on the last day: `fetches` counts sitemap URLs only when
// a sitemap was given, `pageFetches` every page. `share` sends the second, so a benchmark row
// means the same thing with or without a sitemap.
function weekly(perDay, lastDay, firstDay, perDayAll) {
    if (!lastDay) return [];
    const end = Date.parse(`${lastDay}T00:00:00Z`);
    const bucket = (byDay) => {
        const b = new Map();
        for (const [d, n] of byDay) countBy(b, Math.floor((end - Date.parse(`${d}T00:00:00Z`)) / (7 * 86_400_000)), n);
        return b;
    };
    const b = bucket(perDay);
    const all = bucket(perDayAll);
    const out = [];
    const nWeeks = Math.floor((end - Date.parse(`${firstDay}T00:00:00Z`)) / (7 * 86_400_000));
    for (let w = nWeeks; w >= 0; w--) {
        const iso = ms => new Date(ms).toISOString().slice(0, 10);
        const lo = iso(end - (7 * w + 6) * 86_400_000);
        out.push({ from: lo < firstDay ? firstDay : lo, to: iso(end - 7 * w * 86_400_000), fetches: b.get(w) ?? 0, pageFetches: all.get(w) ?? 0 });
    }
    return out;
}

/** Feed every line of a log file (plain or .gz) to digest.add. */
export async function readLog(file, digest) {
    let stream = createReadStream(file);
    if (/\.gz$/i.test(file)) stream = stream.pipe(createGunzip());
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) if (line) digest.add(line);
}
