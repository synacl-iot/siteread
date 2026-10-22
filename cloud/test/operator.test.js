import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, clientOf, MAX_SHARE_BYTES, MAX_VERSIONS } from '../src/app.js';
import { memoryStore } from '../src/store.js';
import { share, id, post, proofFor, vendorFetch, NOW, silent } from './helpers.js';

const DAY = 86_400_000;
const TOKEN = 'a'.repeat(40);
const SITE = 'https://siteread.dev';

function setup(opts = {}) {
    const store = memoryStore();
    let t = NOW;
    const app = createApp({
        store, now: () => t, log: silent, fetch: vendorFetch(), proofBaseBits: 0,
        operatorToken: TOKEN, operatorOrigin: SITE, named: new Map([[id(99), 'synacl.com']]), ...opts,
    });
    return { app, store, at: ms => { t = ms; } };
}

const status = (app, headers = {}, method = 'GET') => app.fetch(new Request('http://localhost/v1/operator/status', { method, headers }));

test('operator: no token configured means no route at all', async () => {
    const { app } = setup({ operatorToken: null });
    assert.equal((await status(app, { authorization: `Bearer ${TOKEN}` })).status, 404);
});

test('operator: missing or wrong token is 401 with no data; the right one is 200', async () => {
    const { app } = setup();
    for (const auth of [undefined, 'Bearer nope', `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN]) {
        const res = await status(app, auth ? { authorization: auth } : {});
        assert.equal(res.status, 401, String(auth));
        assert.equal(res.headers.get('www-authenticate'), 'Bearer');
        assert.deepEqual(Object.keys(await res.json()), ['ok', 'error']);
    }
    const ok = await status(app, { authorization: `Bearer ${TOKEN}` });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('operator: CORS answers only the site origin, and only on this route', async () => {
    const { app } = setup();
    const pre = await status(app, { origin: SITE, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' }, 'OPTIONS');
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
    assert.equal(pre.headers.get('access-control-allow-headers'), 'authorization');
    assert.equal(pre.headers.get('vary'), 'origin');
    const evil = await status(app, { origin: 'https://evil.example' }, 'OPTIONS');
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const got = await status(app, { origin: SITE, authorization: `Bearer ${TOKEN}` });
    assert.equal(got.headers.get('access-control-allow-origin'), SITE);
    const shareRes = await post(app, share(1, '2026-W42', { people: 1 }));
    assert.equal(shareRes.headers.get('access-control-allow-origin'), null);
});

test('operator: counts by day and reason, never a row, an id or a message', async () => {
    const { app, store, at } = setup({ proofBaseBits: 8 });
    await app.runFeed();
    await post(app, { ...share(1, '2026-W42', { people: 4 }), proof: proofFor(1, 8) });
    await post(app, { ...share(99, '2026-W42', { people: 9 }), proof: proofFor(99, 8) });
    await post(app, { ...share(2, '2026-W42', { people: 1 }), hostname: 'leak.example' });
    await post(app, share(3, '2026-W42', { people: 2 }));                       // a new site with no proof
    await post(app, share(1, '2026-W30', { people: 4 }));                       // too old
    await post(app, JSON.stringify({ pad: 'x'.repeat(MAX_SHARE_BYTES) }));
    await post(app, '{}', { type: 'text/plain' });
    await status(app, { authorization: 'Bearer wrong' });
    await app.runAggregate();

    const body = await (await status(app, { authorization: `Bearer ${TOKEN}` })).json();
    const today = body.requests.at(-1);
    assert.equal(today.day, '2026-10-21');
    assert.deepEqual(today, {
        day: '2026-10-21', taken: 2,
        refused: { 'unknown-field': 1, proof: 1, 'old-week': 1, 'too-large': 1, 'content-type': 1, 'operator-denied': 1 },
        // These test requests never passed a proxy, so they count as local.
        hits: { share: { local: 7 }, operator: { local: 2 } },
        versions: {},
    });
    assert.deepEqual(body.newSitesToday, { sites: 2, proofBits: 8 });
    assert.equal(body.newSites.length, 14);
    assert.equal(body.feed.lists.length, 11);
    assert.deepEqual(body.lastFeedRun.failed, []);
    assert.deepEqual(body.benchmark.named, [{ label: 'synacl.com', week: '2026-W42' }]);
    const text = JSON.stringify(body);
    for (const n of [1, 2, 3, 99]) assert.ok(!text.includes(id(n)), `id ${n} in the status`);
    assert.ok(!text.includes('leak.example') && !text.includes('hostname'));

    // flushStats writes the counts down and forgets them; the status reads the same numbers back.
    await app.flushStats();
    assert.deepEqual(JSON.parse(await store.get('stats/2026-10-21.json')).taken, 2);
    const again = await (await status(app, { authorization: `Bearer ${TOKEN}` })).json();
    assert.equal(again.requests.at(-1).taken, 2);
    assert.equal(again.requests.at(-1).refused['operator-denied'], 1);

    // Days past 30 are dropped on the next flush.
    at(NOW + 31 * DAY);
    await post(app, share(1, '2026-W46', { people: 4 }));
    await app.flushStats();
    assert.deepEqual(await store.list('stats/'), ['stats/2026-11-21.json']);
});

test('usage: clientOf reads the kind of client, never an address', () => {
    const req = (headers) => new Request('http://localhost/v1/lists.json', { headers });
    const viaProxy = { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' };
    assert.deepEqual(clientOf(req({})), { client: 'local', version: null });
    assert.deepEqual(clientOf(req({ ...viaProxy, 'user-agent': 'siteread/0.3.0 (+https://www.npmjs.com/package/siteread)' })), { client: 'siteread', version: '0.3.0' });
    assert.deepEqual(clientOf(req({ ...viaProxy, 'user-agent': 'siteread/1.2.3-beta.1' })), { client: 'siteread', version: '1.2.3-beta.1' });
    assert.deepEqual(clientOf(req({ ...viaProxy, 'user-agent': 'Mozilla/5.0 (Macintosh)' })), { client: 'browser', version: null });
    for (const ua of ['siteread/<script>', 'siteread/1.2', 'curl/8.7.1', '']) {
        assert.deepEqual(clientOf(req({ ...viaProxy, 'user-agent': ua })), { client: 'other', version: null }, ua);
    }
});

test('usage: every route counted per day by kind of client; versions capped; no agent string kept', async () => {
    const { app, store } = setup();
    await app.runFeed();
    const get = (path, ua, proxied = true) => app.fetch(new Request(`http://localhost${path}`, {
        headers: { ...(proxied ? { 'x-forwarded-proto': 'https' } : {}), ...(ua ? { 'user-agent': ua } : {}) },
    }));
    const cli = v => `siteread/${v} (+https://www.npmjs.com/package/siteread)`;
    assert.equal((await get('/v1/lists.json', cli('0.3.0'))).status, 200);
    await get('/v1/lists.json', cli('0.3.0'));
    await get('/v1/lists.json', 'curl/8.7.1');
    await get('/v1/benchmark.json', 'Mozilla/5.0 (X11; Linux x86_64)');
    await get('/v1/benchmark.json', 'node', false);                       // the site rendering a page
    await get('/wp-login.php', 'zgrab/0.x');
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await get('/healthz', cli(`9.9.${i}`));
    await app.flushStats();

    const body = await (await status(app, { authorization: `Bearer ${TOKEN}` })).json();
    const today = body.requests.at(-1);
    assert.deepEqual(today.hits, {
        feed: { siteread: 2, other: 1 }, benchmark: { browser: 1, local: 1 }, other: { other: 1 },
        health: { siteread: MAX_VERSIONS + 5 }, operator: { local: 1 },
    });
    assert.equal(today.versions['0.3.0'], 2);
    assert.equal(Object.keys(today.versions).length, MAX_VERSIONS, 'a flood of versions stops growing the counts');
    const kept = (await store.get('stats/2026-10-21.json')) + JSON.stringify(body);
    for (const s of ['curl', 'Mozilla', 'zgrab', 'node', 'wp-login']) assert.ok(!kept.includes(s), `${s} kept`);
});

test('operator: the last feed run is recorded, a failed vendor included', async () => {
    const fail = new Set(['https://openai.com/gptbot.json']);
    const { app, store } = setup({ fetch: vendorFetch({ fail }) });
    await app.runFeed();
    const run = JSON.parse(await store.get('feed/last-run.json'));
    assert.equal(run.at, new Date(NOW).toISOString());
    assert.deepEqual(run.failed, ['gptbot']);
    assert.match(run.errors.gptbot, /HTTP 500/);
});
