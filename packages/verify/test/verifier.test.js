import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVerifier, memoryStore, SOURCES, REFRESH_AFTER_MS, DROP_AFTER_MS } from '../src/index.js';

// Every network call goes through a stub serving the captured fixtures: these tests run offline.
const fx = (name) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
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
};
const DISTINCT_URLS = new Set(SOURCES.map(s => s.url)).size;

/** fetch stub. `respond(url)` can override; otherwise the fixture for the URL. */
function stubFetch(respond = () => null) {
    const calls = [];
    const f = async (url) => {
        calls.push(url);
        const r = respond(url);
        if (r) return r;
        const name = FIXTURE_FOR[url];
        return name
            ? new Response(fx(name), { status: 200, headers: { 'content-type': 'application/json' } })
            : new Response('not found', { status: 404 });
    };
    f.calls = calls;
    return f;
}
const down = () => new Response('<html>Service Unavailable</html>', { status: 503 });

const quiet = { warn() {}, error() {} };
const T0 = Date.parse('2026-10-21T00:00:00Z');
function clock(t = T0) { const c = () => c.t; c.t = t; return c; }

const UA = {
    claudebot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    claudeUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    claudeCode: 'Claude-User (claude-code/2.1.292; +https://support.anthropic.com/)',
    chatgptUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    yandex: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    ccbot: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
    googleExtended: 'Mozilla/5.0 (compatible; Google-Extended)',
    browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};
const SCANNER_IP = '203.0.113.9';   // TEST-NET-3: in no vendor's list

async function ready(opts = {}) {
    const fetch = opts.fetch || stubFetch();
    const v = createVerifier({ fetch, now: clock(), log: quiet, ...opts });
    const r = await v.refresh();
    return { v, r, fetch };
}

test('verified, spoofed, unknown and n/a', async () => {
    const { v, r } = await ready();
    assert.equal(r.failed.length, 0);
    assert.equal(r.fetched.length, SOURCES.length);

    assert.deepEqual(v.check('216.73.216.12', UA.claudebot), {
        agent: 'claudebot', kind: 'ai', assistant: 'claude', purpose: 'training',
        source: 'https://claude.com/crawling/bots.json', verdict: 'verified', reason: 'in-vendor-list',
    });
    assert.equal(v.check(SCANNER_IP, UA.claudebot).verdict, 'spoofed');
    assert.equal(v.check(SCANNER_IP, UA.claudebot).reason, 'not-in-vendor-list');
    assert.equal(v.check('160.79.106.130', UA.claudeUser).verdict, 'verified');
    assert.equal(v.check('104.208.184.200', UA.chatgptUser).verdict, 'verified');
    assert.equal(v.check('104.208.184.200', UA.claudebot).verdict, 'spoofed', "OpenAI's IP is not Anthropic's");

    // Search crawlers: IPv6, IPv4 and an IPv4-mapped address as a dual-stack listener logs it.
    assert.equal(v.check('2001:4860:4801:10::1', UA.googlebot).verdict, 'verified');
    assert.equal(v.check('::ffff:192.178.4.5', UA.googlebot).verdict, 'verified');
    assert.equal(v.check(SCANNER_IP, UA.googlebot).verdict, 'spoofed');
    const bing = v.check('157.55.39.10', UA.bingbot);
    assert.deepEqual([bing.kind, bing.agent, bing.verdict, bing.assistant], ['crawler', 'bingbot', 'verified', null]);

    // No vendor list: claude-code (the user's own machine), CCBot, YandexBot.
    for (const ua of [UA.claudeCode, UA.ccbot, UA.yandex]) {
        const c = v.check(SCANNER_IP, ua);
        assert.deepEqual([c.verdict, c.reason, c.source], ['unknown', 'no-vendor-list', null], ua);
    }
    assert.equal(v.check('216.73.216.12', UA.claudeCode).verdict, 'unknown', 'claude-code never uses the bots list');

    // Google-Extended never arrives as a real User-Agent.
    const ge = v.check('2001:4860:4801:10::1', UA.googleExtended);
    assert.deepEqual([ge.agent, ge.verdict, ge.reason], ['google-extended', 'spoofed', 'robots-token-not-a-user-agent']);

    assert.deepEqual(v.check('1.2.3.4', UA.browser), {
        agent: null, kind: null, assistant: null, purpose: null, verdict: 'n/a', reason: 'not-a-known-agent', source: null,
    });
    assert.equal(v.check('1.2.3.4', '').verdict, 'n/a');
    assert.deepEqual([v.check('not-an-ip', UA.claudebot).verdict, v.check('not-an-ip', UA.claudebot).reason], ['unknown', 'invalid-ip']);
});

test('before any refresh, a listed agent is unknown (list-unavailable), never spoofed', () => {
    const v = createVerifier({ fetch: stubFetch(), now: clock(), log: quiet });
    assert.deepEqual([v.check('216.73.216.12', UA.claudebot).verdict, v.check('216.73.216.12', UA.claudebot).reason],
        ['unknown', 'list-unavailable']);
});

test("one GET per distinct URL: Anthropic's bots.json serves three agents", async () => {
    const { fetch } = await ready();
    assert.equal(fetch.calls.length, DISTINCT_URLS);
    assert.equal(fetch.calls.filter(u => u === 'https://claude.com/crawling/bots.json').length, 1);
});

test('a list younger than 24 h is not refetched; force refetches it', async () => {
    const now = clock();
    const fetch = stubFetch();
    const v = createVerifier({ fetch, now, log: quiet });
    await v.refresh();
    now.t = T0 + REFRESH_AFTER_MS - 1;
    const r = await v.refresh();
    assert.equal(fetch.calls.length, DISTINCT_URLS, 'no new calls');
    assert.equal(r.fresh.length, SOURCES.length);
    assert.equal(v.lists().every(l => l.fresh), true);

    const f = await v.refresh({ force: true });
    assert.equal(f.fetched.length, SOURCES.length);
    assert.equal(fetch.calls.length, 2 * DISTINCT_URLS);
});

test('a failed fetch keeps the old copy; after 8 days it is dropped', async () => {
    const now = clock();
    let outage = false;
    const fetch = stubFetch(() => (outage ? down() : null));
    const store = memoryStore();
    const v = createVerifier({ fetch, now, store, log: quiet });
    await v.refresh();

    outage = true;
    now.t = T0 + REFRESH_AFTER_MS + 1;
    const r1 = await v.refresh();
    assert.equal(r1.failed.length, SOURCES.length);
    assert.equal(r1.errors.claudebot, 'HTTP 503');
    assert.deepEqual(r1.dropped, []);
    assert.equal(v.check('216.73.216.12', UA.claudebot).verdict, 'verified', 'old copy still in use');
    assert.equal(v.check(SCANNER_IP, UA.claudebot).verdict, 'spoofed');
    assert.equal((await store.get()).lists.claudebot.fetchedAt, new Date(T0).toISOString(), 'stored copy kept');

    now.t = T0 + DROP_AFTER_MS - 1;
    assert.deepEqual((await v.refresh()).dropped, []);

    now.t = T0 + DROP_AFTER_MS + 1;
    const r2 = await v.refresh();
    assert.equal(r2.dropped.length, SOURCES.length);
    assert.deepEqual((await store.get()).lists, {});
    const c = v.check(SCANNER_IP, UA.claudebot);
    assert.deepEqual([c.verdict, c.reason], ['unknown', 'list-unavailable'], 'no list → unknown, not spoofed');
    assert.equal(v.lists().find(l => l.agent === 'claudebot').prefixes, 0);
});

test('broken responses are failures, not empty lists', async () => {
    const cases = {
        'https://openai.com/gptbot.json': () => new Response('<!doctype html><title>Just a moment…</title>', { status: 200 }),
        'https://openai.com/searchbot.json': () => new Response('{"prefixes":[]}', { status: 200 }),
        'https://www.bing.com/toolbox/bingbot.json': () => new Response('{"prefixes":[{"ipv4Prefix":"0.0.0.0/0"}]}', { status: 200 }),
        'https://www.perplexity.com/perplexitybot.json': () => new Response(`{"prefixes":[],"pad":"${'x'.repeat(2_000_001)}"}`, { status: 200 }),
        'https://search.developer.apple.com/applebot.json': () => { throw new TypeError('fetch failed'); },
    };
    const { v, r } = await ready({ fetch: stubFetch((url) => cases[url]?.() ?? null) });
    assert.deepEqual(r.failed.sort(), ['applebot', 'bingbot', 'gptbot', 'oai-searchbot', 'perplexitybot']);
    assert.match(r.errors.gptbot, /JSON/);
    assert.equal(r.errors['oai-searchbot'], 'no usable prefixes');
    assert.equal(r.errors.bingbot, 'no usable prefixes', 'a /0 is a broken list, not a big one');
    assert.equal(r.errors.perplexitybot, 'response too large');
    assert.equal(r.errors.applebot, 'fetch failed');
    assert.equal(v.check('157.55.39.10', UA.bingbot).verdict, 'unknown');
    assert.equal(v.check('216.73.216.12', UA.claudebot).verdict, 'verified', 'the others still load');
});

test('a fetch without a streaming body works too', async () => {
    const fetch = async (url) => {
        const name = FIXTURE_FOR[url];
        return { ok: true, status: 200, text: async () => fx(name) };
    };
    const { v, r } = await ready({ fetch });
    assert.equal(r.failed.length, 0);
    assert.equal(v.check('216.73.216.12', UA.claudebot).verdict, 'verified');
});

test('refresh never throws: no fetch, a failing store read, a failing store write', async () => {
    const noFetch = createVerifier({ fetch: null, now: clock(), log: quiet });
    const r0 = await noFetch.refresh();
    assert.equal(r0.failed.length, SOURCES.length);
    assert.equal(r0.errors.claudebot, 'no fetch available');

    const fetch = stubFetch();
    const badRead = createVerifier({ fetch, now: clock(), log: quiet,
        store: { get: async () => { throw new Error('disk on fire'); }, set: async () => {} } });
    const r1 = await badRead.refresh();
    assert.equal(r1.error, 'disk on fire');
    assert.equal(fetch.calls.length, 0, 'no fetch when the store cannot be read');

    const badWrite = createVerifier({ fetch: stubFetch(), now: clock(), log: quiet,
        store: { get: async () => null, set: async () => { throw new Error('read-only'); } } });
    const r2 = await badWrite.refresh();
    assert.equal(r2.error, 'read-only');
    assert.equal(badWrite.check('216.73.216.12', UA.claudebot).verdict, 'verified', 'usable in-process anyway');
});

test('a stored fetchedAt from the future is not trusted as fresh', async () => {
    const store = memoryStore({ lists: { claudebot: { prefixes: ['10.0.0.0/8'], fetchedAt: '2099-01-01T00:00:00.000Z' } } });
    const fetch = stubFetch((url) => (url.includes('claude.com') ? down() : null));
    const v = createVerifier({ fetch, now: clock(), store, log: quiet });
    assert.equal((await v.load()).find(l => l.agent === 'claudebot').prefixes, 0, 'the matcher ignores it');
    const r = await v.refresh();
    assert.ok(r.failed.includes('claudebot'));
    assert.ok(r.dropped.includes('claudebot'));
    assert.equal(v.check('10.1.2.3', UA.claudebot).verdict, 'unknown');
});

test('isKnownScannerIp (the 444 rule) only turns unknown into spoofed; a vendor list wins', async () => {
    const seen = [];
    const scanners = new Set([SCANNER_IP, '216.73.216.12']);
    const { v } = await ready({ isKnownScannerIp: (ip) => { seen.push(ip); return scanners.has(ip); } });

    const cc = v.check(SCANNER_IP, UA.ccbot);
    assert.deepEqual([cc.verdict, cc.reason], ['spoofed', 'known-scanner-ip']);
    assert.equal(v.check('198.51.100.7', UA.ccbot).verdict, 'unknown', 'not a scanner: still unknown, never verified');
    assert.equal(v.check(`::ffff:${SCANNER_IP}`, UA.claudeCode).verdict, 'spoofed');
    assert.ok(seen.includes(SCANNER_IP), 'the hook gets the normalised address');

    // The ClaudeBot incident: a real crawler that followed a bad link into a scanner path.
    assert.equal(v.check('216.73.216.12', UA.claudebot).verdict, 'verified');

    const throwing = createVerifier({ fetch: stubFetch(), now: clock(), log: quiet, isKnownScannerIp: () => { throw new Error('x'); } });
    assert.equal(throwing.check(SCANNER_IP, UA.ccbot).verdict, 'unknown');
});

test('load() lets a reader see what another process refreshed into a shared store', async () => {
    const store = memoryStore();
    const writer = createVerifier({ fetch: stubFetch(), now: clock(), store, log: quiet });
    const reader = createVerifier({ fetch: () => { throw new Error('readers never fetch'); }, now: clock(), store, log: quiet });
    await writer.refresh();
    assert.equal(reader.check('216.73.216.12', UA.claudebot).verdict, 'unknown');
    await reader.load();
    assert.equal(reader.check('216.73.216.12', UA.claudebot).verdict, 'verified');
});

test('lists() reports every source in order with its size and age', async () => {
    const { v } = await ready();
    const rows = v.lists();
    assert.deepEqual(rows.map(l => l.agent), SOURCES.map(s => s.agent));
    const claude = rows.find(l => l.agent === 'claudebot');
    assert.deepEqual(claude, {
        agent: 'claudebot', url: 'https://claude.com/crawling/bots.json', prefixes: 4,
        fetchedAt: new Date(T0).toISOString(), fresh: true,
    });
});

test('custom sources: only those agents are fetched and checked', async () => {
    const fetch = stubFetch();
    const sources = [{ agent: 'bingbot', url: 'https://www.bing.com/toolbox/bingbot.json' }];
    const { v } = await ready({ fetch, sources });
    assert.deepEqual(fetch.calls, ['https://www.bing.com/toolbox/bingbot.json']);
    assert.equal(v.check('157.55.39.10', UA.bingbot).verdict, 'verified');
    assert.deepEqual([v.check('216.73.216.12', UA.claudebot).verdict, v.check('216.73.216.12', UA.claudebot).reason],
        ['unknown', 'no-vendor-list']);
});

test('feedUrl: one GET of a merged document replaces every vendor fetch', async () => {
    const FEED = 'https://feed.example/v1/lists.json';
    const vendorAt = '2026-10-20T18:00:00.000Z';
    const feed = { lists: {
        claudebot: { prefixes: ['216.73.216.0/22'], fetchedAt: vendorAt },
        'claude-user': { prefixes: ['160.79.106.128/28', 'junk', '0.0.0.0/0'], fetchedAt: vendorAt },
        googlebot: { prefixes: ['2001:4860:4801:10::/64'], fetchedAt: '2099-01-01T00:00:00.000Z' },   // clamped
        bingbot: { prefixes: ['157.55.39.0/24'] },                                                    // no fetchedAt
        gptbot: { prefixes: ['0.0.0.0/0'], fetchedAt: vendorAt },                                     // nothing usable
        'made-up-agent': { prefixes: ['1.2.3.0/24'], fetchedAt: vendorAt },                           // ignored
    } };
    const fetch = stubFetch((url) => (url === FEED ? new Response(JSON.stringify(feed), { status: 200 }) : null));
    const store = memoryStore();
    const now = clock();
    const v = createVerifier({ fetch, now, store, feedUrl: FEED, log: quiet });
    const r = await v.refresh();

    assert.deepEqual(fetch.calls, [FEED], 'no vendor URL is touched');
    assert.deepEqual(r.fetched.sort(), ['claude-user', 'claudebot', 'googlebot']);
    assert.ok(r.failed.includes('bingbot') && r.failed.includes('gptbot') && r.failed.includes('chatgpt-user'));
    assert.equal(v.check('216.73.216.12', UA.claudebot).verdict, 'verified');
    assert.equal(v.check(SCANNER_IP, UA.claudebot).verdict, 'spoofed');
    assert.equal(v.check('160.79.106.130', UA.claudeUser).verdict, 'verified');
    assert.equal(v.check('157.55.39.10', UA.bingbot).verdict, 'unknown');

    const stored = (await store.get()).lists;
    assert.equal(stored.claudebot.fetchedAt, vendorAt, "keeps the feed's (vendor) fetch time");
    assert.equal(stored.googlebot.fetchedAt, new Date(T0).toISOString(), 'a future fetchedAt is clamped to now');
    assert.deepEqual(stored['claude-user'].prefixes, ['160.79.106.128/28']);
    assert.equal(stored['made-up-agent'], undefined);

    // The feed going down keeps the copies, exactly like a vendor going down.
    const downFetch = stubFetch(() => down());
    const v2 = createVerifier({ fetch: downFetch, now, store, feedUrl: FEED, log: quiet });
    now.t = T0 + REFRESH_AFTER_MS + 1;
    const r2 = await v2.refresh();
    assert.deepEqual(downFetch.calls, [FEED]);
    assert.equal(r2.errors.claudebot, 'HTTP 503');
    assert.equal(v2.check('216.73.216.12', UA.claudebot).verdict, 'verified');
});

test('feedUrl with fallback: what the feed cannot give comes from the vendors; nothing more', async () => {
    const FEED = 'https://feed.example/v1/lists.json';
    const vendorAt = '2026-10-20T18:00:00.000Z';
    const claude = 'https://claude.com/crawling/bots.json';
    // The feed has the Claude list only; every vendor answers for itself.
    const feed = { lists: { claudebot: { prefixes: ['216.73.216.0/22'], fetchedAt: vendorAt } } };
    const fetch = stubFetch((url) => (url === FEED ? new Response(JSON.stringify(feed), { status: 200 }) : null));
    const v = createVerifier({ fetch, now: clock(), store: memoryStore(), feedUrl: FEED, fallback: true, log: quiet });
    const r = await v.refresh();
    assert.equal(fetch.calls[0], FEED, 'the feed first');
    assert.ok(fetch.calls.includes('https://www.bing.com/toolbox/bingbot.json'), 'a list the feed lacks comes from its vendor');
    assert.ok(fetch.calls.includes(claude), 'claude-user and claude-searchbot were missing from the feed');
    assert.ok(r.fetched.includes('claudebot') && r.fetched.includes('bingbot'));
    assert.deepEqual(r.failed, []);
    assert.equal(v.check('157.55.39.10', UA.bingbot).verdict, 'verified');

    // The feed down: every list from its vendor, and the feed's error is not reported as the list's.
    const downFeed = stubFetch((url) => (url === FEED ? down() : null));
    const v2 = createVerifier({ fetch: downFeed, now: clock(), store: memoryStore(), feedUrl: FEED, fallback: true, log: quiet });
    const r2 = await v2.refresh();
    assert.deepEqual(r2.failed, []);
    assert.equal(downFeed.calls.length, 1 + new Set(SOURCES.map(s => s.url)).size);
});
