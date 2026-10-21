import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryStore, dirStore, jsonDoc } from '../src/store.js';

for (const [name, make] of [['memoryStore', () => memoryStore()], ['dirStore', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-cloud-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dirStore(join(dir, 'data'));
}]]) {
    test(`${name}: get, put, delete, list by prefix; bad keys refused`, async (t) => {
        const s = make(t);
        assert.equal(await s.get('benchmark.json'), null);
        assert.deepEqual(await s.list('shares/'), []);
        await s.put('shares/2026-W42/a.json', '1');
        await s.put('shares/2026-W41/b.json', '2');
        await s.put('benchmark.json', '{}');
        await s.put('shares/2026-W42/a.json', '3');
        assert.equal(await s.get('shares/2026-W42/a.json'), '3');
        assert.deepEqual(await s.list('shares/'), ['shares/2026-W41/b.json', 'shares/2026-W42/a.json']);
        assert.deepEqual(await s.list('shares/2026-W42/'), ['shares/2026-W42/a.json']);
        await s.delete('shares/2026-W42/a.json');
        await s.delete('shares/2026-W42/a.json');
        assert.deepEqual(await s.list('shares/'), ['shares/2026-W41/b.json']);
        for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', '', 'a b']) {
            await assert.rejects(s.put(bad, 'x'), /bad store key/);
        }
        const doc = jsonDoc(s, 'feed/state.json');
        assert.equal(await doc.get(), null);
        await doc.set({ lists: {} });
        assert.deepEqual(await doc.get(), { lists: {} });
        await s.put('feed/state.json', 'not json');
        assert.equal(await doc.get(), null);
    });
}

test('dirStore: files are 0600 in 0700 folders, no temp files left behind', async (t) => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'siteread-cloud-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const s = dirStore(join(dir, 'data'));
    await s.put('shares/2026-W42/a.json', '1');
    assert.equal(statSync(join(dir, 'data', 'shares', '2026-W42', 'a.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'data', 'shares')).mode & 0o777, 0o700);
    assert.deepEqual(readdirSync(join(dir, 'data', 'shares', '2026-W42')), ['a.json']);
});
