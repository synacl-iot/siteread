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
import { share, post, fixtureLists, NOW, silent, proofFor } from './helpers.js';

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
        execFile(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, SITEREAD_PROOF_BITS: '8' } },
            (err, out, errOut) => resolve({ code: err ? err.code : 0, out, err: errOut }));
    });
}

test('share round trip: CLI → HTTP → stored → percentile back; the site never reaches the service', async (t) => {
    const store = memoryStore();
    const app = createApp({ store, now: () => NOW, log: silent, fetch: null, publicUrl: 'http://127.0.0.1', proofBaseBits: 8 });
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
    // A new site's first share carries the proof of work the CLI made once and kept beside the id.
    assert.match(sent.proof, /^\d+$/);
    assert.match(readFileSync(join(dir, '.siteread', 'share-proof'), 'utf8'), new RegExp(`^${sent.proof} \\d+ ${sent.id}\n$`));
    const key = `shares/2026-W42/${sent.id}.json`;
    assert.deepEqual(JSON.parse(await store.get(key)), { ...sent, receivedOn: '2026-10-21' });
    assert.match(first.out, /sent 2026-W42\. The benchmark has not been built yet/);
    assert.match(first.out, /No number has 10 anonymous sites yet/);

    // Five more sites share and the aggregate job builds the snapshot. The same digest shared again
    // replaces its row and is told only what the public page shows: six sites, under the 10 a
    // spread needs, so a count per number and no standing.
    for (const [n, people, pos] of [[1, 1, 30], [2, 2, 25], [3, 9, 12], [4, 40, 8], [5, 4, 40]]) {
        assert.equal((await post(app, { ...share(n, n % 2 ? '2026-W42' : '2026-W41', { people, gscPosition: pos }), proof: proofFor(n, 8) })).status, 200);
    }
    await app.runAggregate();
    const again = await cli(['share', '--yes', '--endpoint', endpoint], dir);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /Against the benchmark built 2026-10-21 12:00 UTC: 6 anonymous sites, 2026-W39 to 2026-W42/);
    assert.match(again.out, /\npeople\s+4\s+6 sites; shown from 10\n/);
    assert.match(again.out, /\ngscPosition\s+17\.9\s+6 sites; shown from 10\n/);
    // a metric only this site sends
    assert.match(again.out, /\ngscClicks\s+3\s+1 site; shown from 10\n/);
    assert.equal((await store.list('shares/')).filter(k => k.endsWith(`${sent.id}.json`)).length, 1);

    // The aggregate job: n printed; six sites are under the 10 a published quartile needs, so the
    // public document has counts and no spread at all. Ids nowhere.
    const doc = await app.runAggregate();
    assert.equal(doc.sites, 6);
    assert.equal(doc.metrics.people.sites, 6);
    assert.equal(doc.metrics.gscClicks.sites, 1);
    assert.ok(!/"p\d+"/.test(JSON.stringify(doc)));
    assert.ok(!JSON.stringify(doc).includes(sent.id));

    // Everything the service holds, every key and value: no host, no path, no visitor IP, no UA.
    const held = (await Promise.all((await store.list('')).map(async k => `${k}\n${await store.get(k)}`))).join('\n');
    const logIps = [...readFileSync(join(SITE, 'access.log'), 'utf8').matchAll(/^(\S+) /gm)].map(m => m[1]);
    for (const s of ['example.org', 'example', 'http', '/guides', '/tools', 'Mozilla', 'widget', 'signup', ...new Set(logIps)]) {
        assert.ok(!held.includes(s), `the service holds "${s}"`);
    }
});
