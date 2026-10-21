import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { VERSION } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package.json: ESM, Node >= 20, zero dependencies, version in step with src/version.js', () => {
    assert.equal(pkg.name, 'siteread');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.engines.node, '>=20');
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.version, VERSION);
    assert.deepEqual(pkg.files, ['src', 'bin', 'README.md']);
});

test('the bin is an executable node script', () => {
    const bin = new URL(`../${pkg.bin.siteread}`, import.meta.url);
    assert.match(readFileSync(bin, 'utf8'), /^#!\/usr\/bin\/env node\n/);
    if (process.platform !== 'win32') assert.ok(statSync(bin).mode & 0o111, 'executable bit');
});
