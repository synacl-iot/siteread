// The smallest zip reader that opens a Search Console export: walks the central directory and
// inflates stored (0) or deflated (8) entries with node:zlib. No zip64, no encryption, which
// no GSC export uses.

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Map of entry name → Buffer for every file in a zip. Throws on anything it can't read. */
export function readZip(buf) {
    // The end-of-central-directory record sits in the last 22 + up to 65535 (comment) bytes.
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out = new Map();
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('broken zip central directory');
        const method = buf.readUInt16LE(p + 10);
        const size = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
        p += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/')) continue;
        if (buf.readUInt32LE(local) !== LOC_SIG) throw new Error(`broken zip entry ${name}`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const data = buf.subarray(start, start + size);
        if (method === 0) out.set(name, Buffer.from(data));
        else if (method === 8) out.set(name, inflateRawSync(data));
        else throw new Error(`zip entry ${name} uses compression method ${method}`);
    }
    return out;
}
