// Sets one named site in /etc/siteread/env's SITEREAD_NAMED, keeping the others, so a share id
// (the only credential a share carries) goes from a file into the service without being typed or
// pasted anywhere:  node named-env.mjs <env file> <share id> <label>
// A label already named under another id is moved to this one. The file keeps its 0600 mode.
// The value is single-quoted: systemd would strip the JSON's double quotes from a bare value.

import { readFileSync, writeFileSync } from 'node:fs';

const [file, id, label] = process.argv.slice(2);
if (!/^[0-9a-f]{32}$/.test(id ?? '')) throw new Error('not a share id (32 lowercase hex digits)');
if (!/^[a-z0-9][a-z0-9.-]{0,62}$/i.test(label ?? '')) throw new Error('the label must look like a hostname');

const lines = readFileSync(file, 'utf8').split('\n');
const at = lines.findIndex(l => /^SITEREAD_NAMED=/.test(l));
let named = {};
if (at >= 0) {
    const raw = lines[at].slice('SITEREAD_NAMED='.length).trim().replace(/^'(.*)'$/, '$1');
    named = JSON.parse(raw || '{}');
}
const before = JSON.stringify(named);
for (const [k, v] of Object.entries(named)) if (v === label && k !== id) delete named[k];
named[id] = label;
const line = `SITEREAD_NAMED='${JSON.stringify(named)}'`;
if (at >= 0) lines[at] = line;
else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, line);
writeFileSync(file, lines.join('\n'));
process.stdout.write(`${label} ${before === JSON.stringify(named) ? 'was already named' : 'is named'}; ${Object.keys(named).length} named site(s)\n`);
