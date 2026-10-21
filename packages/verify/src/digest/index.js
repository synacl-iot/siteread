// `siteread digest`: a Search Console export and an access log → one JSON document of the
// numbers a weekly read is written from. Deterministic: the same inputs give the same numbers,
// so this week's read compares with last week's. Nothing is sent anywhere; the only network
// traffic is the verifier's GETs of the vendors' public IP lists (none with `offline`).

import { readFileSync } from 'node:fs';
import { digestGsc, readExport } from './gsc.js';
import { createLogDigest, readLog } from './log.js';
import { VERSION } from '../version.js';

// GSC clicks vs people the log saw arrive from Google, over the days both cover. They are
// different counts (a click without a Referer reads as direct; one person can click twice), so
// this is a sanity check, never a sum. On synacl.com they tracked within 10 % day by day.
function crossCheck(gsc, log) {
    const from = gsc.range.from > log.range.from ? gsc.range.from : log.range.from;
    const to = gsc.range.to < log.range.to ? gsc.range.to : log.range.to;
    if (from > to) return null;
    const gscClicks = gsc.daily.filter(d => d.date >= from && d.date <= to).reduce((s, d) => s + d.clicks, 0);
    const days = log.sources.find(s => s.source === 'google')?.landingDays ?? {};
    const googlePeople = Object.entries(days).filter(([d]) => d >= from && d <= to).reduce((s, [, n]) => s + n, 0);
    return { from, to, gscClicks, googlePeople };
}

/** Paths of every <loc> in a sitemap (or sitemap index) file. */
export function parseSitemap(xml) {
    const out = new Set();
    for (const m of String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const loc = m[1].replace(/&amp;/g, '&');
        try { out.add(new URL(loc).pathname); } catch { out.add(loc); }
    }
    return out;
}

/** "label=regex" → { label, re }. */
export function parseGoal(s) {
    const i = String(s).indexOf('=');
    if (i < 1) throw new Error(`--goal wants label=regex, got "${s}"`);
    return { label: s.slice(0, i), re: new RegExp(s.slice(i + 1), 'i') };
}

/**
 * @param {object} o
 * @param {string} [o.gsc]        export zip or folder
 * @param {string[]} [o.logs]     access log files
 * @param {object} [o.verifier]   from createVerifier(), already refreshed or loaded
 * @param {object} [o.prev]       an earlier digest (its JSON), for per-row deltas
 * Plus the createLogDigest options and `split`, `limit`.
 */
export async function digest({ gsc = null, logs = [], verifier = null, prev = null, split = null, limit = 25, sitemapFile = null, now = new Date(), ...logOpts } = {}) {
    if (!gsc && !logs.length) throw new Error('nothing to read: give a Search Console export, a log, or both');
    const out = { siteread: VERSION, generatedAt: now.toISOString(), gsc: null, log: null, warnings: [] };
    if (gsc) {
        out.gsc = digestGsc(readExport(gsc), { split, limit, prev: prev?.gsc ?? null });
        out.warnings.push(...out.gsc.warnings.map(w => `gsc: ${w}`));
        delete out.gsc.warnings;
    }
    if (logs.length) {
        const sitemap = sitemapFile ? parseSitemap(readFileSync(sitemapFile, 'utf8')) : null;
        if (sitemap && !sitemap.size) out.warnings.push(`log: no <loc> URLs in ${sitemapFile}`);
        const d = createLogDigest({ ...logOpts, sitemap, limit: Math.min(limit, 25) });
        for (const f of logs) await readLog(f, d);
        out.log = d.finish(verifier);
        if (out.log.lines.unparsed > out.log.lines.total / 2) {
            out.warnings.push(`log: ${out.log.lines.unparsed} of ${out.log.lines.total} lines are not in combined format; counts are from the rest`);
        }
        if (out.log.site.guessed) out.warnings.push(`log: site host guessed as ${out.log.site.host ?? 'unknown'} from Referers; pass --site to set it`);
        if (out.gsc && out.log.range.from) {
            const a = out.gsc.range, b = out.log.range;
            if (b.from < a.from || b.to > a.to) {
                out.warnings.push(`the log runs ${b.from} → ${b.to}, past the export's ${a.from} → ${a.to}; pass --from ${a.from > b.from ? a.from : b.from} --to ${a.to < b.to ? a.to : b.to} to compare the same days`);
            }
            out.crossCheck = crossCheck(out.gsc, out.log);
        }
    }
    return out;
}
