// The service as one Web-standard fetch handler plus two jobs, so the same code runs behind
// node:http (src/node.js) or any host that speaks Request/Response.
//
//   GET  /v1/lists.json      the merged crawler-list feed (feed.js)
//   POST /v1/share           one site's week of aggregates → stored → its percentiles
//   GET  /v1/benchmark.json  the public aggregate (benchmark.js)
//   GET  /healthz            when the feed and the aggregate were last built
//
// PRIVACY. The sender's IP is never read here: not stored, not logged, not used for limits. A row
// keeps the day it arrived, not the time, so it cannot be lined up against a host's request log.
// What arrives is checked against an allowlist (validateShare); anything else is refused, not
// trimmed, so a client bug that would leak a hostname fails loudly instead of quietly.
//
// ABUSE. Anyone can post. A site re-sharing a week replaces its row; a cap on new sites per day
// bounds how fast a flood of made-up ids can move the benchmark; bounds on every metric refuse
// garbage. It is a benchmark of what people chose to send, and the page says so.

import { validateShare, isoWeek, weekStart, addWeeks } from '../../packages/verify/src/share.js';
import { VERSION } from '../../packages/verify/src/version.js';
import { buildFeed, FEED_KEY } from './feed.js';
import { compare, aggregate, windowOf, MIN_SITES } from './benchmark.js';

export const BENCHMARK_KEY = 'benchmark.json';
export const MAX_SHARE_BYTES = 8 * 1024;
export const MAX_WEEKS_BACK = 8;
export const MAX_NEW_SITES_PER_DAY = 100;

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

/**
 * @param {object} o
 * @param {{get, put, delete, list}} o.store   store.js
 * @param {() => number} [o.now]
 * @param {Function} [o.fetch]                 for the feed job's vendor GETs
 * @param {string} [o.publicUrl]               where the benchmark page lives, for share's answer
 */
export function createApp({
    store, now = Date.now, fetch: fetchImpl = globalThis.fetch, log = console,
    publicUrl = 'https://siteread.dev', minSites = MIN_SITES,
    maxNewSitesPerDay = MAX_NEW_SITES_PER_DAY, maxWeeksBack = MAX_WEEKS_BACK,
} = {}) {
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
            return refuse(415, 'send the share as application/json');
        }
        if (Number(request.headers.get('content-length')) > MAX_SHARE_BYTES) return refuse(413, `a share is at most ${MAX_SHARE_BYTES} bytes`);
        const text = await readCapped(request, MAX_SHARE_BYTES);
        if (text == null) return refuse(413, `a share is at most ${MAX_SHARE_BYTES} bytes`);
        let body;
        try { body = JSON.parse(text); } catch { return refuse(400, 'the body is not JSON'); }
        const v = validateShare(body);
        if (!v.ok) return refuse(400, v.error);
        const s = v.share;

        const t = now();
        const current = isoWeek(t);
        if (weekStart(s.week) > weekStart(current)) return refuse(400, `week ${s.week} has not started yet (it is ${current})`);
        if (weekStart(s.week) < weekStart(addWeeks(current, -maxWeeksBack))) return refuse(400, `week ${s.week} is more than ${maxWeeksBack} weeks ago`);

        const today = isoDay(t);
        if ((await store.get(`sites/${s.id}`)) == null) {
            if ((await store.list(`new/${today}/`)).length >= maxNewSitesPerDay) {
                return refuse(429, 'too many new sites today; try again tomorrow', { 'retry-after': '3600' });
            }
            await store.put(`new/${today}/${s.id}`, '1');
            await store.put(`sites/${s.id}`, JSON.stringify({ firstSharedOn: today }));
        }
        await store.put(`shares/${s.week}/${s.id}.json`, JSON.stringify({ ...s, receivedOn: today }));

        const rows = (await Promise.all(windowOf(s.week).map(w => rowsUnder(`shares/${w}/`)))).flat();
        return json(200, { ok: true, ...compare(rows, s), benchmark: `${publicUrl}/benchmark` });
    }

    async function health() {
        const [feed, bench] = await Promise.all([readJson(FEED_KEY), readJson(BENCHMARK_KEY)]);
        return json(200, {
            ok: true, siteread: VERSION,
            feed: feed ? { generatedAt: feed.generatedAt, lists: Object.keys(feed.lists ?? {}).length } : null,
            benchmark: bench ? { generatedAt: bench.generatedAt, sites: bench.sites } : null,
        }, { 'cache-control': 'no-store' });
    }

    const routes = {
        '/v1/lists.json': { GET: () => serveDoc(FEED_KEY, 'feed') },
        '/v1/share': { POST: share },
        '/v1/benchmark.json': { GET: () => serveDoc(BENCHMARK_KEY, 'benchmark') },
        '/healthz': { GET: health },
    };

    /** The fetch handler. Never throws: a failure is a 500 with no detail. */
    async function handle(request) {
        const route = routes[new URL(request.url).pathname];
        if (!route) return refuse(404, 'not found');
        const fn = route[request.method === 'HEAD' ? 'GET' : request.method];
        if (!fn) return refuse(405, `${request.method} is not allowed here`, { allow: Object.keys(route).join(', ') });
        try { return await fn(request); } catch (err) {
            log?.error?.(`[siteread-cloud] ${new URL(request.url).pathname}: ${err?.message || err}`);
            return refuse(500, 'internal error');
        }
    }

    /** The feed job: fetch the vendor lists, publish the merged feed. */
    async function runFeed() {
        return buildFeed({ store, fetch: fetchImpl, now, log });
    }

    /** The aggregate job: every stored row → benchmark.json; prunes the new-site markers. */
    async function runAggregate() {
        const doc = aggregate(await rowsUnder('shares/'), { now: now(), minSites });
        await store.put(BENCHMARK_KEY, JSON.stringify(doc));
        const yesterday = isoDay(now() - 86_400_000);
        for (const k of await store.list('new/')) if (k.split('/')[1] < yesterday) await store.delete(k);
        return doc;
    }

    return { fetch: handle, runFeed, runAggregate };
}
