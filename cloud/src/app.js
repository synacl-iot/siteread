// The service as one Web-standard fetch handler plus its jobs, so the same code runs behind
// node:http (src/node.js) or any host that speaks Request/Response.
//
//   GET  /v1/lists.json        the merged crawler-list feed (feed.js)
//   POST /v1/share             one site's week of aggregates → stored → its standing (benchmark.js)
//   GET  /v1/benchmark.json    the public aggregate (benchmark.js)
//   GET  /v1/operator/status   counts for the operator page; needs the operator token (config.js)
//   GET  /healthz              when the feed and the aggregate were last built
//
// PRIVACY. The sender's IP is never read here: not stored, not logged, not used for limits. A row
// keeps the day it arrived, not the time, so it cannot be lined up against a host's request log.
// What arrives is checked against an allowlist (validateShare); anything else is refused, not
// trimmed, so a client bug that would leak a hostname fails loudly instead of quietly. Refusals
// are counted by a fixed code, never by their message, which can echo a field name the sender
// chose. The operator status is counts only: no row, no id, no label it was not already public.
//
// USAGE. siteread analyses sites, so it measures its own service too, without an address: every
// request is counted per day by route and by kind of client (clientOf), and a siteread client by
// its version. Each client refetches the feed at most once a day, so feed fetches a day are about
// the number of installs using it. No User-Agent string is kept, only the kind and a version that
// parses as one, at most MAX_VERSIONS a day, so a flood of made-up agents cannot grow the counts.
//
// ABUSE. Anyone can post. A site re-sharing a week replaces its row; a cap on new sites per day
// bounds how fast a flood of made-up ids can move the benchmark; bounds on every metric refuse
// garbage. It is a benchmark of what people chose to send, and the page says so.

import { validateShare, isoWeek, weekStart, addWeeks } from '../../packages/verify/src/share.js';
import { VERSION } from '../../packages/verify/src/version.js';
import { buildFeed, FEED_KEY } from './feed.js';
import { standing, aggregate, MIN_SITES } from './benchmark.js';

export const BENCHMARK_KEY = 'benchmark.json';
export const LAST_RUN_KEY = 'feed/last-run.json';
export const MAX_SHARE_BYTES = 8 * 1024;
export const MAX_WEEKS_BACK = 8;
export const MAX_NEW_SITES_PER_DAY = 100;
export const STATS_DAYS = 30;
export const MAX_VERSIONS = 20;

// The routes counted, by path; anything else is `other` (a 404, a probe).
const ROUTE_OF = {
    '/v1/lists.json': 'feed', '/v1/share': 'share', '/v1/benchmark.json': 'benchmark',
    '/v1/operator/status': 'operator', '/healthz': 'health',
};
const VERSION_UA_RE = /^siteread\/(\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[0-9a-z.]{1,20})?)(?:\s|$)/i;

/**
 * The kind of client behind a request: `local` (it did not come through the proxy: the site's own
 * server rendering a page, or a job on the VM), `siteread` with its version, `browser`, `other`.
 * Read from whether the proxy's x-forwarded-proto is present and from the User-Agent; never from
 * an address.
 */
export function clientOf(request) {
    if (!request.headers.has('x-forwarded-proto')) return { client: 'local', version: null };
    const ua = request.headers.get('user-agent') ?? '';
    const m = VERSION_UA_RE.exec(ua);
    if (m) return { client: 'siteread', version: m[1].toLowerCase() };
    return { client: /^Mozilla\//.test(ua) ? 'browser' : 'other', version: null };
}

const emptyCounts = () => ({ taken: 0, refused: {}, hits: {}, versions: {} });

/** Adds one day's counts into another, in place. */
function mergeCounts(into, c) {
    into.taken += c.taken ?? 0;
    for (const [k, n] of Object.entries(c.refused ?? {})) into.refused[k] = (into.refused[k] ?? 0) + n;
    for (const [route, by] of Object.entries(c.hits ?? {})) {
        const r = (into.hits[route] ??= {});
        for (const [client, n] of Object.entries(by)) r[client] = (r[client] ?? 0) + n;
    }
    for (const [v, n] of Object.entries(c.versions ?? {})) into.versions[v] = (into.versions[v] ?? 0) + n;
    return into;
}

const DAY = 86_400_000;
const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };
// The feed and the benchmark are public data: any page may read them, caches may keep them an hour.
const PUBLIC = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' };

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { ...JSON_TYPE, ...headers } });
}
const refuse = (status, error, headers) => json(status, { ok: false, error }, headers);

// The body, at most `max` bytes: a client streaming forever is cut off, not buffered.
async function readCapped(request, max) {
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    const buf = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
    return new TextDecoder().decode(buf);
}

// Two secrets compared in constant time: SHA-256 makes the lengths equal, the XOR loop never
// stops early. Web Crypto, so it runs wherever the handler does.
async function sameSecret(a, b) {
    const enc = new TextEncoder();
    const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
    const u = new Uint8Array(x), v = new Uint8Array(y);
    let diff = 0;
    for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
    return diff === 0;
}

/**
 * @param {object} o
 * @param {{get, put, delete, list}} o.store   store.js
 * @param {() => number} [o.now]
 * @param {Function} [o.fetch]                 for the feed job's vendor GETs
 * @param {string} [o.publicUrl]               where the benchmark page lives, for share's answer
 * @param {Map<string, string>} [o.named]      share id → public label (config.js)
 * @param {string|null} [o.operatorToken]      unset: no operator route at all
 * @param {string} [o.operatorOrigin]          the one browser origin that may call it
 */
export function createApp({
    store, now = Date.now, fetch: fetchImpl = globalThis.fetch, log = console,
    publicUrl = 'https://siteread.dev', minSites = MIN_SITES,
    maxNewSitesPerDay = MAX_NEW_SITES_PER_DAY, maxWeeksBack = MAX_WEEKS_BACK,
    named = new Map(), operatorToken = null, operatorOrigin = 'https://siteread.dev',
} = {}) {
    // day → { taken, refused: { code → n }, hits: { route → { client → n } }, versions: { v → n } },
    // merged into stats/<day>.json by flushStats(): one store write an hour instead of one per request.
    const counts = new Map();
    function today() {
        const day = isoDay(now());
        let c = counts.get(day);
        if (!c) { c = emptyCounts(); counts.set(day, c); }
        return c;
    }
    function count(code) {
        const c = today();
        if (code === 'taken') c.taken++;
        else c.refused[code] = (c.refused[code] ?? 0) + 1;
    }
    function hit(route, request) {
        const c = today();
        const { client, version } = clientOf(request);
        const r = (c.hits[route] ??= {});
        r[client] = (r[client] ?? 0) + 1;
        if (version && (Object.hasOwn(c.versions, version) || Object.keys(c.versions).length < MAX_VERSIONS)) {
            c.versions[version] = (c.versions[version] ?? 0) + 1;
        }
    }
    const refused = (code, status, error, headers) => { count(code); return refuse(status, error, headers); };

    async function readJson(key) {
        const text = await store.get(key);
        if (text == null) return null;
        try { return JSON.parse(text); } catch { return null; }
    }

    async function rowsUnder(prefix) {
        const keys = await store.list(prefix);
        return (await Promise.all(keys.map(readJson))).filter(Boolean);
    }

    async function serveDoc(key, what) {
        const text = await store.get(key);
        if (text == null) return refuse(503, `the ${what} has not been built yet`, { 'retry-after': '600' });
        return new Response(text, { status: 200, headers: { ...JSON_TYPE, ...PUBLIC } });
    }

    async function share(request) {
        if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) {
            return refused('content-type', 415, 'send the share as application/json');
        }
        const tooLarge = `a share is at most ${MAX_SHARE_BYTES} bytes`;
        if (Number(request.headers.get('content-length')) > MAX_SHARE_BYTES) return refused('too-large', 413, tooLarge);
        const text = await readCapped(request, MAX_SHARE_BYTES);
        if (text == null) return refused('too-large', 413, tooLarge);
        let body;
        try { body = JSON.parse(text); } catch { return refused('not-json', 400, 'the body is not JSON'); }
        const v = validateShare(body);
        if (!v.ok) return refused(v.code, 400, v.error);
        const s = v.share;

        const t = now();
        const current = isoWeek(t);
        if (weekStart(s.week) > weekStart(current)) return refused('future-week', 400, `week ${s.week} has not started yet (it is ${current})`);
        if (weekStart(s.week) < weekStart(addWeeks(current, -maxWeeksBack))) return refused('old-week', 400, `week ${s.week} is more than ${maxWeeksBack} weeks ago`);

        const today = isoDay(t);
        if ((await store.get(`sites/${s.id}`)) == null) {
            if ((await store.list(`new/${today}/`)).length >= maxNewSitesPerDay) {
                return refused('new-site-cap', 429, 'too many new sites today; try again tomorrow', { 'retry-after': '3600' });
            }
            await store.put(`new/${today}/${s.id}`, '1');
            await store.put(`sites/${s.id}`, JSON.stringify({ firstSharedOn: today }));
        }
        await store.put(`shares/${s.week}/${s.id}.json`, JSON.stringify({ ...s, receivedOn: today }));
        count('taken');

        // Against the published snapshot, never the live rows: see standing().
        return json(200, { ok: true, ...standing(s, await readJson(BENCHMARK_KEY)), benchmark: `${publicUrl}/benchmark` });
    }

    async function health() {
        const [feed, bench] = await Promise.all([readJson(FEED_KEY), readJson(BENCHMARK_KEY)]);
        return json(200, {
            ok: true, siteread: VERSION,
            feed: feed ? { generatedAt: feed.generatedAt, lists: Object.keys(feed.lists ?? {}).length } : null,
            benchmark: bench ? { generatedAt: bench.generatedAt, sites: bench.sites } : null,
        }, { 'cache-control': 'no-store' });
    }

    // The operator page lives on another origin and sends a header, so the browser preflights.
    // Only that origin gets the CORS answer; anywhere else the browser refuses to read the reply.
    function operatorCors(request) {
        return request.headers.get('origin') === operatorOrigin
            ? { 'access-control-allow-origin': operatorOrigin, vary: 'origin' }
            : { vary: 'origin' };
    }

    function operatorPreflight(request) {
        const cors = operatorCors(request);
        if (cors['access-control-allow-origin']) {
            Object.assign(cors, { 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'authorization', 'access-control-max-age': '600' });
        }
        return new Response(null, { status: 204, headers: cors });
    }

    async function operatorStatus(request) {
        const headers = { ...operatorCors(request), 'cache-control': 'no-store' };
        const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
        if (!m || !(await sameSecret(m[1], operatorToken))) {
            count('operator-denied');
            return refuse(401, 'the operator token is missing or wrong', { ...headers, 'www-authenticate': 'Bearer' });
        }
        const t = now();
        const [feed, lastRun, bench, sites, stats] = await Promise.all([
            readJson(FEED_KEY), readJson(LAST_RUN_KEY), readJson(BENCHMARK_KEY),
            rowsUnder('sites/'), statsByDay(),
        ]);
        const days = Array.from({ length: 14 }, (_, i) => isoDay(t - (13 - i) * DAY));
        const newPerDay = new Map(days.map(d => [d, 0]));
        for (const s of sites) if (newPerDay.has(s.firstSharedOn)) newPerDay.set(s.firstSharedOn, newPerDay.get(s.firstSharedOn) + 1);
        const today = isoDay(t);
        return json(200, {
            ok: true, siteread: VERSION, now: new Date(t).toISOString(),
            feed: feed ? {
                generatedAt: feed.generatedAt,
                lists: Object.entries(feed.lists ?? {}).map(([agent, l]) => ({
                    agent, prefixes: l.prefixes?.length ?? 0, fetchedAt: l.fetchedAt,
                    ageHours: Math.round((t - Date.parse(l.fetchedAt)) / 360_000) / 10,
                })),
            } : null,
            lastFeedRun: lastRun,
            benchmark: bench ? {
                generatedAt: bench.generatedAt, sites: bench.sites, window: bench.window, history: bench.history,
                named: (bench.named ?? []).map(n => ({ label: n.label, week: n.week })),
            } : null,
            newSites: days.map(day => ({ day, sites: newPerDay.get(day) })),
            newSitesToday: { sites: newPerDay.get(today), max: maxNewSitesPerDay },
            requests: days.map(day => ({ day, ...(stats.get(day) ?? emptyCounts()) })),
        }, headers);
    }

    // Stored counts plus what this process has not flushed yet.
    async function statsByDay() {
        const out = new Map();
        const add = (day, c) => out.set(day, mergeCounts(out.get(day) ?? emptyCounts(), c));
        for (const k of await store.list('stats/')) {
            const c = await readJson(k);
            if (c) add(k.slice('stats/'.length, -'.json'.length), c);
        }
        for (const [day, c] of counts) add(day, c);
        return out;
    }

    const routes = {
        '/v1/lists.json': { GET: () => serveDoc(FEED_KEY, 'feed') },
        '/v1/share': { POST: share },
        '/v1/benchmark.json': { GET: () => serveDoc(BENCHMARK_KEY, 'benchmark') },
        '/healthz': { GET: health },
    };
    if (operatorToken) routes['/v1/operator/status'] = { GET: operatorStatus, OPTIONS: operatorPreflight };

    /** The fetch handler. Never throws: a failure is a 500 with no detail. */
    async function handle(request) {
        const path = new URL(request.url).pathname;
        hit(ROUTE_OF[path] ?? 'other', request);
        const route = routes[path];
        if (!route) return refuse(404, 'not found');
        const fn = route[request.method === 'HEAD' ? 'GET' : request.method];
        if (!fn) return refuse(405, `${request.method} is not allowed here`, { allow: Object.keys(route).join(', ') });
        try { return await fn(request); } catch (err) {
            count('internal');
            log?.error?.(`[siteread-cloud] ${new URL(request.url).pathname}: ${err?.message || err}`);
            return refuse(500, 'internal error');
        }
    }

    /** The feed job: fetch the vendor lists, publish the merged feed, record how the run went. */
    async function runFeed() {
        const at = new Date(now()).toISOString();
        try {
            const r = await buildFeed({ store, fetch: fetchImpl, now, log });
            const { fetched, failed, dropped, errors } = r.result;
            await store.put(LAST_RUN_KEY, JSON.stringify({ at, fetched, failed, dropped, errors }));
            return r;
        } catch (err) {
            await store.put(LAST_RUN_KEY, JSON.stringify({ at, error: err?.message || String(err) })).catch(() => {});
            throw err;
        }
    }

    /** The aggregate job: every stored row → benchmark.json; prunes the new-site markers. */
    async function runAggregate() {
        const doc = aggregate(await rowsUnder('shares/'), { now: now(), minSites, named });
        await store.put(BENCHMARK_KEY, JSON.stringify(doc));
        const yesterday = isoDay(now() - DAY);
        for (const k of await store.list('new/')) if (k.split('/')[1] < yesterday) await store.delete(k);
        return doc;
    }

    /** Merge this process's request counts into the store and forget them; drop days past 30. */
    async function flushStats() {
        const pending = [...counts];
        counts.clear();
        for (const [day, c] of pending) {
            const key = `stats/${day}.json`;
            await store.put(key, JSON.stringify(mergeCounts(mergeCounts(emptyCounts(), (await readJson(key)) ?? {}), c)));
        }
        const oldest = isoDay(now() - STATS_DAYS * DAY);
        for (const k of await store.list('stats/')) if (k.slice('stats/'.length, -'.json'.length) < oldest) await store.delete(k);
    }

    return { fetch: handle, runFeed, runAggregate, flushStats };
}
