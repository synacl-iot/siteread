// Builds the fixture site the digest tests read: a made-up site, example.org, with a Search
// Console export (gsc/ and gsc.zip) and two weeks of access log (access.log, access.log.1.gz).
// Every number the tests assert follows from the cast below. Run: node make-fixture.mjs
// (needs the `zip` command for gsc.zip).

import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://example.org';

// ---- Search Console export: 2026-09-21 → 2026-10-20, the last two days empty (GSC lag) ----
const days = [];
for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10);
    const lag = i >= 28;
    // Impressions grow from 10/day to ~37/day; one click every third day, then every other.
    const impressions = lag ? 0 : 10 + i;
    const clicks = lag ? 0 : (i < 14 ? (i % 3 === 0 ? 1 : 0) : (i % 2 === 0 ? 1 : 0));
    const position = lag ? 0 : Math.round((30 - i * 0.5) * 10) / 10;
    days.push([d, clicks, impressions, impressions ? `${((100 * clicks) / impressions).toFixed(2)}%` : '0%', position]);
}
const csv = (rows) => rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
const gsc = {
    'Dates.csv': [['Date', 'Clicks', 'Impressions', 'CTR', 'Position'], ...days],
    'Queries.csv': [['Top queries', 'Clicks', 'Impressions', 'CTR', 'Position'],
        ['widget alternatives', 3, 120, '2.5%', 14.2],
        ['example widget', 2, 40, '5%', 1.3],
        ['how to build a widget, fast', 1, 35, '2.86%', 8.1],
        ['widget crc calculator', 0, 25, '0%', 22]],
    'Pages.csv': [['Top pages', 'Clicks', 'Impressions', 'CTR', 'Position'],
        [`${SITE}/guides/widget-alternatives/`, 4, 200, '2%', 12],
        [`${SITE}/`, 3, 150, '2%', 6],
        ['https://www.example.org/', 1, 50, '2%', 10],
        [`${SITE}/tools/crc/`, 2, 80, '2.5%', 20]],
    'Countries.csv': [['Country', 'Clicks', 'Impressions', 'CTR', 'Position'],
        ['United States', 2, 300, '0.67%', 22], ['India', 6, 100, '6%', 9], ['Germany', 1, 40, '2.5%', 11]],
    'Devices.csv': [['Device', 'Clicks', 'Impressions', 'CTR', 'Position'],
        ['Desktop', 8, 400, '2%', 15], ['Mobile', 2, 90, '2.22%', 9]],
    'Filters.csv': [['Filter', 'Value'], ['Search type', 'Web'], ['Date', 'Last 28 days']],
};
const gdir = path.join(here, 'gsc');
rmSync(gdir, { recursive: true, force: true });
mkdirSync(gdir);
for (const [f, rows] of Object.entries(gsc)) writeFileSync(path.join(gdir, f), `﻿${csv(rows)}`);
rmSync(path.join(here, 'gsc.zip'), { force: true });
execFileSync('zip', ['-q', '-X', '-j', path.join(here, 'gsc.zip'), ...Object.keys(gsc).map(f => path.join(gdir, f))]);

// ---- Access log: 2026-10-05 → 2026-10-18, every request at 18:00Z (11:00 Pacific) ----
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CLAUDEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
const CHATGPT_USER = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const lines = [];
function req(day, ip, target, { status = 200, ref = '-', ua = CHROME, method = 'GET', min = 0 } = {}) {
    const t = new Date(Date.UTC(2026, 9, day, 18, min, 0));
    const stamp = `${String(t.getUTCDate()).padStart(2, '0')}/${MON[t.getUTCMonth()]}/${t.getUTCFullYear()}:18:${String(min).padStart(2, '0')}:00 +0000`;
    lines.push({ t: t.getTime() + lines.length, s: `${ip} - - [${stamp}] "${method} ${target} HTTP/1.1" ${status} 512 "${ref}" "${ua}"` });
}
function visit(day, ip, page, ref, min = 0) {
    req(day, ip, page, { ref, min });
    req(day, ip, '/assets/site.css', { ref: `${SITE}${page}`, min });
}

// People (6): Google, ChatGPT (utm, no Referer), Reddit, direct, a second Google reader, Hacker News.
visit(6, '81.2.69.10', '/guides/widget-alternatives/', 'https://www.google.com/');
visit(6, '81.2.69.10', '/tools/crc/', `${SITE}/guides/widget-alternatives/`, 5);
req(6, '81.2.69.10', '/signup', { method: 'POST', status: 201, ref: `${SITE}/tools/crc/`, min: 9 });
visit(8, '81.2.69.11', '/tools/crc/?utm_source=chatgpt.com', '-');
req(8, '81.2.69.11', '/api/crc', { method: 'POST', status: 200, ref: `${SITE}/tools/crc/`, min: 2 });
visit(13, '81.2.69.12', '/', 'https://www.reddit.com/r/webdev/comments/abc/');
visit(14, '81.2.69.13', '/', '-');
visit(16, '81.2.69.14', '/guides/widget-alternatives/', 'https://www.google.de/');
visit(18, '81.2.69.14', '/tools/crc/', '-');       // the same reader, back two days later
visit(17, '81.2.69.15', '/', 'https://news.ycombinator.com/item?id=1');
// Set aside: no assets (a link checker in a browser UA), a cloud IP faking a Google Referer,
// the team (a 2xx on /admin/), a browser that also probed /.env.
req(9, '81.2.69.20', '/', { ref: 'https://dev.to/someone/post' });
visit(15, '3.101.5.5', '/guides/widget-alternatives/', 'https://www.google.com/');
visit(10, '198.51.100.7', '/', '-');
req(10, '198.51.100.7', '/admin/', { min: 1 });
visit(11, '81.2.69.30', '/', '-');
req(11, '81.2.69.30', '/.env', { status: 444, min: 1 });

// Crawlers. Googlebot from its list (192.178.x), on sitemap pages and one off-sitemap page.
for (const d of [5, 7, 12, 14, 18]) {
    req(d, '192.178.4.5', '/', { ua: GOOGLEBOT });
    req(d, '192.178.4.5', '/guides/widget-alternatives/', { ua: GOOGLEBOT, min: 1 });
}
req(18, '192.178.4.5', '/tools/crc/', { ua: GOOGLEBOT, min: 2 });
req(18, '192.178.4.5', '/old-page/', { ua: GOOGLEBOT, min: 3 });
req(18, '192.178.4.5', '/robots.txt', { ua: GOOGLEBOT, min: 4 });
// Scanners wearing Googlebot and ChatGPT-User: not in the lists, and they probe.
for (const d of [9, 10]) {
    req(d, '45.155.205.1', '/', { ua: GOOGLEBOT });
    req(d, '45.155.205.1', '/wp-login.php', { ua: GOOGLEBOT, status: 444, min: 1 });
}
req(10, '203.0.113.9', '/.git/config', { ua: CHATGPT_USER, status: 444 });
// ClaudeBot from Anthropic's list; Claude Code's WebFetch from a reader's own machine.
req(12, '216.73.216.12', '/guides/widget-alternatives/', { ua: CLAUDEBOT });
req(12, '216.73.216.12', '/tools/crc/', { ua: CLAUDEBOT, min: 1 });
req(15, '81.2.69.40', '/guides/widget-alternatives/', { ua: 'Claude-User (claude-code/2.1.292; +https://support.anthropic.com/)' });
// PetalBot (no published list), a monitor, curl, and a line that isn't combined format.
req(7, '114.119.130.1', '/', { ua: 'Mozilla/5.0 (compatible;PetalBot;+https://webmaster.petalsearch.com/site/petalbot)' });
for (const d of [5, 6, 7]) req(d, '192.0.2.50', '/', { ua: 'UptimeRobot/2.0' });
req(8, '192.0.2.51', '/', { ua: 'curl/8.7.1' });
lines.push({ t: Date.UTC(2026, 9, 8, 18, 30), s: '\\x16\\x03\\x01 garbage from a TLS probe on port 80' });

lines.sort((a, b) => a.t - b.t);
const all = lines.map(l => l.s);
// Rotated like logrotate: the older week gzipped, the newer week plain.
const cut = all.findIndex(s => /\[12\/Oct/.test(s));
writeFileSync(path.join(here, 'access.log.1.gz'), gzipSync(`${all.slice(0, cut).join('\n')}\n`));
writeFileSync(path.join(here, 'access.log'), `${all.slice(cut).join('\n')}\n`);

writeFileSync(path.join(here, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc></url>
  <url><loc>${SITE}/guides/widget-alternatives/</loc></url>
  <url><loc>${SITE}/tools/crc/</loc></url>
  <url><loc>${SITE}/guides/never-crawled/</loc></url>
</urlset>
`);
