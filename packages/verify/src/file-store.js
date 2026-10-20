// A store that keeps the lists in one JSON file, for the CLI and for anyone who wants the
// lists to survive a restart without a database.
//
// The default CLI path is under os.tmpdir(), which on Linux is a directory every user shares. A
// planted lists file would make a spoofed IP "verified", so: the directory must be ours and not
// group/world-writable, the file must be ours, and writes go through an O_EXCL temp file
// (never through a symlink someone left at that name) and an atomic rename.

import { mkdir, readFile, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

const uid = typeof process.getuid === 'function' ? process.getuid() : null;

function trusted(st) {
    if (uid === null) return true;   // Windows: no POSIX owner to check
    return st.uid === uid && (st.mode & 0o022) === 0;
}

/** { get, set } over one JSON file. A missing, foreign or unparseable file reads as null. */
export function fileStore(file) {
    const dir = dirname(file);
    return {
        async get() {
            let text;
            try {
                const [d, f] = await Promise.all([lstat(dir), lstat(file)]);
                if (!d.isDirectory() || !trusted(d) || !f.isFile() || !trusted(f)) return null;
                text = await readFile(file, 'utf8');
            } catch (err) {
                if (err.code === 'ENOENT') return null;
                throw err;
            }
            try { return JSON.parse(text); } catch { return null; }
        },
        async set(doc) {
            await mkdir(dir, { recursive: true, mode: 0o700 });
            const d = await lstat(dir);
            if (!d.isDirectory() || !trusted(d)) throw new Error(`refusing to write into ${dir}: not ours, or writable by others`);
            const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tmp, JSON.stringify(doc), { mode: 0o600, flag: 'wx' });
            try {
                await rename(tmp, file);
            } catch (err) {
                await unlink(tmp).catch(() => {});
                throw err;
            }
        },
    };
}
