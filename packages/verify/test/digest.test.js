import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    digest, parseCsv, parseLine, classifySource, parseSitemap, parseGoal,
    createVerifier, memoryStore, SOURCES, parseList,
} from '../src/index.js';

// The fixture site (test/fixtures/site/make-fixture.mjs documents the cast behind every number).
const SITE = fileURLToPath(new URL('./fixtures/site/', import.meta.url));
const LOGS = [join(SITE, 'access.log.1.gz'), join(SITE, 'access.log')];
const BIN = fileURLToPath(new URL('../bin/siteread.js', import.meta.url));
const OFFLINE = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("offline in tests")}';
const FIXTURE_FOR = {
    'https://openai.com/chatgpt-user.json': 'chatgpt-user',
    'https://openai.com/searchbot.json': 'searchbot',
    'https://openai.com/gptbot.json': 'gptbot',
    'https://www.perplexity.com/perplexity-user.json': 'perplexity-user',
    'https://www.perplexity.com/perplexitybot.json': 'perplexitybot',
    'https://search.developer.apple.com/applebot.json': 'applebot',
    'https://claude.com/crawling/bots.json': 'claude-bots',
    'https://developers.google.com/static/search/apis/ipranges/googlebot.json': 'googlebot',
    'https://www.bing.com/toolbox/bingbot.json': 'bingbot',
};

function listsDoc() {
    const lists = {};
    for (const { agent, url } of SOURCES) {
        const body = JSON.parse(readFileSync(new URL(`./fixtures/${FIXTURE_FOR[url]}.json`, import.meta.url), 'utf8'));
        lists[agent] = { prefixes: parseList(body), fetchedAt: new Date().toISOString() };
    }
    return { lists };
}

async function fixtureVerifier() {
    const v = createVerifier({ store: memoryStore(listsDoc()), fetch: null, log: {} });
    await v.load();
    return v;
}

const LOG_OPTS = {
    site: 'example.org',
    sitemapFile: join(SITE, 'sitemap.xml'),
    goals: [parseGoal('signup=^POST /signup 2'), parseGoal('tool=^POST /api/')],
    teamPath: /^\/admin\//,
};

test('parseCsv: quotes, doubled quotes, commas, CRLF, BOM, blank lines', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n');
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"'], ['last', '']]);
});

test('parseLine: combined format, offsets to UTC, escaped quotes, junk', () => {
    const q = parseLine('1.2.3.4 - - [05/Oct/2026:20:00:00 +0200] "GET /a/?x=1 HTTP/2.0" 200 9 "https://r.example/" "Mozilla/5.0 \\x22q\\x22"');
    assert.equal(q.ip, '1.2.3.4');
    assert.equal(new Date(q.ts).toISOString(), '2026-10-05T18:00:00.000Z');
    assert.equal(q.target, '/a/?x=1');
    assert.equal(q.status, 200);
    assert.equal(q.referer, 'https://r.example/');
    assert.equal(q.ua, 'Mozilla/5.0 "q"');
    // Common format (no referer/UA) still parses; a TLS probe does not.
    assert.equal(parseLine('1.2.3.4 - - [05/Oct/2026:20:00:00 +0000] "GET / HTTP/1.1" 200 9').ua, '-');
    assert.equal(parseLine('\\x16\\x03\\x01 garbage'), null);
});

test('classifySource: utm_source beats the Referer, AI before search, internal and direct', () => {
    assert.deepEqual(classifySource('-', '/x/?utm_source=chatgpt.com'), { source: 'chatgpt', kind: 'ai' });
    assert.deepEqual(classifySource('https://gemini.google.com/', '/'), { source: 'gemini', kind: 'ai' });
    assert.deepEqual(classifySource('https://www.google.co.uk/', '/'), { source: 'google', kind: 'search' });
    assert.deepEqual(classifySource('https://www.example.org/a/', '/', { site: 'example.org' }), { source: 'internal', kind: 'internal' });
    assert.deepEqual(classifySource('-', '/'), { source: 'direct', kind: 'direct' });
    assert.deepEqual(classifySource('https://blog.someone.dev/post', '/'), { source: 'blog.someone.dev', kind: 'referral' });
    assert.deepEqual(classifySource('-', '/?utm_source=Newsletter'), { source: 'newsletter', kind: 'campaign' });
});

test('parseSitemap and parseGoal', () => {
    assert.deepEqual([...parseSitemap(readFileSync(join(SITE, 'sitemap.xml'), 'utf8'))],
        ['/', '/guides/widget-alternatives/', '/tools/crc/', '/guides/never-crawled/']);
    assert.equal(parseGoal('signup=^POST /signup 2').label, 'signup');
    assert.throws(() => parseGoal('no-equals'), /label=regex/);
});

test('gsc: totals from the daily series, lag cut, weighted position, weeks', async () => {
    const { gsc, warnings } = await digest({ gsc: join(SITE, 'gsc') });
    assert.deepEqual(gsc.range, { from: '2026-09-21', to: '2026-10-18', days: 28, trimmedTrailingDays: ['2026-10-19', '2026-10-20'] });
    assert.deepEqual(gsc.totals, { impressions: 658, clicks: 12, ctr: 1.8, position: 21.9 });
    assert.deepEqual(gsc.weeks.map(w => [w.from, w.impressions, w.clicks]),
        [['2026-09-21', 91, 3], ['2026-09-28', 140, 2], ['2026-10-05', 189, 4], ['2026-10-12', 238, 3]]);
    assert.deepEqual(gsc.filters, { 'Search type': 'Web', Date: 'Last 28 days' });
    assert.match(warnings[0], /cut 2 trailing day/);
});

test('gsc: pages merged by path (www + apex), queries named share', async () => {
    const { gsc } = await digest({ gsc: join(SITE, 'gsc') });
    const home = gsc.pages.rows.find(r => r.key === '/');
    // 150 @ 6 (apex) + 50 @ 10 (www) → 200 @ 7
    assert.deepEqual(home, { key: '/', impressions: 200, clicks: 4, ctr: 2, position: 7 });
    assert.equal(gsc.pages.count, 3);
    assert.deepEqual(gsc.namedQueries, { impressions: 220, shareOfTotal: 33, clicks: 6 });
    assert.equal(gsc.queries.rows[0].key, 'widget alternatives');
    assert.equal(gsc.queries.rows[2].key, 'how to build a widget, fast');
    assert.equal(gsc.devices.rows.length, 2);
});

test('gsc: the zip reads the same as the folder', async () => {
    const a = await digest({ gsc: join(SITE, 'gsc') });
    const b = await digest({ gsc: join(SITE, 'gsc.zip') });
    assert.deepEqual(b.gsc, a.gsc);
});

test('gsc: --split compares per day around a change; --prev adds last read', async () => {
    const first = await digest({ gsc: join(SITE, 'gsc'), split: '2026-10-05' });
    const w = first.gsc.windows;
    assert.deepEqual([w.before.days, w.before.impressions, w.before.impressionsPerDay], [14, 231, 16.5]);
    assert.deepEqual([w.after.days, w.after.impressions, w.after.impressionsPerDay], [14, 427, 30.5]);
    const again = await digest({ gsc: join(SITE, 'gsc'), prev: first });
    assert.deepEqual(again.gsc.queries.rows[0].prev, { impressions: 120, clicks: 3, position: 14.2 });
    assert.equal(again.gsc.prevTotals.impressions, 658);
});

test('gsc: an export with no Dates.csv says what to do', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-gsc-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    copyFileSync(join(SITE, 'gsc', 'Queries.csv'), join(dir, 'Queries.csv'));
    await assert.rejects(digest({ gsc: dir }), /no Dates\.csv \(or Chart\.csv\)/);
});

test('log: people are browsers that loaded an asset; the rest are set aside by reason', async () => {
    const { log } = await digest({ logs: LOGS, verifier: await fixtureVerifier(), ...LOG_OPTS });
    assert.deepEqual(log.range, { from: '2026-10-05', to: '2026-10-18', tz: 'America/Los_Angeles' });
    assert.deepEqual(log.lines, { total: 54, unparsed: 1, outOfRange: 0 });
    assert.equal(log.people.total, 6);
    assert.deepEqual(log.people.setAside, { bots: 0, scanners: 1, noAssets: 1, team: 1, excluded: 0, cloudFakes: 1, cloudFakeReferers: { google: 1 } });
    assert.equal(log.people.perDay.length, 14, 'every day, zeros included');
    assert.equal(log.people.avgPerDay, 0.5);
    assert.deepEqual(log.people.weeks, [
        { from: '2026-10-05', to: '2026-10-11', people: 2, goals: { signup: 1, tool: 1 } },
        { from: '2026-10-12', to: '2026-10-18', people: 4, goals: { signup: 0, tool: 0 } },
    ]);
});

test('log: first touch by source, with landings and goals', async () => {
    const { log } = await digest({ logs: LOGS, verifier: await fixtureVerifier(), ...LOG_OPTS });
    assert.deepEqual(log.sources.map(s => [s.source, s.people]),
        [['google', 2], ['chatgpt', 1], ['direct', 1], ['hackernews', 1], ['reddit', 1]]);
    const google = log.sources[0];
    assert.deepEqual(google.landings, [{ path: '/guides/widget-alternatives/', people: 2 }]);
    assert.deepEqual(google.goals, { signup: 1 });
    assert.deepEqual(log.sources[1].goals, { tool: 1 });
    assert.deepEqual(log.goals, { signup: 1, tool: 1 });
    assert.deepEqual(log.pages[0], { path: '/', people: 3 });
});

test('log: crawlers verified against vendor lists, counted on sitemap URLs', async () => {
    const { log } = await digest({ logs: LOGS, verifier: await fixtureVerifier(), ...LOG_OPTS });
    const by = Object.fromEntries(log.crawlers.map(c => [c.agent, c]));
    const g = by.googlebot;
    assert.deepEqual([g.verified.ips, g.verified.pageFetches, g.verified.sitemapFetches, g.verified.sitemapCovered], [1, 12, 11, 3]);
    assert.deepEqual(g.verified.perWeek.map(w => w.fetches), [4, 7]);
    assert.deepEqual(g.verified.offSitemapPages, ['/old-page/']);
    // The scanner wearing Googlebot's UA: not in the list, never counted as a crawl.
    assert.deepEqual(g.spoofed, { ips: 1, requests: 4 });
    assert.deepEqual([by.claudebot.verified.pageFetches, by.claudebot.spoofed.ips], [2, 0]);
    assert.deepEqual(by['chatgpt-user'].spoofed, { ips: 1, requests: 1 });
    // Claude Code runs on the reader's machine: no list can cover it.
    assert.deepEqual(by['claude-code'].unknown, { ips: 1, requests: 1, pageFetches: 1 });
    assert.equal(by.petalbot.unknown.ips, 1);
    assert.deepEqual(log.otherBots.topUserAgents[0], { ua: 'UptimeRobot/2.0', requests: 3 });
    assert.equal(log.scanners.ips, 3);
    // The spoofed Googlebot fetched / too, but only verified search crawls count as coverage.
    assert.deepEqual(log.sitemap, { urls: 4, fetchedBySearch: 3, neverFetched: ['/guides/never-crawled/'], neverFetchedCount: 1 });
});

test('log: --from/--to keep a range; no verifier leaves every crawler unknown', async () => {
    const { log } = await digest({ logs: LOGS, ...LOG_OPTS, from: '2026-10-12', to: '2026-10-18' });
    assert.equal(log.range.from, '2026-10-12');
    assert.equal(log.people.total, 4);
    assert.ok(log.lines.outOfRange > 0);
    assert.ok(log.crawlers.every(c => c.verified.ips === 0));
});

test('log: the site host is guessed from Referers and the guess is reported', async () => {
    const out = await digest({ logs: LOGS });
    assert.deepEqual(out.log.site, { host: 'example.org', guessed: true });
    assert.ok(out.warnings.some(w => /guessed as example\.org/.test(w)));
});

// ---- CLI ----

function seededCache(t) {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-digest-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'lists.json');
    writeFileSync(file, JSON.stringify(listsDoc()), { mode: 0o600 });
    return file;
}

function run(args, cache) {
    const r = spawnSync(process.execPath, ['--import', OFFLINE, BIN, ...args], {
        env: { ...process.env, SITEREAD_CACHE: cache ?? join(tmpdir(), 'siteread-digest-unused', 'lists.json') },
        encoding: 'utf8',
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
}

test('cli digest: both inputs, JSON on stdout, warnings on stderr', (t) => {
    const cache = seededCache(t);
    const r = run(['digest', '--offline', '--gsc', join(SITE, 'gsc.zip'), '--log', LOGS[0], `--log=${LOGS[1]}`,
        '--site', 'example.org', '--sitemap', join(SITE, 'sitemap.xml'), '--goal', 'signup=^POST /signup 2',
        '--team-path', '^/admin/'], cache);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.gsc.totals.impressions, 658);
    assert.equal(out.log.people.total, 6);
    assert.equal(out.log.crawlers.find(c => c.agent === 'googlebot').verified.pageFetches, 12);
    assert.ok(out.vendorLists.find(l => l.agent === 'googlebot').prefixes > 0);
    // The log sits inside the export: nothing to warn about, and a cross-check over its days.
    assert.doesNotMatch(r.err, /past the export/);
    assert.deepEqual(out.crossCheck, { from: '2026-10-05', to: '2026-10-18', gscClicks: 7, googlePeople: 2 });
});

test('cli digest --out: named for the last day, compares with the newest earlier digest', (t) => {
    const cache = seededCache(t);
    const dir = mkdtempSync(join(tmpdir(), 'siteread-out-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, '2026-10-11.json'), JSON.stringify({ gsc: { totals: { impressions: 400 }, range: { to: '2026-10-11' },
        queries: { rows: [{ key: 'widget alternatives', impressions: 90, clicks: 1, position: 18 }] } } }));
    const r = run(['digest', '--offline', '--gsc', join(SITE, 'gsc'), '--log', LOGS[1], '--out', dir], cache);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.trim(), join(dir, '2026-10-18.json'));
    assert.match(r.err, /compared with 2026-10-11\.json/);
    const out = JSON.parse(readFileSync(join(dir, '2026-10-18.json'), 'utf8'));
    assert.deepEqual(out.gsc.queries.rows[0].prev, { impressions: 90, clicks: 1, position: 18 });
    assert.equal(out.gsc.prevTotals.impressions, 400);
    assert.ok(out.log, 'the log half survives the re-run');
});

test('digest warns when the log runs past the export, naming the days to pass', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-late-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const late = join(dir, 'late.log');
    writeFileSync(late, '81.2.69.50 - - [25/Oct/2026:18:00:00 +0000] "GET / HTTP/1.1" 200 9 "-" "Mozilla/5.0"\n');
    const out = await digest({ gsc: join(SITE, 'gsc'), logs: [...LOGS, late], ...LOG_OPTS });
    assert.ok(out.warnings.some(w => w.includes('past the export') && w.includes('--from 2026-10-05 --to 2026-10-18')), out.warnings.join('\n'));
    assert.equal(out.gsc.weeks.at(-1).impressionsPerDay, 34);
});

test('cli digest: usage errors exit 1 with a reason', (t) => {
    assert.match(run(['digest']).err, /needs --gsc <export>, --log <file>, or both/);
    assert.equal(run(['digest', '--gsc']).code, 1);
    assert.match(run(['digest', '--gsc', join(SITE, 'gsc'), '--split', 'monday']).err, /--split wants YYYY-MM-DD/);
    assert.match(run(['digest', '--log', LOGS[1], '--goal', 'oops']).err, /label=regex/);
    assert.match(run(['digest', '--gsc', '/nope/export.zip']).err, /no such file/);
    const dir = mkdtempSync(join(tmpdir(), 'siteread-gsc-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, 'Queries.csv'), 'Top queries,Clicks,Impressions\n');
    const bad = run(['digest', '--gsc', dir]);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /^siteread: digest: no Dates\.csv/);
    assert.doesNotMatch(bad.err, /at .*\.js:\d+/, 'no stack trace');
});
