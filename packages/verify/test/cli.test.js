import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, parseList } from '../src/index.js';

const BIN = fileURLToPath(new URL('../bin/siteread.js', import.meta.url));
// The child gets a fetch that always fails, so a test that would touch the network fails loudly.
const OFFLINE = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("offline in tests")}';
const FIXTURE_FOR = {
    'https://openai.com/chatgpt-user.json': 'chatgpt-user',
    'https://openai.com/searchbot.json': 'searchbot',
    'https://openai.com/gptbot.json': 'gptbot',
    'https://www.perplexity.com/perplexity-user.json': 'perplexity-user',
    'https://www.perplexity.com/perplexitybot.json': 'perplexitybot',
    'https://search.developer.apple.com/applebot.json': 'applebot',
    'https://claude.com/crawling/bots.json': 'claude-bots',
    'https://developers.google.com/static/search/apis/ipranges/googlebot.json': 'googlebot',
    'https://www.bing.com/toolbox/bingbot.json': 'bingbot',
    'https://duckduckgo.com/duckassistbot.json': 'duckassistbot',
    'https://duckduckgo.com/duckduckbot.json': 'duckduckbot',
    'https://mistral.ai/mistralai-user-ips.json': 'mistralai-user',
    'https://index.commoncrawl.org/ccbot.json': 'ccbot',
};
const CLAUDEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';

/** A cache file holding every fixture list, fetched "now": the CLI never needs the network. */
function seededCache(t, { fetchedAt = new Date().toISOString(), only } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-cli-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const lists = {};
    for (const { agent, url } of SOURCES) {
        if (only && !only.includes(agent)) continue;
        const body = JSON.parse(readFileSync(new URL(`./fixtures/${FIXTURE_FOR[url]}.json`, import.meta.url), 'utf8'));
        lists[agent] = { prefixes: parseList(body), fetchedAt };
    }
    const file = join(dir, 'lists.json');
    writeFileSync(file, JSON.stringify({ lists }), { mode: 0o600 });
    return file;
}

function run(args, cache) {
    const r = spawnSync(process.execPath, ['--import', OFFLINE, BIN, ...args], {
        env: { ...process.env, SITEREAD_CACHE: cache ?? join(tmpdir(), 'siteread-cli-unused', 'lists.json') },
        encoding: 'utf8',
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
}

test('check: verified exits 0, spoofed 2, unknown 3', (t) => {
    const cache = seededCache(t);
    const ok = run(['check', '216.73.216.12', CLAUDEBOT], cache);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /^verified {2}216\.73\.216\.12 is claudebot \(claude, training\): in claude\.com\/crawling\/bots\.json \(4 prefixes/);

    const bad = run(['check', '203.0.113.9', CLAUDEBOT], cache);
    assert.equal(bad.code, 2, bad.err);
    assert.match(bad.out, /^spoofed {3}203\.0\.113\.9 claims claudebot .* but is not in claude\.com\/crawling\/bots\.json/);

    const cc = run(['check', '203.0.113.9', 'Claude-User (claude-code/2.1.292; +https://support.anthropic.com/)'], cache);
    assert.equal(cc.code, 3, cc.err);
    assert.match(cc.out, /^unknown {3}.*claude-code.*own machine/);

    const ge = run(['check', '203.0.113.9', 'Mozilla/5.0 (compatible; Google-Extended)'], cache);
    assert.equal(ge.code, 2);
    assert.match(ge.out, /robots\.txt token/);
});

test('check: a UA that is no known agent is n/a (exit 3) and needs no lists', (t) => {
    const r = run(['check', '1.2.3.4', 'curl/8.4.0']);
    assert.equal(r.code, 3);
    assert.match(r.out, /^n\/a {7}"curl\/8\.4\.0" is not a known AI agent or search crawler/);
});

test('check --json prints the full result', (t) => {
    const r = run(['check', '--json', '::ffff:157.55.39.10', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'], seededCache(t));
    assert.equal(r.code, 0, r.err);
    const j = JSON.parse(r.out);
    assert.equal(j.verdict, 'verified');
    assert.equal(j.agent, 'bingbot');
    assert.equal(j.kind, 'crawler');
    assert.equal(j.list.prefixes, 3);
});

test('a failed refresh falls back to the cached copy and says so on stderr', (t) => {
    const stale = new Date(Date.now() - 2 * 86_400_000).toISOString();   // due, but within 8 days
    const r = run(['check', '216.73.216.12', CLAUDEBOT], seededCache(t, { fetchedAt: stale }));
    assert.equal(r.code, 0);
    assert.match(r.err, /could not refresh claudebot: offline in tests \(kept the copy from/);
});

test('with no list at all, a listed agent is unknown (exit 3), never spoofed', (t) => {
    const r = run(['check', '203.0.113.9', CLAUDEBOT], seededCache(t, { only: [] }));
    assert.equal(r.code, 3);
    assert.match(r.out, /^unknown {3}.*could not load claude\.com\/crawling\/bots\.json/);
});

test('lists prints every source', (t) => {
    // Two hours old, on a whole second: fresh, so nothing is refetched.
    const at = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 1000) * 1000).toISOString();
    const r = run(['lists'], seededCache(t, { fetchedAt: at }));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, '');
    const lines = r.out.trim().split('\n');
    assert.match(lines[0], /^agent\s+prefixes\s+fetched \(UTC\)\s+source$/);
    assert.equal(lines.length, SOURCES.length + 1);
    const shown = at.replace('.000Z', 'Z');
    assert.ok(lines.some(l => /^claudebot\s+4\s/.test(l) && l.includes(shown) && l.endsWith('https://claude.com/crawling/bots.json')));
    assert.ok(lines.some(l => /^googlebot\s+4\s/.test(l)));
});

test('the feed by default, the vendors with --no-feed or when the feed fails', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'siteread-feed-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    // Every fetch is written down and fails, so the run shows the order it tried things in.
    const RECORD = 'data:text/javascript,globalThis.fetch=async(u)=>{process.stderr.write("FETCH "+u+"\\n");throw new Error("offline in tests")}';
    const go = (args, env = {}) => spawnSync(process.execPath, ['--import', RECORD, BIN, ...args], {
        env: { ...process.env, SITEREAD_FEED_URL: '', SITEREAD_CACHE: join(dir, `${Math.random()}.json`), ...env }, encoding: 'utf8',
    });
    const fetched = r => [...r.stderr.matchAll(/^FETCH (\S+)$/gm)].map(m => m[1]);
    const byDefault = fetched(go(['lists']));
    assert.equal(byDefault[0], 'https://api.siteread.dev/v1/lists.json', 'the feed first');
    assert.ok(byDefault.includes('https://openai.com/chatgpt-user.json'), 'then the vendors, since the feed failed');
    assert.ok(!fetched(go(['lists', '--no-feed'])).some(u => u.includes('siteread.dev')), '--no-feed never asks the feed');
    assert.ok(!fetched(go(['lists'], { SITEREAD_FEED_URL: 'off' })).some(u => u.includes('siteread.dev')));
    assert.equal(fetched(go(['lists'], { SITEREAD_FEED_URL: 'http://127.0.0.1:8787/v1/lists.json' }))[0], 'http://127.0.0.1:8787/v1/lists.json');
});

test('usage errors exit 1; --help exits 0', () => {
    assert.equal(run(['--help']).code, 0);
    assert.match(run(['--help']).out, /siteread check <ip> "<user-agent>"/);
    assert.equal(run([]).code, 1);
    assert.equal(run(['check']).code, 1);
    assert.equal(run(['check', '1.2.3.4']).code, 1);
    assert.equal(run(['check', '1.2.3.4', 'Claude', 'User']).code, 1, 'an unquoted UA is a usage error');
    assert.equal(run(['check', 'not-an-ip', CLAUDEBOT]).code, 1);
    assert.equal(run(['frobnicate']).code, 1);
    assert.equal(run(['lists', '--bogus']).code, 1);
});
