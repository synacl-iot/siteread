// A verdict for one request: is the IP that sent this User-Agent really that vendor's crawler?
//
//   verified  the agent's vendor publishes an IP list and the IP is in it
//   spoofed   the vendor publishes a list and the IP is not in it (or the UA is a robots.txt
//             token nothing real sends, or `isKnownScannerIp` says the IP probed scanner paths)
//   unknown   no list to check against: the vendor publishes none, or it could not be loaded
//   n/a       the UA claims to be no known AI agent or search crawler
//
// A vendor list always wins over the 444 rule: ClaudeBot once followed a broken README link
// into a scanner path, and the 444 rule called a real crawler spoofed (ip-ranges.js).
//
// Refresh rules (ip-ranges.js): refetch a list when the stored copy is
// > 24 h old, keep the old copy when a fetch fails, drop a copy nobody could refresh for 8 days.
// Nothing here throws.

import {
    SOURCES, REFRESH_AFTER_MS, DROP_AFTER_MS,
    normIp, normDoc, buildMatcher, fetchJson, fetchList, parsePrefixes, fetchedAtMs, youngerThan,
} from './ip-ranges.js';
import { detectAgent, detectCrawler } from './agents.js';
import { VERSION } from './version.js';

const USER_AGENT = `siteread/${VERSION} (+https://www.npmjs.com/package/siteread)`;

/** The default store: one process, nothing on disk. */
export function memoryStore(initial = null) {
    let doc = initial;
    return {
        async get() { return doc; },
        async set(next) { doc = next; },
    };
}

/**
 * @param {object} [opts]
 * @param {Function} [opts.fetch]  WHATWG fetch (default globalThis.fetch)
 * @param {{get(): Promise<object|null>, set(doc: object): Promise<void>}} [opts.store]
 * @param {Array<{agent: string, url: string}>} [opts.sources]
 * @param {() => number} [opts.now]
 * @param {{warn?: Function, error?: Function}} [opts.log]
 * @param {string|null} [opts.feedUrl]  one merged document instead of the vendor URLs
 * @param {boolean} [opts.fallback]     with feedUrl: fetch from the vendors what the feed could not give
 * @param {(ip: string) => boolean} [opts.isKnownScannerIp]  the 444 rule, for agents with no list
 */
export function createVerifier({
    fetch: fetchImpl = globalThis.fetch,
    store = memoryStore(),
    sources = SOURCES,
    now = Date.now,
    log = console,
    feedUrl = null,
    fallback = false,
    isKnownScannerIp = null,
} = {}) {
    // One entry per agent (the first wins), in the order given.
    const srcs = [];
    const urlOf = new Map();
    for (const s of sources) {
        if (!s || typeof s.agent !== 'string' || typeof s.url !== 'string' || urlOf.has(s.agent)) continue;
        srcs.push({ agent: s.agent, url: s.url });
        urlOf.set(s.agent, s.url);
    }
    let matcher = buildMatcher(null, { sources: srcs, now: now() });

    async function fetchFromVendors(due, t, doc, out) {
        // One GET per distinct URL: Anthropic's bots.json serves three agents.
        const urls = [...new Set(due.map(d => d.url))];
        const results = await Promise.allSettled(urls.map(u => fetchList(u, fetchImpl, { userAgent: USER_AGENT })));
        const byUrl = new Map(urls.map((u, i) => [u, results[i]]));
        for (const { agent, url } of due) {
            const r = byUrl.get(url);
            if (r.status === 'fulfilled') {
                doc.lists[agent] = { prefixes: r.value, fetchedAt: new Date(t).toISOString() };
                out.fetched.push(agent);
            } else {
                // Keep whatever copy is stored: a vendor's CDN hiccup must not turn every one
                // of its real crawlers into "spoofed" until the next refresh.
                fail(out, agent, r.reason, `${agent} (${url})`);
            }
        }
    }

    // The future hosted feed: { lists: { agent: { prefixes: [cidr], fetchedAt } } }, one GET.
    // Every prefix is re-validated exactly like a vendor's, and a list keeps the feed's own
    // fetchedAt (when the FEED fetched it from the vendor), so the 24 h / 8 day rules still
    // measure the age of the vendor data, not of the feed hop.
    async function fetchFromFeed(due, t, doc, out) {
        let body;
        try {
            body = await fetchJson(feedUrl, fetchImpl, { userAgent: USER_AGENT });
        } catch (err) {
            for (const { agent } of due) fail(out, agent, err, `feed (${feedUrl})`);
            return;
        }
        const lists = body && typeof body.lists === 'object' && body.lists ? body.lists : {};
        for (const { agent } of due) {
            const l = Object.hasOwn(lists, agent) ? lists[agent] : null;
            const prefixes = parsePrefixes(l?.prefixes);
            // A future fetchedAt is clamped to now: it would otherwise keep the copy fresh forever.
            const at = Math.min(fetchedAtMs(l), t);
            const stored = fetchedAtMs(doc.lists[agent]);
            if (!prefixes.length) { fail(out, agent, new Error('no usable prefixes in feed'), 'feed'); continue; }
            if (!Number.isFinite(at)) { fail(out, agent, new Error('feed list has no fetchedAt'), 'feed'); continue; }
            if (Number.isFinite(stored) && at <= stored) { fail(out, agent, new Error('feed copy is not newer'), 'feed'); continue; }
            doc.lists[agent] = { prefixes, fetchedAt: new Date(at).toISOString() };
            out.fetched.push(agent);
        }
    }

    function fail(out, agent, err, what) {
        const msg = err?.message || String(err);
        out.failed.push(agent);
        out.errors[agent] = msg;
        log?.warn?.(`[siteread] ${what} failed: ${msg}`);
    }

    /**
     * One refresh pass: read the store, fetch what is due, drop what is too old, write back.
     * Never throws. Returns { fetched, failed, fresh, dropped, errors } (agent keys; errors maps
     * a failed agent to its reason) and `error` when the store itself failed.
     * `force` refetches every list whatever its age (a failed fetch still keeps the old copy).
     */
    async function refresh({ force = false } = {}) {
        const t = now();
        const out = { fetched: [], failed: [], fresh: [], dropped: [], errors: {} };
        let doc;
        try {
            doc = normDoc(await store.get());
        } catch (err) {
            log?.error?.(`[siteread] store read failed: ${err.message}`);
            out.error = err.message;
            return out;
        }
        try {
            const due = [];
            for (const s of srcs) {
                if (!force && youngerThan(fetchedAtMs(doc.lists[s.agent]), t, REFRESH_AFTER_MS)) out.fresh.push(s.agent);
                else due.push(s);
            }
            if (due.length) {
                if (typeof fetchImpl !== 'function') {
                    for (const { agent } of due) fail(out, agent, new Error('no fetch available'), agent);
                } else if (feedUrl) {
                    await fetchFromFeed(due, t, doc, out);
                    // The feed is a shortcut to the vendors, never the only way to them: what it
                    // could not give (down, stale, a list missing) comes from the vendor itself.
                    const missed = fallback ? due.filter(s => out.failed.includes(s.agent)) : [];
                    if (missed.length) {
                        for (const { agent } of missed) delete out.errors[agent];
                        out.failed = out.failed.filter(a => !missed.some(s => s.agent === a));
                        await fetchFromVendors(missed, t, doc, out);
                    }
                } else {
                    await fetchFromVendors(due, t, doc, out);
                }
            }
            for (const [agent, l] of Object.entries(doc.lists)) {
                if (urlOf.has(agent) && youngerThan(fetchedAtMs(l), t, DROP_AFTER_MS)) continue;
                delete doc.lists[agent];
                out.dropped.push(agent);
            }
            if (out.fetched.length || out.dropped.length) await store.set(doc);
        } catch (err) {
            log?.error?.(`[siteread] refresh failed: ${err.message}`);
            out.error = err.message;
        }
        // Whatever made it into `doc` is usable in this process even if the store write failed.
        matcher = buildMatcher(doc, { sources: srcs, now: t });
        return out;
    }

    /** Rebuild the matcher from the store without fetching (a reader beside one refresher). */
    async function load() {
        const t = now();
        try {
            matcher = buildMatcher(normDoc(await store.get()), { sources: srcs, now: t });
        } catch (err) {
            log?.error?.(`[siteread] store read failed: ${err.message}`);
        }
        return lists();
    }

    /** The verdict for one request. Synchronous: uses the lists the last refresh()/load() saw. */
    function check(ip, ua) {
        const agent = detectAgent(ua);
        const e = agent || detectCrawler(ua);
        if (!e) {
            return { agent: null, kind: null, assistant: null, purpose: null, verdict: 'n/a', reason: 'not-a-known-agent', source: null };
        }
        const base = {
            agent: e.key,
            kind: agent ? 'ai' : 'crawler',
            assistant: e.assistant ?? null,
            purpose: e.purpose,
            source: urlOf.get(e.key) ?? null,
        };
        if (e.robotsTokenOnly) return { ...base, verdict: 'spoofed', reason: 'robots-token-not-a-user-agent' };
        const addr = normIp(ip);
        if (!addr) return { ...base, verdict: 'unknown', reason: 'invalid-ip' };
        if (matcher.hasList(e.key)) {
            return matcher.contains(e.key, addr)
                ? { ...base, verdict: 'verified', reason: 'in-vendor-list' }
                : { ...base, verdict: 'spoofed', reason: 'not-in-vendor-list' };
        }
        // No list. The 444 rule, if the caller supplies it: an IP that probed scanner paths is not
        // the crawler it claims to be. It can only ever turn 'unknown' into 'spoofed'.
        if (typeof isKnownScannerIp === 'function') {
            let hit = false;
            try { hit = Boolean(isKnownScannerIp(addr.ip)); } catch { hit = false; }
            if (hit) return { ...base, verdict: 'spoofed', reason: 'known-scanner-ip' };
        }
        return { ...base, verdict: 'unknown', reason: base.source ? 'list-unavailable' : 'no-vendor-list' };
    }

    /** Freshness of every source, in `sources` order. */
    function lists() {
        const t = now();
        return srcs.map(({ agent, url }) => {
            const l = matcher.get(agent);
            return {
                agent,
                url,
                prefixes: l?.prefixes ?? 0,
                fetchedAt: l?.fetchedAt ?? null,
                fresh: l ? youngerThan(Date.parse(l.fetchedAt), t, REFRESH_AFTER_MS) : false,
            };
        });
    }

    return { refresh, load, check, lists };
}
