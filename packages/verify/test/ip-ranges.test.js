import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCidr, parseList, normIp, SOURCES, MAX_PREFIXES, AGENTS, CRAWLERS } from '../src/index.js';
import { buildMatcher } from '../src/ip-ranges.js';

// Fixtures are the vendors' real responses (curl, 2026-10-21), trimmed to a few prefixes each.
const fixtures = new URL('./fixtures/', import.meta.url);
const fx = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8'));

test('parseCidr accepts real vendor prefixes and normalises them', () => {
    assert.deepEqual(parseCidr('216.73.216.0/22'), { type: 'ipv4', net: '216.73.216.0', prefix: 22, cidr: '216.73.216.0/22' });
    assert.deepEqual(parseCidr(' 2001:4860:4801:10::/64 '), { type: 'ipv6', net: '2001:4860:4801:10::', prefix: 64, cidr: '2001:4860:4801:10::/64' });
    assert.equal(parseCidr('2001:DB8::/32').cidr, '2001:db8::/32');
    assert.equal(parseCidr('34.162.230.222/32').prefix, 32);
    assert.equal(parseCidr('10.0.0.0/8').prefix, 8);          // the broadest IPv4 allowed
    assert.equal(parseCidr('2001:db8::/16').prefix, 16);     // the broadest IPv6 allowed
});

test('parseCidr rejects anything that would verify too much, or is not a prefix', () => {
    for (const bad of [
        '0.0.0.0/0', '::/0',                 // would verify every address
        '10.0.0.0/7', '1.0.0.0/1',           // broader than MIN_PREFIX ipv4 (8)
        '2001:db8::/15',                     // broader than MIN_PREFIX ipv6 (16)
        '1.2.3.4/33', '::1/129',             // past the address width
        '1.2.3.4', '1.2.3.4/', '/24',        // no prefix, no address
        '1.2.3.4/24/1', '1.2.3.4/-1', '1.2.3.4/2a', '1.2.3.4/1234',
        'garbage', 'example.com/24', '999.1.1.1/24', '<html>/24',
        `${'1'.repeat(70)}/24`,              // oversized string
        '', null, undefined, 42, {}, ['1.2.3.0/24'],
    ]) {
        assert.equal(parseCidr(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
});

test('parseList reads every captured vendor fixture', () => {
    const files = readdirSync(fixtures).filter(f => f.endsWith('.json'));
    assert.ok(files.length >= 9);
    for (const f of files) {
        const body = fx(f.replace(/\.json$/, ''));
        const list = parseList(body);
        assert.equal(list.length, body.prefixes.length, `${f}: every prefix parses`);
    }
    assert.ok(parseList(fx('googlebot')).some(c => c.includes(':')), 'googlebot carries IPv6');
});

test('parseList skips junk, dedupes and stops at MAX_PREFIXES', () => {
    assert.deepEqual(parseList({ prefixes: [
        { ipv4Prefix: '1.2.3.0/24' }, { ipv4Prefix: '1.2.3.0/24' }, { ipv4Prefix: '0.0.0.0/0' },
        { ipv6Prefix: 'nope' }, null, 'string', { other: '5.6.7.0/24' }, { ipv6Prefix: '2001:db8::/32' },
    ] }), ['1.2.3.0/24', '2001:db8::/32']);
    assert.deepEqual(parseList(null), []);
    assert.deepEqual(parseList({ prefixes: 'not an array' }), []);
    assert.deepEqual(parseList('<html></html>'), []);

    const many = { prefixes: Array.from({ length: MAX_PREFIXES + 50 }, (_, i) =>
        ({ ipv4Prefix: `10.${(i >> 8) & 255}.${i & 255}.0/24` })) };
    assert.equal(parseList(many).length, MAX_PREFIXES);
});

test('normIp: IPv4-mapped IPv6 is checked as the IPv4 it is', () => {
    assert.deepEqual(normIp('::ffff:216.73.216.12'), { ip: '216.73.216.12', type: 'ipv4' });
    assert.deepEqual(normIp('::FFFF:216.73.216.12'), { ip: '216.73.216.12', type: 'ipv4' });
    assert.deepEqual(normIp(' 216.73.216.12 '), { ip: '216.73.216.12', type: 'ipv4' });
    assert.deepEqual(normIp('2001:4860:4801:10::1'), { ip: '2001:4860:4801:10::1', type: 'ipv6' });
    assert.deepEqual(normIp('fe80::1%en0'), { ip: 'fe80::1', type: 'ipv6' });   // zone id dropped
    for (const bad of ['', null, undefined, 'nope', '1.2.3', '1.2.3.4.5', '::ffff:999.1.1.1', '216.73.216.12:443']) {
        assert.equal(normIp(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
});

test('buildMatcher matches IPv4, IPv6 and mapped addresses', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    const doc = { lists: {
        googlebot: { prefixes: parseList(fx('googlebot')), fetchedAt: new Date(now).toISOString() },
        claudebot: { prefixes: parseList(fx('claude-bots')), fetchedAt: new Date(now).toISOString() },
    } };
    const m = buildMatcher(doc, { now });
    assert.equal(m.hasList('googlebot'), true);
    assert.equal(m.hasList('bingbot'), false);
    assert.equal(m.contains('googlebot', '2001:4860:4801:10::abcd'), true);
    assert.equal(m.contains('googlebot', '192.178.4.5'), true);
    assert.equal(m.contains('googlebot', '::ffff:192.178.4.5'), true);
    assert.equal(m.contains('googlebot', '192.178.5.5'), false);
    assert.equal(m.contains('claudebot', '216.73.219.255'), true);    // last address of the /22
    assert.equal(m.contains('claudebot', '216.73.220.0'), false);     // first one past it
    assert.equal(m.contains('claudebot', 'not an ip'), false);
    assert.deepEqual(m.get('claudebot'), { prefixes: 4, fetchedAt: '2026-10-21T00:00:00.000Z' });
});

test('every SOURCES agent is a detectable key, and claude-code has no list', () => {
    const keys = new Set([...AGENTS, ...CRAWLERS].map(a => a.key));
    for (const s of SOURCES) {
        assert.ok(keys.has(s.agent), `${s.agent} is in AGENTS or CRAWLERS`);
        assert.match(s.url, /^https:\/\//);
    }
    assert.ok(!SOURCES.some(s => s.agent === 'claude-code'), "claude-code runs from the user's own IP");
    const claude = SOURCES.filter(s => s.agent.startsWith('claude'));
    assert.deepEqual(claude.map(s => s.agent).sort(), ['claude-searchbot', 'claude-user', 'claudebot']);
    assert.equal(new Set(claude.map(s => s.url)).size, 1, 'one Anthropic list for all three');
});
