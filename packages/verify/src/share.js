// `siteread share`: one week of a digest → the numbers a site can choose to send to the public
// benchmark, and the validator the endpoint runs on whatever arrives. Opt-in: the CLI prints the
// exact bytes it will send and sends nothing without a yes.
//
// WHAT NEVER LEAVES: hostnames, URLs or paths, visitor IPs, user-agents, query text, goal labels.
// The payload is built from an allowlist of numeric metrics, so a field added to the digest later
// cannot leak by accident, and the endpoint rejects any key or string it does not know for the
// same reason. The only strings are the schema's own: a random id, an ISO week and the version.
//
// The id is 128 random bits the CLI keeps in .siteread/share-id. It is what makes the benchmark's
// `n` count sites rather than shares, and lets a site that shares the same week twice replace its
// row instead of counting twice. Delete the file to start over as a new site.

import { VERSION } from './version.js';

export const SHARE_SCHEMA = 1;
// Where `share` sends by default: the service's address is written here and nowhere else.
export const SHARE_URL = 'https://api.siteread.dev/v1/share';

const DAY = 86_400_000;
const BIG = 1e9;

// Every metric describes the last 7 days the digest covers (the digest's newest 7-day bucket),
// except aiSpoofedPct, a ratio over the whole log. Bounds reject garbage, not big sites.
export const SHARE_METRICS = Object.freeze({
    people:              { int: true, min: 0, max: BIG, about: 'people who read a page (an IP with a browser UA that loaded an asset and never probed a scanner path)' },
    peopleFromSearch:    { int: true, min: 0, max: BIG, about: 'people whose first visit in the week came from a search engine' },
    peopleFromAi:        { int: true, min: 0, max: BIG, about: 'people whose first visit in the week came from an AI assistant (Referer or utm_source)' },
    peopleFromSocial:    { int: true, min: 0, max: BIG, about: 'people whose first visit in the week came from a social site or forum' },
    aiAnswerFetches:     { int: true, min: 0, max: BIG, about: 'page fetches by AI agents reading for a person right now (ChatGPT-User, Perplexity-User, Claude-User), verified against vendor lists' },
    aiSearchFetches:     { int: true, min: 0, max: BIG, about: 'page fetches by AI search indexers (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Applebot), verified' },
    aiTrainingFetches:   { int: true, min: 0, max: BIG, about: 'page fetches by AI training crawlers (GPTBot, ClaudeBot), verified' },
    searchEngineFetches: { int: true, min: 0, max: BIG, about: 'page fetches by Googlebot and bingbot, verified' },
    aiSpoofedPct:        { int: false, min: 0, max: 100, about: 'share of requests under an AI user-agent that were spoofed, over the whole log (%)' },
    gscImpressions:      { int: true, min: 0, max: BIG, about: 'Search Console impressions' },
    gscClicks:           { int: true, min: 0, max: BIG, about: 'Search Console clicks' },
    gscCtrPct:           { int: false, min: 0, max: 100, about: 'Search Console click-through rate (%)' },
    gscPosition:         { int: false, min: 1, max: 1000, lowerIsBetter: true, about: 'Search Console position, impression-weighted (lower is better)' },
});

const ID_RE = /^[0-9a-f]{32}$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9a-z.]{1,20})?$/;
const KEYS = new Set(['schema', 'id', 'week', 'siteread', 'metrics']);

const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

/** The ISO 8601 week ('2026-W42') a day (YYYY-MM-DD or ms) falls in. */
export function isoWeek(day) {
    const t = typeof day === 'number' ? Math.floor(day / DAY) * DAY : dayMs(day);
    const thursday = t + (3 - ((new Date(t).getUTCDay() + 6) % 7)) * DAY;
    const year = new Date(thursday).getUTCFullYear();
    const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY));
    return `${year}-W${String(week).padStart(2, '0')}`;
}

/** ms of the Monday that starts an ISO week, or NaN when it is not a real week (2026-W54). */
export function weekStart(week) {
    const m = WEEK_RE.exec(String(week));
    if (!m) return NaN;
    const jan4 = Date.UTC(Number(m[1]), 0, 4);
    const t = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (Number(m[2]) - 1) * 7 * DAY;
    return isoWeek(t) === week ? t : NaN;
}

/** An ISO week moved by n weeks. */
export function addWeeks(week, n) {
    return isoWeek(weekStart(week) + n * 7 * DAY);
}

// The digest's newest 7-day bucket is labelled with the ISO week holding most of its days.
const weekOfWindow = to => isoWeek(dayMs(to) - 3 * DAY);

const pct1 = n => Math.round(n * 10) / 10;

/**
 * A digest (its JSON) → { payload, notes }. `notes` says, in plain words, each metric left out
 * and why. Throws when there is no full week to share.
 */
export function sharePayload(digest, { id, version = VERSION } = {}) {
    if (!ID_RE.test(String(id))) throw new Error('share needs a 32-hex-digit id');
    const metrics = {};
    const notes = [];
    let week = null;

    const log = digest?.log;
    if (log?.range?.to) {
        const to = log.range.to;
        const from = isoDay(dayMs(to) - 6 * DAY);
        if (log.range.from > from) {
            notes.push(`log: the log covers ${log.range.from} → ${to}, less than a full week; log numbers left out`);
        } else {
            week = weekOfWindow(to);
            // people.weeks lists only weeks someone came in: none ending on the last day is a 0.
            metrics.people = log.people?.weeks?.find(w => w.to === to)?.people ?? 0;
            const arrived = { search: 0, ai: 0, social: 0 };
            for (const s of log.sources ?? []) {
                if (!(s.kind in arrived)) continue;
                for (const [d, n] of Object.entries(s.landingDays ?? {})) if (d >= from && d <= to) arrived[s.kind] += n;
            }
            metrics.peopleFromSearch = arrived.search;
            metrics.peopleFromAi = arrived.ai;
            metrics.peopleFromSocial = arrived.social;

            const fetches = { aiAnswerFetches: 0, aiSearchFetches: 0, aiTrainingFetches: 0, searchEngineFetches: 0 };
            let complete = true;
            let aiRequests = 0, aiSpoofed = 0;
            for (const c of log.crawlers ?? []) {
                if (c.kind === 'ai') { aiRequests += c.requests ?? 0; aiSpoofed += c.spoofed?.requests ?? 0; }
                const w = c.verified?.perWeek?.at(-1);
                if (!w || w.to !== to) continue;
                // A digest before 0.3 has only `fetches`, which counts sitemap URLs alone when it
                // had a sitemap: that would not mean the same as everyone else's row.
                const n = w.pageFetches ?? (c.verified.sitemapFetches == null ? w.fetches : null);
                if (n == null) { complete = false; continue; }
                const key = c.kind === 'crawler'
                    ? (c.purpose === 'search' ? 'searchEngineFetches' : null)
                    : { answer: 'aiAnswerFetches', search: 'aiSearchFetches', training: 'aiTrainingFetches' }[c.purpose];
                if (key) fetches[key] += n;
            }
            if (complete) Object.assign(metrics, fetches);
            else notes.push('log: this digest predates per-week page fetches (siteread < 0.3 with a sitemap); crawler numbers left out, run the digest again');
            if (aiRequests) metrics.aiSpoofedPct = pct1((100 * aiSpoofed) / aiRequests);
            else notes.push('log: no requests under AI user-agents; aiSpoofedPct left out');
        }
    } else {
        notes.push(log ? 'log: no parseable lines in the log; log numbers left out' : 'log: no access log in this digest; log numbers left out');
    }

    const gscWeek = digest?.gsc?.weeks?.at(-1);
    if (gscWeek) {
        const label = weekOfWindow(gscWeek.to);
        if (gscWeek.days !== 7) {
            notes.push(`gsc: the export's last week ${gscWeek.from} → ${gscWeek.to} has ${gscWeek.days} days; Search Console numbers left out`);
        } else if (week && label !== week) {
            notes.push(`gsc: the export's last full week is ${label}, the log's is ${week}; Search Console numbers left out (export again, or pass --from/--to to the digest)`);
        } else {
            week ??= label;
            metrics.gscImpressions = gscWeek.impressions;
            metrics.gscClicks = gscWeek.clicks;
            if (gscWeek.ctr != null) metrics.gscCtrPct = gscWeek.ctr;
            if (gscWeek.position != null) metrics.gscPosition = gscWeek.position;
        }
    } else if (!digest?.gsc) {
        notes.push('gsc: no Search Console export in this digest; Search Console numbers left out');
    }

    if (!week || !Object.keys(metrics).length) throw new Error(`nothing to share: the digest has no full week of numbers${notes.length ? ` (${notes.join('; ')})` : ''}`);
    const payload = { schema: SHARE_SCHEMA, id, week, siteread: version, metrics };
    const check = validateShare(payload);
    if (!check.ok) throw new Error(`the digest gave a number the endpoint would refuse: ${check.error}`);
    return { payload: check.share, notes };
}

/**
 * What the endpoint accepts, nothing more: { ok: true, share } with the metrics in schema order,
 * or { ok: false, error }. It does not know the date: the endpoint checks the week's age itself.
 */
export function validateShare(body) {
    const bad = error => ({ ok: false, error });
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('the body must be a JSON object');
    for (const k of Object.keys(body)) if (!KEYS.has(k)) return bad(`unknown field "${k}"`);
    if (body.schema !== SHARE_SCHEMA) return bad(`schema must be ${SHARE_SCHEMA}`);
    if (typeof body.id !== 'string' || !ID_RE.test(body.id)) return bad('id must be 32 lowercase hex digits');
    if (typeof body.week !== 'string' || !Number.isFinite(weekStart(body.week))) return bad('week must be an ISO week like 2026-W42');
    if (typeof body.siteread !== 'string' || !VERSION_RE.test(body.siteread)) return bad('siteread must be a version like 0.3.0');
    const m = body.metrics;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return bad('metrics must be an object');
    const metrics = {};
    for (const k of Object.keys(m)) if (!Object.hasOwn(SHARE_METRICS, k)) return bad(`unknown metric "${k}"`);
    for (const [k, spec] of Object.entries(SHARE_METRICS)) {
        if (!Object.hasOwn(m, k)) continue;
        const v = m[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) return bad(`${k} must be a number`);
        if (spec.int && !Number.isInteger(v)) return bad(`${k} must be a whole number`);
        if (v < spec.min || v > spec.max) return bad(`${k} must be between ${spec.min} and ${spec.max}`);
        metrics[k] = v;
    }
    if (!Object.keys(metrics).length) return bad('metrics is empty');
    return { ok: true, share: { schema: body.schema, id: body.id, week: body.week, siteread: body.siteread, metrics } };
}
