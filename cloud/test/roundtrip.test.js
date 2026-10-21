// End to end: the real CLI (packages/verify/bin/siteread.js) shares a digest of the fixture site
// with the real service over HTTP, and nothing of the site is left anywhere in the service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/store.js';
import { serve } from '../src/node.js';
import { digest, parseGoal } from '../../packages/verify/src/index.js';
import { createVerifier, memoryStore as listStore } from '../../packages/verify/src/verifier.js';
import { share, post, fixtureLists, NOW, silent } from './helpers.js';

const BIN = fileURLToPath(new URL('../../packages/verify/bin/siteread.js', import.meta.url));
const SITE = fileURLToPath(new URL('../../packages/verify/test/fixtures/site/', import.meta.url));

async function fixtureDigest() {
    const verifier = createVerifier({ store: listStore(fixtureLists()), fetch: null, log: {} });
    await verifier.load();
    return digest({
        gsc: join(SITE, 'gsc.zip'), logs: [join(SITE, 'access.log.1.gz'), join(SITE, 'access.log')], verifier,
        site: 'example.org', sitemapFile: join(SITE, 'sitemap.xml'), goals: [parseGoal('signup=^POST /signup 2')],
    });
}

function cli(args, cwd) {
    return new Promise((resolve) => {
        execFile(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' }, (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut }));
    });
}

test('share round trip: CLI → HTTP → stored → percentile back; the site never reaches the service', async (t) => {
    const store = memoryStore();
    const app = createApp({ store, now: () => NOW, log: silent, fetch: null, publicUrl: 'http://127.0.0.1' });
    const server = await serve(app, { port: 0 });
    t.after(() => server.close());
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/share`;

    const dir = mkdtempSync(join(tmpdir(), 'siteread-roundtrip-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, '.siteread', 'digests'), { recursive: true });
    const d = await fixtureDigest();
    writeFileSync(join(dir, '.siteread', 'digests', '2026-10-18.json'), JSON.stringify(d));

    // A dry run sends nothing.
    const dry = await cli(['share', '--dry-run', '--endpoint', endpoint], dir);
    assert.equal(dry.code, 0, dry.err);
    assert.deepEqual(await store.list(''), []);

    // First share: the only site.
    const first = await cli(['share', '--yes', '--endpoint', endpoint], dir);
    assert.equal(first.code, 0, first.err);
    const printed = first.out.slice(0, first.out.indexOf('\n}\n') + 2);
    assert.equal(printed, dry.out.trimEnd());
    const sent = JSON.parse(printed);
    const key = `shares/2026-W42/${sent.id}.json`;
    assert.deepEqual(JSON.parse(await store.get(key)), { ...sent, receivedOn: '2026-10-21' });
    assert.match(first.out, /compared with 1 site: each site's latest share, 2026-W39 to 2026-W42/);
    assert.match(first.out, /Yours is the only site/);

    // Five more sites share; the same digest shared again replaces its row and ranks among six.
    for (const [n, people, pos] of [[1, 1, 30], [2, 2, 25], [3, 9, 12], [4, 40, 8], [5, 4, 40]]) {
        assert.equal((await post(app, share(n, n % 2 ? '2026-W42' : '2026-W41', { people, gscPosition: pos }))).status, 200);
    }
    const again = await cli(['share', '--yes', '--endpoint', endpoint], dir);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /compared with 6 sites/);
    // people: 1, 2, 4, 4(us), 9, 40 → 2 below, 2 tied → (2 + 1) / 6 = 50th
    assert.match(again.out, /\npeople\s+4\s+50th\s+6\n/);
    // gscPosition: 8, 12, 17.9(us), 25, 30, 40 → (2 + 0.5) / 6 = 42nd, and lower is better
    assert.match(again.out, /\ngscPosition\s+17\.9\s+42nd\s+6 {2}\(lower is better\)\n/);
    // a metric only this site sends ranks among one
    assert.match(again.out, /\ngscClicks\s+3\s+50th\s+1\n/);
    assert.equal((await store.list('shares/')).filter(k => k.endsWith(`${sent.id}.json`)).length, 1);

    // The aggregate job: n printed, quantiles only where 5+ sites report, ids nowhere.
    const doc = await app.runAggregate();
    assert.equal(doc.sites, 6);
    assert.equal(doc.metrics.people.sites, 6);
    assert.equal(doc.metrics.people.p50, 4);
    assert.equal(doc.metrics.gscClicks.sites, 1);
    assert.ok(!('p50' in doc.metrics.gscClicks));
    assert.ok(!JSON.stringify(doc).includes(sent.id));

    // Everything the service holds, every key and value: no host, no path, no visitor IP, no UA.
    const held = (await Promise.all((await store.list('')).map(async k => `${k}\n${await store.get(k)}`))).join('\n');
    const logIps = [...readFileSync(join(SITE, 'access.log'), 'utf8').matchAll(/^(\S+) /gm)].map(m => m[1]);
    for (const s of ['example.org', 'example', 'http', '/guides', '/tools', 'Mozilla', 'widget', 'signup', ...new Set(logIps)]) {
        assert.ok(!held.includes(s), `the service holds "${s}"`);
    }
});
