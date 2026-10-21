import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromEnv } from '../src/config.js';
import { id } from './helpers.js';

test('fromEnv: named rows, the operator token and origin', () => {
    const c = fromEnv({
        SITEREAD_NAMED: JSON.stringify({ [id(1)]: 'synacl.com' }),
        SITEREAD_OPERATOR_TOKEN: 'x'.repeat(32),
        SITEREAD_OPERATOR_ORIGIN: 'https://siteread.dev/operator',
    });
    assert.deepEqual([...c.named], [[id(1), 'synacl.com']]);
    assert.equal(c.operatorToken, 'x'.repeat(32));
    assert.equal(c.operatorOrigin, 'https://siteread.dev');
    assert.deepEqual(fromEnv({}), { named: new Map(), operatorToken: null, operatorOrigin: 'https://siteread.dev' });
});

test('fromEnv: refusals never repeat a secret', () => {
    const secretish = 'ABCDEF0123456789ABCDEF0123456789';
    const err = (env) => { try { fromEnv(env); } catch (e) { return e.message; } return null; };
    const bad = err({ SITEREAD_NAMED: JSON.stringify({ [id(1)]: 'synacl.com', [secretish]: 'other.dev' }) });
    assert.match(bad, /entry 2: the id is not 32 lowercase hex digits/);
    assert.ok(!bad.includes(secretish));
    assert.match(err({ SITEREAD_NAMED: JSON.stringify({ [id(1)]: 'not a host!' }) }), /entry 1: the label/);
    assert.match(err({ SITEREAD_NAMED: '{' }), /not JSON/);
    assert.match(err({ SITEREAD_NAMED: '[]' }), /must be an object/);
    const short = err({ SITEREAD_OPERATOR_TOKEN: 'hunter2' });
    assert.match(short, /at least 32 characters/);
    assert.ok(!short.includes('hunter2'));
    assert.match(err({ SITEREAD_OPERATOR_ORIGIN: 'nope' }), /not a URL/);
});
