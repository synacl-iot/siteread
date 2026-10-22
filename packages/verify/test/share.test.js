import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    digest, parseGoal, createVerifier, memoryStore, SOURCES, parseList,
    sharePayload, validateShare, isoWeek, weekStart, addWeeks, SHARE_METRICS, SHARE_REFUSALS, VERSION,
} from '../src/index.js';

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
const ID = '0123456789abcdef0123456789abcdef';

async function fixtureDigest(opts = {}) {
    const lists = {};
    for (const { agent, url } of SOURCES) {
        const body = JSON.parse(readFileSync(new URL(`./fixtures/${FIXTURE_FOR[url]}.json`, import.meta.url), 'utf8'));
        lists[agent] = { prefixes: parseList(body), fetchedAt: new Date().toISOString() };
    }
    const verifier = createVerifier({ store: memoryStore({ lists }), fetch: null, log: {} });
    await verifier.load();
    return digest({
        gsc: join(SITE, 'gsc.zip'), logs: LOGS, verifier,
        site: 'example.org', sitemapFile: join(SITE, 'sitemap.xml'),
        goals: [parseGoal('signup=^POST /signup 2')], teamPath: /^\/admin\//, ...opts,
    });
}

function tmp(t) {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-share-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// The CLI as a child that does not block this process, so a test server here can answer it.
function runAsync(args, { cwd, env = {}, offline = false } = {}) {
    return new Promise((resolve) => {
        const argv = offline ? ['--import', OFFLINE, BIN, ...args] : [BIN, ...args];
        execFile(process.execPath, argv, { cwd, env: { ...process.env, SITEREAD_PROOF_BITS: '8', ...env }, encoding: 'utf8' }, (err, out, errOut) => {
            resolve({ code: err ? err.code : 0, out, err: errOut });
        });
    });
}

test('isoWeek, weekStart, addWeeks: ISO 8601 weeks, year edges included', () => {
    assert.equal(isoWeek('2026-10-12'), '2026-W42');
    assert.equal(isoWeek('2026-10-18'), '2026-W42');
    assert.equal(isoWeek('2026-10-19'), '2026-W43');
    assert.equal(isoWeek('2027-01-01'), '2026-W53');   // 2026 starts on a Thursday: 53 weeks
    assert.equal(isoWeek('2024-12-30'), '2025-W01');
    assert.equal(isoWeek(Date.UTC(2026, 9, 18, 23, 59)), '2026-W42');
    assert.equal(new Date(weekStart('2026-W42')).toISOString().slice(0, 10), '2026-10-12');
    assert.ok(Number.isFinite(weekStart('2026-W53')));
    assert.ok(Number.isNaN(weekStart('2025-W53')));
    assert.ok(Number.isNaN(weekStart('2026-W54')));
    assert.ok(Number.isNaN(weekStart('2026-W00')));
    assert.ok(Number.isNaN(weekStart('2026-42')));
    assert.equal(addWeeks('2026-W53', 1), '2027-W01');
    assert.equal(addWeeks('2026-W02', -2), '2025-W52');
});

test('sharePayload: the fixture site\'s last week, every number traced to the digest', async () => {
    const d = await fixtureDigest();
    const { payload, notes } = sharePayload(d, { id: ID });
    assert.deepEqual(notes, []);
    assert.deepEqual(payload, {
        schema: 1, id: ID, week: '2026-W42', siteread: VERSION,
        metrics: {
            people: 4,                  // log.people.weeks.at(-1), 2026-10-12 → 10-18
            peopleFromSearch: 1,        // google landing on 10-16 (the 10-06 one is the week before)
            peopleFromAi: 0,            // chatgpt landed 10-08
            peopleFromSocial: 2,        // reddit 10-13, hackernews 10-17
            aiAnswerFetches: 0,
            aiSearchFetches: 0,
            aiTrainingFetches: 2,       // ClaudeBot, verified
            searchEngineFetches: 8,     // Googlebot: 7 sitemap URLs + /old-page/, so a sitemap changes nothing
            aiSpoofedPct: 25,           // 1 spoofed ChatGPT-User of 4 AI-UA requests, whole log
            gscImpressions: 238, gscClicks: 3, gscCtrPct: 1.3, gscPosition: 17.9,
        },
    });
    // The same digest without a sitemap gives the same crawler numbers.
    const bare = sharePayload(await fixtureDigest({ sitemapFile: null }), { id: ID }).payload;
    assert.equal(bare.metrics.searchEngineFetches, 8);
});

test('sharePayload: nothing from the log or the export leaves, only allowlisted numbers', async () => {
    const d = await fixtureDigest();
    const text = JSON.stringify(sharePayload(d, { id: ID }).payload);
    const logText = LOGS.map(f => f.endsWith('.gz') ? '' : readFileSync(f, 'utf8')).join('\n');
    const ips = new Set([...logText.matchAll(/^(\S+) /gm)].map(m => m[1]));
    assert.ok(ips.size > 5);
    for (const ip of ips) assert.ok(!text.includes(ip), `payload carries ${ip}`);
    for (const s of ['example', '.org', '/', 'http', 'widget', 'signup', 'Mozilla', 'google', 'chatgpt']) {
        assert.ok(!text.toLowerCase().includes(s.toLowerCase()), `payload carries "${s}"`);
    }
    const { payload } = sharePayload(d, { id: ID });
    assert.deepEqual(Object.keys(payload), ['schema', 'id', 'week', 'siteread', 'metrics']);
    for (const [k, v] of Object.entries(payload.metrics)) {
        assert.ok(Object.hasOwn(SHARE_METRICS, k), k);
        assert.equal(typeof v, 'number', k);
    }
});

test('sharePayload: partial weeks and mismatched weeks are left out and said so', async () => {
    const d = await fixtureDigest();
    // A log of 4 days: no log numbers; GSC alone decides the week.
    const short = structuredClone(d);
    short.log.range.from = '2026-10-15';
    short.log.people.weeks = [{ from: '2026-10-15', to: '2026-10-18', people: 2, goals: {} }];
    const a = sharePayload(short, { id: ID });
    assert.equal(a.payload.week, '2026-W42');
    assert.deepEqual(Object.keys(a.payload.metrics), ['gscImpressions', 'gscClicks', 'gscCtrPct', 'gscPosition']);
    assert.match(a.notes[0], /less than a full week/);

    // Nobody came in the last week: people.weeks has no bucket ending on the last day. That is a
    // week of 0 people, not a short log, and the crawler numbers still go.
    const quiet = structuredClone(d);
    quiet.log.people.weeks = quiet.log.people.weeks.slice(0, -1);
    const q = sharePayload(quiet, { id: ID });
    assert.equal(q.payload.metrics.people, 0);
    assert.equal(q.payload.metrics.searchEngineFetches, 8);
    assert.deepEqual(q.notes, []);

    // The export's last full week is a week before the log's: GSC left out.
    const later = structuredClone(d);
    later.gsc.weeks.at(-1).to = '2026-10-11';
    const b = sharePayload(later, { id: ID });
    assert.ok(!('gscClicks' in b.payload.metrics));
    assert.match(b.notes.join('\n'), /last full week is 2026-W41, the log's is 2026-W42/);

    // A 0.2 digest with a sitemap has sitemap-only weekly fetches: crawler numbers left out.
    const old = structuredClone(d);
    for (const c of old.log.crawlers) for (const w of c.verified.perWeek) delete w.pageFetches;
    const c = sharePayload(old, { id: ID });
    assert.ok(!('searchEngineFetches' in c.payload.metrics));
    assert.equal(c.payload.metrics.people, 4);
    assert.match(c.notes.join('\n'), /predates per-week page fetches/);

    assert.throws(() => sharePayload({ gsc: null, log: null }, { id: ID }), /nothing to share/);
    assert.throws(() => sharePayload({ gsc: null, log: { range: { from: null, to: null } } }, { id: ID }), /no parseable lines/);
    assert.throws(() => sharePayload(d, { id: 'not-an-id' }), /32-hex-digit id/);
});

test('validateShare: refuses anything not in the schema rather than trimming it', () => {
    const ok = { schema: 1, id: ID, week: '2026-W42', siteread: '0.3.0', metrics: { people: 4, gscCtrPct: 1.3 } };
    assert.deepEqual(validateShare(ok), { ok: true, share: ok });
    const bad = (patch, re, code) => {
        const r = validateShare({ ...ok, ...patch });
        assert.equal(r.ok, false, JSON.stringify(patch));
        assert.match(r.error, re);
        assert.equal(r.code, code, JSON.stringify(patch));
        assert.ok(SHARE_REFUSALS.includes(r.code));
    };
    bad({ host: 'example.org' }, /unknown field "host"/, 'unknown-field');
    bad({ schema: 2 }, /schema/, 'schema');
    bad({ id: ID.toUpperCase() }, /id must be/, 'id');
    bad({ week: '2026-W54' }, /week must be/, 'week');
    bad({ week: '2026-10-18' }, /week must be/, 'week');
    bad({ siteread: 'example.org' }, /siteread must be/, 'version');
    bad({ metrics: { people: 4, topPage: 1 } }, /unknown metric "topPage"/, 'unknown-metric');
    bad({ metrics: { people: '4' } }, /people must be a number/, 'metric-value');
    bad({ metrics: { people: 4.5 } }, /whole number/, 'metric-value');
    bad({ metrics: { people: -1 } }, /between/, 'metric-value');
    bad({ metrics: { gscCtrPct: 101 } }, /between/, 'metric-value');
    bad({ metrics: { gscPosition: 0 } }, /between/, 'metric-value');
    bad({ metrics: { people: Infinity } }, /number/, 'metric-value');
    bad({ metrics: {} }, /empty/, 'metric-value');
    bad({ metrics: [] }, /metrics must be an object/, 'metric-value');
    bad({ proof: 123 }, /proof must be/, 'proof');
    bad({ proof: '12a' }, /proof must be/, 'proof');
    bad({ proof: '1'.repeat(21) }, /proof must be/, 'proof');
    assert.deepEqual(validateShare({ ...ok, proof: '4096' }), { ok: true, share: { ...ok, proof: '4096' } });
    assert.equal(validateShare(null).code, 'body');
    assert.equal(validateShare([ok]).ok, false);
    // Metrics come back in schema order whatever order they arrived in.
    assert.deepEqual(Object.keys(validateShare({ ...ok, metrics: { gscCtrPct: 1, people: 2 } }).share.metrics), ['people', 'gscCtrPct']);
});

test('cli share --dry-run: prints the payload, makes the id file once, sends nothing', async (t) => {
    const dir = tmp(t);
    mkdirSync(join(dir, '.siteread', 'digests'), { recursive: true });
    writeFileSync(join(dir, '.siteread', 'digests', '2026-10-11.json'), '{}');
    writeFileSync(join(dir, '.siteread', 'digests', '2026-10-18.json'), JSON.stringify(await fixtureDigest()));
    const a = await runAsync(['share', '--dry-run'], { cwd: dir, offline: true });
    assert.equal(a.code, 0, a.err);
    const payload = JSON.parse(a.out);
    assert.equal(payload.week, '2026-W42');   // the newest digest in the folder
    assert.match(a.err, /byte for byte/);
    assert.match(a.err, /not sent \(--dry-run\)/);
    const idFile = join(dir, '.siteread', 'share-id');
    assert.equal(readFileSync(idFile, 'utf8').trim(), payload.id);
    if (process.platform !== 'win32') assert.equal(statSync(idFile).mode & 0o777, 0o600);
    // Same digest, same id: the same bytes, so a dry run shows exactly what a real run sends.
    const b = await runAsync(['share', '--dry-run'], { cwd: dir, offline: true });
    assert.equal(b.out, a.out);
});

test('cli share: no yes, no send; plain http only to localhost; a broken id file is an error', async (t) => {
    const dir = tmp(t);
    const file = join(dir, 'd.json');
    writeFileSync(file, JSON.stringify(await fixtureDigest()));
    // A refused endpoint is caught before anything is built: no payload, no id file.
    const remote = await runAsync(['share', file, '--yes', '--endpoint', 'http://example.com/v1/share'], { cwd: dir, offline: true });
    assert.equal(remote.code, 1);
    assert.match(remote.err, /must be an https:\/\/ URL/);
    assert.equal(remote.out, '');
    assert.ok(!existsSync(join(dir, '.siteread', 'share-id')));
    const noTty = await runAsync(['share', file, '--endpoint', 'http://127.0.0.1:9/v1/share'], { cwd: dir, offline: true });
    assert.equal(noTty.code, 1);
    assert.equal(JSON.parse(noTty.out).week, '2026-W42');
    assert.match(noTty.err, /not sent: no terminal to ask on; pass --yes/);
    writeFileSync(join(dir, 'bad-id'), 'example.org\n');
    const badId = await runAsync(['share', file, '--dry-run', '--id-file', join(dir, 'bad-id')], { cwd: dir, offline: true });
    assert.equal(badId.code, 1);
    assert.match(badId.err, /does not hold a share id/);
    const none = spawnSync(process.execPath, [BIN, 'share'], { cwd: dir, encoding: 'utf8' });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /no such file: \.siteread\/digests/);
});

test('cli share --yes: sends the printed bytes, prints where it stands, reports a refusal', async (t) => {
    const dir = tmp(t);
    const file = join(dir, 'd.json');
    writeFileSync(file, JSON.stringify(await fixtureDigest()));
    const got = [];
    let answer = { status: 200, body: null };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            got.push({ method: req.method, url: req.url, type: req.headers['content-type'], ua: req.headers['user-agent'], body });
            res.writeHead(answer.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(answer.body));
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/share`;

    answer.body = {
        ok: true, week: '2026-W42',
        against: { generatedAt: '2026-10-21T09:00:12.000Z', window: { from: '2026-W39', to: '2026-W42' }, sites: 14, minSites: 10 },
        metrics: {
            people: { value: 4, sites: 14, band: 'below-p25' },
            gscPosition: { value: 17.9, sites: 14, band: 'p50-p75' },
            gscClicks: { value: 3, sites: 9 },
        },
        benchmark: 'https://siteread.dev/benchmark\u001b[31m',
    };
    const r = await runAsync(['share', file, '--yes', '--endpoint', endpoint], { cwd: dir });
    assert.equal(r.code, 0, r.err);
    assert.equal(got.length, 1);
    assert.equal(got[0].method, 'POST');
    assert.equal(got[0].type, 'application/json');
    assert.match(got[0].ua, new RegExp(`^siteread/${VERSION.replace(/\./g, '\\.')} `));
    // What went over the wire is, byte for byte, what was printed first.
    assert.ok(r.out.startsWith(`${got[0].body}\n`));
    assert.match(r.out, /sent 2026-W42\. Against the benchmark built 2026-10-21 09:00 UTC: 14 anonymous sites, 2026-W39 to 2026-W42/);
    assert.match(r.out, /\npeople\s+4\s+below the 25th percentile\n/);
    assert.match(r.out, /\ngscPosition\s+17\.9\s+50th to 75th percentile {2}\(lower is better\)\n/);
    assert.match(r.out, /\ngscClicks\s+3\s+9 sites; shown from 10\n/);
    assert.match(r.out, /benchmark: https:\/\/siteread\.dev\/benchmark\[31m\n$/);   // no raw escape

    answer = { status: 400, body: { ok: false, error: 'week 2026-W42 is more than 8 weeks ago' } };
    const refused = await runAsync(['share', file, '--yes', '--endpoint', endpoint], { cwd: dir });
    assert.equal(refused.code, 1);
    assert.match(refused.err, /did not take it: HTTP 400: week 2026-W42 is more than 8 weeks ago/);

    const down = await runAsync(['share', file, '--yes', '--endpoint', 'http://127.0.0.1:9/v1/share'], { cwd: dir });
    assert.equal(down.code, 1);
    assert.match(down.err, /could not reach http:\/\/127\.0\.0\.1:9\/v1\/share/);

    // The proof of work went with the payload, made once and kept beside the id.
    const sentProof = JSON.parse(got[0].body).proof;
    const [nonce, bits, forId] = readFileSync(join(dir, '.siteread', 'share-proof'), 'utf8').trim().split(' ');
    assert.equal(nonce, sentProof);
    assert.equal(forId, readFileSync(join(dir, '.siteread', 'share-id'), 'utf8').trim());
    assert.ok(Number(bits) >= 8);

    // A busy day: the service asks for more; the CLI makes it, keeps it, and sends nothing itself.
    answer = { status: 400, body: { ok: false, error: 'a new site needs a proof of work of 11 bits today', need: 11 } };
    const busy = await runAsync(['share', file, '--yes', '--endpoint', endpoint], { cwd: dir });
    assert.equal(busy.code, 1);
    assert.match(busy.err, /proof of work \(11 bits/);
    assert.match(busy.err, /run share again to send it with the new proof/);
    const stronger = readFileSync(join(dir, '.siteread', 'share-proof'), 'utf8').trim().split(' ');
    assert.ok(Number(stronger[1]) >= 11);
    const before = got.length;
    answer = { status: 200, body: { ok: true, week: '2026-W42', against: null, metrics: {} } };
    assert.equal((await runAsync(['share', file, '--yes', '--endpoint', endpoint], { cwd: dir })).code, 0);
    assert.equal(JSON.parse(got[before].body).proof, stronger[0], 'the next share carries the stronger proof');
});
