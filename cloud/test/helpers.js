// Shared by the cloud tests: the package's vendor-list fixtures behind a fake fetch, and a few
// made-up shares.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SOURCES, parseList } from '../../packages/verify/src/ip-ranges.js';
import { leadingZeroBits, PROOF_PREFIX } from '../../packages/verify/src/share.js';

const FIXTURES = new URL('../../packages/verify/test/fixtures/', import.meta.url);
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

export const CLAUDEBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';
export const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
export const VENDOR_URLS = [...new Set(SOURCES.map(s => s.url))];
// 2026-10-21, a Wednesday in 2026-W43.
export const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

/** The fixture lists as a verifier store document, fetched at `fetchedAt`. */
export function fixtureLists(fetchedAt = new Date().toISOString()) {
    const lists = {};
    for (const { agent, url } of SOURCES) {
        lists[agent] = { prefixes: parseList(JSON.parse(readFileSync(new URL(`${FIXTURE_FOR[url]}.json`, FIXTURES), 'utf8'))), fetchedAt };
    }
    return { lists };
}

/** A fetch that serves the fixtures; `fail` is a set of URLs that answer 500. Records each URL. */
export function vendorFetch({ fail = new Set() } = {}) {
    const calls = [];
    const f = async (url) => {
        calls.push(String(url));
        if (fail.has(String(url)) || !FIXTURE_FOR[url]) return new Response('nope', { status: 500 });
        return new Response(readFileSync(new URL(`${FIXTURE_FOR[url]}.json`, FIXTURES)), { status: 200 });
    };
    f.calls = calls;
    return f;
}

export const id = n => n.toString(16).padStart(32, '0');

export function share(n, week, metrics) {
    return { schema: 1, id: id(n), week, siteread: '0.3.0', metrics };
}

export function post(app, body, { type = 'application/json', path = '/v1/share' } = {}) {
    return app.fetch(new Request(`http://localhost${path}`, {
        method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
}

export const silent = { warn() {}, error() {} };

/** A proof of work for test id `n` with at least `bits` zero bits, or exactly `bits` with `exact`. */
export function proofFor(n, bits, { exact = false } = {}) {
    for (let k = 0; ; k++) {
        const got = leadingZeroBits(createHash('sha256').update(`${PROOF_PREFIX}${id(n)}:${k}`).digest());
        if (exact ? got === bits : got >= bits) return String(k);
    }
}
