import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore } from '../src/index.js';

const posix = typeof process.getuid === 'function';

function tempDir(t) {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('round-trips a document; a missing or corrupt file reads as null', async (t) => {
    const dir = tempDir(t);
    const file = join(dir, 'sub', 'lists.json');
    const store = fileStore(file);
    assert.equal(await store.get(), null);
    const doc = { lists: { claudebot: { prefixes: ['216.73.216.0/22'], fetchedAt: '2026-10-21T00:00:00.000Z' } } };
    await store.set(doc);
    assert.deepEqual(await store.get(), doc);
    assert.deepEqual(readdirSync(join(dir, 'sub')), ['lists.json'], 'no temp file left behind');
    if (posix) assert.equal(statSync(file).mode & 0o777, 0o600);

    writeFileSync(file, '{ not json');
    chmodSync(file, 0o600);
    assert.equal(await store.get(), null);
});

test('refuses a directory others can write to (a shared /tmp)', { skip: !posix && 'no POSIX owners' }, async (t) => {
    const dir = tempDir(t);
    const file = join(dir, 'lists.json');
    const store = fileStore(file);
    await store.set({ lists: {} });
    chmodSync(dir, 0o777);
    assert.equal(await store.get(), null, 'a planted file is not read');
    await assert.rejects(store.set({ lists: {} }), /not ours, or writable by others/);
});
