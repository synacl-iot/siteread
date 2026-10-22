import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, MAX_SHARE_BYTES } from '../src/app.js';
import { memoryStore } from '../src/store.js';
import { share, id, post, NOW, silent } from './helpers.js';

const DAY = 86_400_000;

function setup(opts = {}) {
    const store = memoryStore();
    let t = NOW;
    const app = createApp({ store, now: () => t, log: silent, fetch: null, ...opts });
    return { app, store, at: ms => { t = ms; } };
}

test('share: stored as sent plus the day, answered against the published snapshot; no CORS', async () => {
    const { app, store } = setup();
    const a = share(1, '2026-W42', { people: 4, gscClicks: 3 });
    const res = await post(app, a);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    // No benchmark built yet: nothing to stand against.
    assert.deepEqual(await res.json(), {
        ok: true, week: '2026-W42', against: null,
        metrics: { people: { value: 4, sites: 0 }, gscClicks: { value: 3, sites: 0 } },
        benchmark: 'https://siteread.dev/benchmark',
    });
    // The day it came, not the time: a row cannot be lined up against a request log.
    assert.deepEqual(JSON.parse(await store.get(`shares/2026-W42/${id(1)}.json`)), { ...a, receivedOn: '2026-10-21' });

    await post(app, share(2, '2026-W42', { people: 10 }));
    await post(app, share(3, '2026-W41', { people: 1 }));
    await app.runAggregate();
    const r = await (await post(app, share(1, '2026-W42', { people: 4 }))).json();
    assert.deepEqual(r.against, { generatedAt: new Date(NOW).toISOString(), window: { from: '2026-W39', to: '2026-W42' }, sites: 3, minSites: 10 });
    // Three sites are under the 10 a published quartile needs: the count, and no band.
    assert.deepEqual(r.metrics.people, { value: 4, sites: 3 });
});

test('share: one sender moving its value learns nothing the public page does not show', async () => {
    // The attack this answer closes: re-share one id and week with value after value, and read
    // each answer for a change that gives another site's number away.
    const { app } = setup();
    const secret = [137, 912, 4410];
    for (const [i, people] of secret.entries()) await post(app, share(i + 1, '2026-W42', { people }));
    await app.runAggregate();
    const seen = new Set();
    for (let v = 0; v <= 5000; v += 50) {
        const r = await (await post(app, share(99, '2026-W42', { people: v }))).json();
        seen.add(JSON.stringify({ ...r.metrics.people, value: null, against: r.against }));
    }
    assert.equal(seen.size, 1, 'every answer the same, whatever the value');

    // With 12 anonymous sites the quartiles are public, and the answer is the band among them:
    // it changes only where a published quartile is.
    for (let n = 10; n < 19; n++) await post(app, share(n, '2026-W42', { people: n * 100 }));
    const doc = await app.runAggregate();
    const { p25, p50, p75 } = doc.metrics.people;
    const band = async v => (await (await post(app, share(99, '2026-W42', { people: v }))).json()).metrics.people.band;
    assert.equal(await band(p25 - 1), 'below-p25');
    assert.equal(await band(p25), 'p25-p50');
    assert.equal(await band(p50), 'p50-p75');
    assert.equal(await band(p75 - 1), 'p50-p75');
    assert.equal(await band(p75), 'p75-up');
    assert.equal(await band(1e9), 'p75-up');
});

test('share: the same site and week twice is one row, the newer', async () => {
    const { app, store } = setup();
    await post(app, share(1, '2026-W42', { people: 4 }));
    await post(app, share(1, '2026-W42', { people: 6 }));
    assert.deepEqual(await store.list('shares/'), [`shares/2026-W42/${id(1)}.json`]);
    assert.equal((await app.runAggregate()).sites, 1);
    assert.equal(JSON.parse(await store.get(`shares/2026-W42/${id(1)}.json`)).metrics.people, 6);
});

test('share: refusals say why, and nothing is stored', async () => {
    const { app, store } = setup();
    const ok = share(1, '2026-W42', { people: 4 });
    const cases = [
        [await post(app, ok, { type: 'text/plain' }), 415, /application\/json/],
        [await post(app, '{"schema":', {}), 400, /not JSON/],
        [await post(app, { ...ok, host: 'example.org' }), 400, /unknown field "host"/],
        [await post(app, { ...ok, metrics: { people: 4, path: '/pricing' } }), 400, /unknown metric "path"/],
        [await post(app, { ...ok, week: '2026-W44' }), 400, /has not started yet \(it is 2026-W43\)/],
        [await post(app, { ...ok, week: '2026-W34' }), 400, /more than 8 weeks ago/],
        [await post(app, JSON.stringify({ ...ok, pad: 'x'.repeat(MAX_SHARE_BYTES) })), 413, /at most 8192 bytes/],
    ];
    for (const [res, status, re] of cases) {
        assert.equal(res.status, status);
        const body = await res.json();
        assert.equal(body.ok, false);
        assert.match(body.error, re);
    }
    assert.equal((await post(app, { ...ok, week: '2026-W35' })).status, 200);   // 8 weeks back is fine
    await store.delete(`shares/2026-W35/${id(1)}.json`);
    assert.deepEqual(await store.list('shares/'), []);
});

test('share: a body that streams past the cap without a Content-Length is cut off', async () => {
    const { app } = setup();
    let sent = 0;
    const body = new ReadableStream({
        pull(c) {
            if (sent > 64 * 1024) return c.close();
            sent += 1024;
            c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
        },
    });
    const res = await app.fetch(new Request('http://localhost/v1/share', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half',
    }));
    assert.equal(res.status, 413);
    assert.ok(sent < 16 * 1024, `read ${sent} bytes`);
});

test('share: new sites per day are capped; a site already known still gets in', async () => {
    const { app, at } = setup({ maxNewSitesPerDay: 2 });
    assert.equal((await post(app, share(1, '2026-W42', { people: 1 }))).status, 200);
    assert.equal((await post(app, share(2, '2026-W42', { people: 2 }))).status, 200);
    const third = await post(app, share(3, '2026-W42', { people: 3 }));
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('retry-after'), '3600');
    assert.equal((await post(app, share(1, '2026-W43', { people: 1 }))).status, 200);
    at(NOW + DAY);
    assert.equal((await post(app, share(3, '2026-W42', { people: 3 }))).status, 200);
});

test('routes: 404, 405 with Allow, health, benchmark after the aggregate job', async () => {
    const { app, store, at } = setup({ minSites: 2 });
    const get = p => app.fetch(new Request(`http://localhost${p}`));
    assert.equal((await get('/')).status, 404);
    assert.equal((await get('/v1/shares')).status, 404);
    const g = await get('/v1/share');
    assert.equal(g.status, 405);
    assert.equal(g.headers.get('allow'), 'POST');
    assert.equal((await post(app, {}, { path: '/v1/lists.json' })).status, 405);
    assert.equal((await get('/v1/benchmark.json')).status, 503);
    assert.deepEqual((await (await get('/healthz')).json()).benchmark, null);

    await post(app, share(1, '2026-W42', { people: 4 }));
    await post(app, share(2, '2026-W42', { people: 8 }));
    at(NOW + 2 * DAY);
    const doc = await app.runAggregate();
    const res = await get('/v1/benchmark.json');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await res.json(), doc);
    assert.equal(doc.metrics.people.p50, 6);
    // The new-site markers from two days ago are pruned; the site registry stays.
    assert.deepEqual(await store.list('new/'), []);
    assert.equal((await store.list('sites/')).length, 2);
    const h = await (await get('/healthz')).json();
    assert.equal(h.benchmark.sites, 2);
    assert.equal(h.feed, null);
});

test('a store failure is a bare 500, not a stack trace', async () => {
    const broken = { ...memoryStore(), async get() { throw new Error('disk on fire at /srv/data'); } };
    const app = createApp({ store: broken, now: () => NOW, log: silent });
    const res = await post(app, share(1, '2026-W42', { people: 4 }));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: 'internal error' });
});
