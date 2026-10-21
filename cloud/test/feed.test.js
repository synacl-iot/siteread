import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { buildFeed, FEED_KEY } from '../src/feed.js';
import { memoryStore } from '../src/store.js';
import { serve } from '../src/node.js';
import { createVerifier } from '../../packages/verify/src/verifier.js';
import { SOURCES } from '../../packages/verify/src/ip-ranges.js';
import { vendorFetch, VENDOR_URLS, CLAUDEBOT, GOOGLEBOT, NOW, silent } from './helpers.js';

const HOUR = 3_600_000;

test('buildFeed: every vendor list in the document createVerifier({ feedUrl }) reads', async () => {
    const store = memoryStore();
    const fetch = vendorFetch();
    const { feed, result } = await buildFeed({ store, fetch, now: () => NOW, log: silent });
    assert.equal(result.failed.length, 0);
    // One GET per distinct URL: Anthropic's bots.json serves three agents.
    assert.deepEqual([...fetch.calls].sort(), [...VENDOR_URLS].sort());
    assert.deepEqual(Object.keys(feed.lists), SOURCES.map(s => s.agent));
    for (const { agent, url } of SOURCES) {
        const l = feed.lists[agent];
        assert.equal(l.fetchedAt, new Date(NOW).toISOString(), agent);
        assert.equal(l.source, url);
        assert.ok(l.prefixes.length > 0 && l.prefixes.every(p => typeof p === 'string' && p.includes('/')), agent);
    }
    assert.deepEqual(feed.lists.claudebot.prefixes, feed.lists['claude-user'].prefixes);
    assert.deepEqual(JSON.parse(await store.get(FEED_KEY)), feed);
});

test('buildFeed: every run refetches; a failed vendor keeps its copy and its age, then drops at 8 days', async () => {
    const store = memoryStore();
    await buildFeed({ store, fetch: vendorFetch(), now: () => NOW, log: silent });

    // An hour later: the copies are fresh, but the feed refetches anyway (force), so its copies
    // stay younger than any client's.
    const again = vendorFetch({ fail: new Set(['https://openai.com/chatgpt-user.json']) });
    const { feed } = await buildFeed({ store, fetch: again, now: () => NOW + HOUR, log: silent });
    assert.equal(again.calls.length, VENDOR_URLS.length);
    assert.equal(feed.lists['chatgpt-user'].fetchedAt, new Date(NOW).toISOString());
    assert.equal(feed.lists.gptbot.fetchedAt, new Date(NOW + HOUR).toISOString());

    // OpenAI's chatgpt-user list stays down: after 8 days nobody could refresh it, so the feed
    // stops carrying it rather than vouching for ranges that may have moved.
    const later = await buildFeed({ store, fetch: again, now: () => NOW + 8 * 24 * HOUR + HOUR, log: silent });
    assert.ok(!('chatgpt-user' in later.feed.lists));
    assert.ok('gptbot' in later.feed.lists);
});

test('feed over HTTP: the real client verifies through it, with no vendor GET of its own', async (t) => {
    const app = createApp({ store: memoryStore(), fetch: vendorFetch(), now: () => NOW, log: silent });
    const server = await serve(app, { port: 0 });
    t.after(() => server.close());
    const feedUrl = `http://127.0.0.1:${server.address().port}/v1/lists.json`;

    const before = await fetch(feedUrl);
    assert.equal(before.status, 503);
    assert.equal(before.headers.get('retry-after'), '600');

    await app.runFeed();
    const res = await fetch(feedUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    assert.match(res.headers.get('content-type'), /^application\/json/);

    const seen = [];
    const clientFetch = (url, init) => { seen.push(String(url)); return fetch(url, init); };
    const v = createVerifier({ feedUrl, fetch: clientFetch, now: () => NOW + HOUR, log: silent });
    const r = await v.refresh();
    assert.deepEqual(r.failed, []);
    assert.equal(r.fetched.length, SOURCES.length);
    assert.deepEqual(seen, [feedUrl]);
    assert.equal(v.check('216.73.216.12', CLAUDEBOT).verdict, 'verified');
    assert.equal(v.check('203.0.113.9', CLAUDEBOT).verdict, 'spoofed');
    assert.equal(v.check('192.178.4.5', GOOGLEBOT).verdict, 'verified');
    assert.equal(v.check('2001:4860:4801:10::1', GOOGLEBOT).verdict, 'verified');
    // The client keeps the feed's fetchedAt (when the feed got it from the vendor).
    assert.equal(v.lists().find(l => l.agent === 'claudebot').fetchedAt, new Date(NOW).toISOString());

    const head = await fetch(feedUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
});
