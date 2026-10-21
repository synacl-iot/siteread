// Where the service keeps its few documents: a string key → string value store with get, put,
// delete and list(prefix). That is the whole interface, so it maps onto any host's KV, a bucket or
// a folder. Keys the service uses:
//
//   feed/state.json         the verifier's lists, carried between feed runs (fail-keeps-old-copy)
//   feed/lists.json         the published feed
//   shares/<week>/<id>.json one row per site per ISO week
//   sites/<id>              when a site first shared (for the new-sites-per-day cap)
//   new/<day>/<id>          a marker per new site per day, pruned by the aggregate job
//   feed/last-run.json      how the last feed run went (for the operator page)
//   stats/<day>.json        shares taken and refused that day, by refusal code; kept 30 days
//   benchmark.json          the published aggregate

import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';

// Keys are built by the service from validated parts only; this refuses anything else anyway.
const KEY_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

function checkKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key) || key.split('/').includes('..')) throw new Error(`bad store key: ${key}`);
    return key;
}

/** In memory: tests, and a process that needs nothing to survive it. */
export function memoryStore() {
    const m = new Map();
    return {
        async get(key) { return m.get(checkKey(key)) ?? null; },
        async put(key, value) { m.set(checkKey(key), String(value)); },
        async delete(key) { m.delete(checkKey(key)); },
        async list(prefix = '') { return [...m.keys()].filter(k => k.startsWith(prefix)).sort(); },
    };
}

/** One file per key under `root`: a Node host with a disk. Writes are temp file + rename. */
export function dirStore(root) {
    const file = key => path.join(root, ...checkKey(key).split('/'));
    return {
        async get(key) {
            try { return await readFile(file(key), 'utf8'); } catch (err) {
                if (err.code === 'ENOENT') return null;
                throw err;
            }
        },
        async put(key, value) {
            const f = file(key);
            await mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
            const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tmp, String(value), { mode: 0o600, flag: 'wx' });
            try { await rename(tmp, f); } catch (err) {
                await unlink(tmp).catch(() => {});
                throw err;
            }
        },
        async delete(key) {
            await unlink(file(key)).catch(err => { if (err.code !== 'ENOENT') throw err; });
        },
        async list(prefix = '') {
            let names;
            try { names = await readdir(root, { recursive: true, withFileTypes: true }); } catch (err) {
                if (err.code === 'ENOENT') return [];
                throw err;
            }
            return names
                .filter(d => d.isFile() && !d.name.endsWith('.tmp'))
                .map(d => path.relative(root, path.join(d.parentPath ?? d.path, d.name)).split(path.sep).join('/'))
                .filter(k => k.startsWith(prefix) && KEY_RE.test(k))
                .sort();
        },
    };
}

/** The verifier's { get, set } store over one key, as JSON. */
export function jsonDoc(store, key) {
    return {
        async get() {
            const text = await store.get(key);
            if (text == null) return null;
            try { return JSON.parse(text); } catch { return null; }
        },
        async set(doc) { await store.put(key, JSON.stringify(doc)); },
    };
}
