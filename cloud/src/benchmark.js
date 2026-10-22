// Shares → the public aggregate (benchmark.json), and a share's standing against it (the answer
// `share` gets back).
//
// Who is compared: each site's latest share among the 4 ISO weeks ending at the week in question.
// One row per site, so a site that shares every week counts once, and a site that skipped last
// week still counts with its week before. 4 weeks because the early benchmark is small: a single
// week would compare almost nobody with anybody.
//
// What is published: per metric, the quartiles of the ANONYMOUS sites, and only once MIN_SITES of
// them report it. Below that the page prints the count and nothing else. Why 10 and why only
// three numbers: five interpolated quantiles over five values give every one of them back
// (p25/p50/p75 ARE the 2nd-4th values, p10 and p90 then solve for the 1st and 5th); three
// numbers over ten values pin none. Named sites (config.js) are left out of that count and out of
// the quartiles: their own numbers are public by their choice, and their rank against the
// anonymous sites is shown from the same threshold, since a rank among a few gives them away.

import { SHARE_METRICS, isoWeek, weekStart, addWeeks } from '../../packages/verify/src/share.js';
import { VERSION } from '../../packages/verify/src/version.js';

export const WINDOW_WEEKS = 4;
export const MIN_SITES = 10;
export const QUANTILES = Object.freeze([25, 50, 75]);

const byWeek = (a, b) => weekStart(a) - weekStart(b);
const round1 = n => Math.round(n * 10) / 10;

/** The window of weeks ending at `week`, oldest first. */
export function windowOf(week) {
    return Array.from({ length: WINDOW_WEEKS }, (_, i) => addWeeks(week, i - WINDOW_WEEKS + 1));
}

/** Each site's latest row among the window ending at `week`. */
export function latestPerSite(rows, week) {
    const weeks = new Set(windowOf(week));
    const by = new Map();
    for (const r of rows) {
        if (!weeks.has(r.week)) continue;
        const cur = by.get(r.id);
        if (!cur || byWeek(cur.week, r.week) < 0) by.set(r.id, r);
    }
    return [...by.values()];
}

/** Mid-rank percentile (0-100) of `value` among `values`, which include it: ties count half. */
export function percentileOf(values, value) {
    if (!values.length) return null;
    let below = 0, equal = 0;
    for (const v of values) {
        if (v < value) below++;
        else if (v === value) equal++;
    }
    return Math.round((100 * (below + equal / 2)) / values.length);
}

/** The q-th percentile (0-100) of ascending `sorted`, linearly interpolated. */
export function quantile(sorted, q) {
    if (!sorted.length) return null;
    const i = (q / 100) * (sorted.length - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// What a share is told: for each of its numbers, the band it falls in among the quartiles
// benchmark.json already publishes, and only where it publishes them; elsewhere, how many sites
// report that number. WHY: the answer used to be an exact percentile among the live rows, with no
// threshold, and a share of the same id and week replaces the row and costs nothing against the
// new-site cap. So one sender could move its own value and binary-search everyone else's: with 3
// sites in the window, one id got 137, 912 and 4410 back exactly in 90 requests, undoing the rule
// that only quartiles of 10 anonymous sites are ever published. A band against published numbers,
// from the hourly snapshot and not the live rows, tells a sender nothing the page does not.
export const BANDS = Object.freeze(['below-p25', 'p25-p50', 'p50-p75', 'p75-up']);

/** Where `value` falls among a metric's published quartiles: a tie goes to the band above. */
export function bandOf(value, m) {
    if (value < m.p25) return 'below-p25';
    if (value < m.p50) return 'p25-p50';
    if (value < m.p75) return 'p50-p75';
    return 'p75-up';
}

/** What `share` gets back for one share, against `snapshot` (benchmark.json, or null before the first build). */
export function standing(share, snapshot) {
    const metrics = {};
    for (const [k, value] of Object.entries(share.metrics)) {
        const m = snapshot?.metrics?.[k];
        const out = { value, sites: m?.sites ?? 0 };
        if (m && m.p25 != null && m.p50 != null && m.p75 != null) out.band = bandOf(value, m);
        metrics[k] = out;
    }
    const against = snapshot
        ? { generatedAt: snapshot.generatedAt, window: snapshot.window, sites: snapshot.sites, minSites: snapshot.minSites }
        : null;
    return { week: share.week, against, metrics };
}

/**
 * The public aggregate over every stored row, as of `now`. `named` maps a share id to its public
 * label (config.js); no id appears anywhere in the result.
 */
export function aggregate(rows, { now = Date.now(), minSites = MIN_SITES, named = new Map() } = {}) {
    const current = weekStart(isoWeek(now));
    const weeks = [...new Set(rows.map(r => r.week))].filter(w => weekStart(w) <= current).sort(byWeek);
    const latest = weeks.at(-1) ?? null;
    const pop = latest ? latestPerSite(rows, latest) : [];
    const anon = pop.filter(r => !named.has(r.id));
    const valuesOf = k => anon.filter(r => Object.hasOwn(r.metrics, k)).map(r => r.metrics[k]).sort((a, b) => a - b);
    const metrics = {};
    for (const [k, spec] of Object.entries(SHARE_METRICS)) {
        const values = valuesOf(k);
        const m = { about: spec.about, lowerIsBetter: Boolean(spec.lowerIsBetter), sites: values.length };
        if (values.length >= minSites) for (const q of QUANTILES) m[`p${q}`] = round1(quantile(values, q));
        metrics[k] = m;
    }
    // A named site with no share in the window stays listed with nothing, so the page shows that
    // it stopped instead of the row quietly disappearing.
    const namedRows = [...named].map(([id, label]) => {
        const r = pop.find(x => x.id === id);
        if (!r) return { label, week: null, metrics: {} };
        const out = {};
        for (const [k, value] of Object.entries(r.metrics)) {
            const values = valuesOf(k);
            out[k] = values.length >= minSites ? { value, percentile: percentileOf([...values, value], value) } : { value };
        }
        return { label, week: r.week, metrics: out };
    });
    const window = latest ? windowOf(latest) : null;
    return {
        siteread: VERSION,
        generatedAt: new Date(now).toISOString(),
        window: window ? { from: window[0], to: window.at(-1) } : null,
        sites: anon.length,
        minSites,
        metrics,
        named: namedRows,
        // Sites that shared each week: the benchmark's n over time, printed so it reads as small.
        history: weeks.map(w => ({ week: w, sites: new Set(rows.filter(r => r.week === w).map(r => r.id)).size })),
    };
}
