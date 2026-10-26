// A Google Search Console Performance export (the "Export → Download CSV" zip, or the folder it
// unzips to) → the numbers a weekly read needs.
//
// The method is the one that held up over six weekly reads of one site (2026-09 → 10):
//   - Totals come from the daily series (Dates.csv; older exports call it Chart.csv), never by
//     summing Pages.csv: a page table double-counts an impression that showed two URLs.
//   - Position is impression-weighted (Σ position·impressions / Σ impressions). A plain mean
//     lets a page shown once at 90 outweigh one shown 50 times at 5.
//   - GSC lags ~2-3 days and exports the last days as zeros. Trailing all-zero days are cut and
//     the cut is reported, or every "last week" reads as a drop.
//   - Pages are keyed by path: one export listed https://www. and the apex separately.
//   - Queries.csv only names part of the traffic (anonymised queries are left out). The named
//     share is reported so nobody reads the query table as the whole story.
// GSC days are US Pacific days; the log half (log.js) buckets in the same zone by default.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseCsvObjects } from './csv.js';
import { readZip } from './zip.js';

// English export file names → table. A non-English UI exports translated names and headers.
const FILES = {
    dates: ['Dates.csv', 'Chart.csv'],
    queries: ['Queries.csv'],
    pages: ['Pages.csv'],
    countries: ['Countries.csv'],
    devices: ['Devices.csv'],
    appearance: ['Search appearance.csv'],
    filters: ['Filters.csv'],
};

/** { name → text } of the CSVs in an export folder or zip. */
export function readExport(p) {
    const st = statSync(p);
    const files = new Map();
    if (st.isDirectory()) {
        for (const f of readdirSync(p)) if (f.toLowerCase().endsWith('.csv')) files.set(f, readFileSync(path.join(p, f), 'utf8'));
    } else {
        for (const [name, buf] of readZip(readFileSync(p))) {
            if (name.toLowerCase().endsWith('.csv')) files.set(path.basename(name), buf.toString('utf8'));
        }
    }
    return files;
}

function pick(files, names) {
    for (const n of names) for (const [f, text] of files) if (f.toLowerCase() === n.toLowerCase()) return text;
    return null;
}

// "Clicks", or in an export that split search types, the web column ("Web Clicks" or similar).
function col(header, metric) {
    if (header.includes(metric)) return metric;
    const hits = header.filter(h => h.toLowerCase().endsWith(metric.toLowerCase()));
    return hits.find(h => /^web\b/i.test(h)) ?? hits[0] ?? null;
}

function num(v) {
    const n = Number(String(v ?? '').replace(/[%,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
}

function table(text, keyCol) {
    if (text == null) return null;
    const { header, rows } = parseCsvObjects(text);
    const key = header.includes(keyCol) ? keyCol : header[0];
    const c = { clicks: col(header, 'Clicks'), impressions: col(header, 'Impressions'), position: col(header, 'Position') };
    if (!c.clicks || !c.impressions) throw new Error(`no Clicks/Impressions columns in the ${keyCol} table (header: ${header.join(', ')}); is the export in English?`);
    return rows.map(r => ({
        key: r[key],
        clicks: num(r[c.clicks]),
        impressions: num(r[c.impressions]),
        position: c.position ? num(r[c.position]) : null,
    }));
}

export const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Totals of rows { clicks, impressions, position }: CTR in %, position impression-weighted. */
export function totals(rows) {
    let clicks = 0, impressions = 0, wpos = 0, wimp = 0;
    for (const r of rows) {
        clicks += r.clicks;
        impressions += r.impressions;
        if (r.position) { wpos += r.position * r.impressions; wimp += r.impressions; }
    }
    return {
        impressions,
        clicks,
        ctr: impressions ? round((100 * clicks) / impressions, 1) : null,
        position: wimp ? round(wpos / wimp, 1) : null,
    };
}

const DAY = 86_400_000;
const dayMs = d => Date.parse(`${d}T00:00:00Z`);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

/** 7-day buckets ending on `last`, newest last; the oldest may be partial. */
export function weekBuckets(days, last) {
    const end = dayMs(last);
    const byWeek = new Map();
    for (const d of days) {
        const w = Math.floor((end - dayMs(d.date)) / (7 * DAY));
        if (w < 0) continue;
        if (!byWeek.has(w)) byWeek.set(w, []);
        byWeek.get(w).push(d);
    }
    return [...byWeek.keys()].sort((a, b) => b - a).map(w => {
        const rows = byWeek.get(w);
        const t = totals(rows);
        return {
            from: isoDay(end - (7 * w + 6) * DAY),
            to: isoDay(end - 7 * w * DAY),
            days: rows.length,
            ...t,
            impressionsPerDay: round(t.impressions / rows.length, 1),
            clicksPerDay: round(t.clicks / rows.length, 2),
        };
    });
}

// The #fragment stays: GSC reports a jump link (/guide/#step-2) as its own row, and its
// impressions are often the same results that showed the page itself, so summing the two
// counted them twice (one guide read 539 impressions in GSC, 568 in the digest).
function pathOf(url) {
    try { const u = new URL(url); return `${u.pathname}${u.search}${u.hash}`; } catch { return url; }
}

function topRows(rows, limit, { merge } = {}) {
    let list = rows;
    if (merge) {
        // Same path from two hosts (www + apex): sum, weighting position by impressions.
        const by = new Map();
        for (const r of rows) {
            const k = merge(r.key);
            if (!by.has(k)) by.set(k, []);
            by.get(k).push(r);
        }
        list = [...by].map(([key, rs]) => ({ key, ...totals(rs) }));
    } else {
        list = rows.map(r => ({ ...r, ctr: r.impressions ? round((100 * r.clicks) / r.impressions, 1) : null, position: round(r.position, 1) }));
    }
    list.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || String(a.key).localeCompare(String(b.key)));
    return { count: list.length, rows: limit ? list.slice(0, limit) : list };
}

function withPrev(cur, prev) {
    if (!prev) return cur;
    const old = new Map(prev.rows.map(r => [r.key, r]));
    return {
        ...cur,
        rows: cur.rows.map(r => {
            const p = old.get(r.key);
            return { ...r, prev: p ? { impressions: p.impressions, clicks: p.clicks, position: p.position } : null };
        }),
    };
}

/**
 * Digest one export. `split` (YYYY-MM-DD) adds a before/after comparison around a change, per
 * day so unequal windows compare. `prev` is an earlier digest's `gsc` object: rows gain `prev`.
 */
export function digestGsc(files, { split = null, limit = 25, prev = null } = {}) {
    const warnings = [];
    const filters = (() => {
        const t = pick(files, FILES.filters);
        if (t == null) return null;
        return Object.fromEntries(parseCsvObjects(t).rows.map(r => Object.values(r)).filter(v => v.length >= 2).map(([k, v]) => [k, v]));
    })();

    const datesText = pick(files, FILES.dates);
    if (datesText == null) throw new Error('no Dates.csv (or Chart.csv) in the export: export from Search Console → Performance → Export → Download CSV');
    let days = table(datesText, 'Date')
        .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.key))
        .map(d => ({ date: d.key, clicks: d.clicks, impressions: d.impressions, position: d.position }))
        .sort((a, b) => a.date.localeCompare(b.date));
    const trimmed = [];
    while (days.length && days.at(-1).impressions === 0 && days.at(-1).clicks === 0) trimmed.unshift(days.pop().date);
    if (trimmed.length) warnings.push(`cut ${trimmed.length} trailing day(s) with no data (GSC lag): ${trimmed.join(', ')}`);
    if (!days.length) throw new Error('the export has no days with impressions');

    const first = days[0].date;
    const last = days.at(-1).date;
    const all = totals(days);
    const weeks = weekBuckets(days, last);

    let windows = null;
    if (split) {
        const before = days.filter(d => d.date < split);
        const after = days.filter(d => d.date >= split);
        const side = (rows) => {
            const t = totals(rows);
            return { from: rows[0]?.date ?? null, to: rows.at(-1)?.date ?? null, days: rows.length, ...t,
                impressionsPerDay: rows.length ? round(t.impressions / rows.length, 1) : null,
                clicksPerDay: rows.length ? round(t.clicks / rows.length, 2) : null };
        };
        windows = { split, before: side(before), after: side(after) };
        if (!before.length || !after.length) warnings.push(`--split ${split} leaves one side empty (data runs ${first} → ${last})`);
    }

    const q = table(pick(files, FILES.queries), 'Top queries');
    const pg = table(pick(files, FILES.pages), 'Top pages');
    const co = table(pick(files, FILES.countries), 'Country');
    const de = table(pick(files, FILES.devices), 'Device');
    for (const [name, t] of [['Queries', q], ['Pages', pg], ['Countries', co], ['Devices', de]]) {
        if (!t) warnings.push(`no ${name}.csv in the export`);
    }

    let namedQueries = null;
    if (q) {
        const named = q.reduce((s, r) => s + r.impressions, 0);
        namedQueries = {
            impressions: named,
            shareOfTotal: all.impressions ? round((100 * named) / all.impressions, 0) : null,
            clicks: q.reduce((s, r) => s + r.clicks, 0),
        };
    }

    return {
        range: { from: first, to: last, days: days.length, trimmedTrailingDays: trimmed },
        filters,
        totals: all,
        perDay: { impressions: round(all.impressions / days.length, 1), clicks: round(all.clicks / days.length, 2) },
        weeks,
        windows,
        daily: days,
        namedQueries,
        queries: q ? withPrev(topRows(q, limit), prev?.queries) : null,
        pages: pg ? withPrev(topRows(pg, limit, { merge: pathOf }), prev?.pages) : null,
        countries: co ? withPrev(topRows(co, limit), prev?.countries) : null,
        devices: de ? topRows(de, 0) : null,
        prevTotals: prev?.totals ? { range: prev.range, ...prev.totals } : null,
        warnings,
    };
}
