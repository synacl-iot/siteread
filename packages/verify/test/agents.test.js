import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, CRAWLERS, detectAgent, detectCrawler, isSearchCrawler } from '../src/index.js';

// Real User-Agent strings as they appear in access logs.
const UA = {
    chatgptUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
    oaiSearch: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    claudebot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    claudeUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    claudeCode: 'Claude-User (claude-code/2.1.292; +https://support.anthropic.com/)',
    claudeCodeBare: 'claude-code/2.0.14',
    applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    googleExtended: 'Mozilla/5.0 (compatible; Google-Extended/1.0)',
    googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    googlebotImage: 'Googlebot-Image/1.0',
    bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    duckassist: 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)',
    browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

test('claude-code is matched BEFORE claude-user', () => {
    assert.equal(detectAgent(UA.claudeCode).key, 'claude-code');
    assert.equal(detectAgent(UA.claudeCodeBare).key, 'claude-code');
    assert.equal(detectAgent(UA.claudeUser).key, 'claude-user');
    assert.equal(detectAgent('Claude-User').key, 'claude-user');
    // The order is what makes this work: claude-user's /Claude-User/ also matches claude-code's UA.
    const idx = (k) => AGENTS.findIndex(a => a.key === k);
    assert.ok(idx('claude-code') < idx('claude-user'));
    assert.ok(AGENTS[idx('claude-user')].re.test(UA.claudeCode));
    assert.match(detectAgent(UA.claudeCode).note, /own machine/);
});

test('the AI agents resolve to the right key, assistant and purpose', () => {
    const want = {
        chatgptUser: ['chatgpt-user', 'chatgpt', 'answer'],
        gptbot: ['gptbot', 'chatgpt', 'training'],
        oaiSearch: ['oai-searchbot', 'chatgpt', 'search'],
        claudebot: ['claudebot', 'claude', 'training'],
        applebot: ['applebot', 'apple', 'search'],
        duckassist: ['duckassistbot', 'duckduckgo', 'answer'],
    };
    for (const [ua, [key, assistant, purpose]] of Object.entries(want)) {
        const a = detectAgent(UA[ua]);
        assert.deepEqual([a?.key, a?.assistant, a?.purpose], [key, assistant, purpose], ua);
    }
});

test('Google-Extended is detected, and marked as a robots.txt token, never a real UA', () => {
    const a = detectAgent(UA.googleExtended);
    assert.equal(a.key, 'google-extended');
    assert.equal(a.robotsTokenOnly, true);
    assert.match(a.note, /robots\.txt token/);
});

test('search crawlers are not AI agents, and AI agents are not search crawlers', () => {
    assert.equal(detectCrawler(UA.googlebot).key, 'googlebot');
    assert.equal(detectCrawler(UA.googlebotImage).key, 'googlebot');
    assert.equal(detectCrawler(UA.bingbot).key, 'bingbot');
    assert.equal(detectCrawler(UA.ahrefs).purpose, 'seo');
    assert.equal(detectAgent(UA.googlebot), null);
    assert.equal(detectAgent(UA.bingbot), null);
    assert.equal(isSearchCrawler(UA.googlebot), true);
    assert.equal(isSearchCrawler(UA.bingbot), true);
    assert.equal(isSearchCrawler(UA.gptbot), false);
    assert.equal(isSearchCrawler(UA.applebot), false);   // an AGENTS entry (Siri, Spotlight, Apple Intelligence)
    // DuckAssistBot (AI) and DuckDuckBot (search) must not cross.
    assert.equal(detectCrawler(UA.duckassist), null);
    assert.equal(detectCrawler('DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)').key, 'duckduckbot');
});

test('a browser, an empty UA and junk match nothing', () => {
    for (const ua of [UA.browser, '', undefined, null, 42, 'curl/8.4.0', 'python-requests/2.32.3']) {
        assert.equal(detectAgent(ua), null, String(ua));
        assert.equal(detectCrawler(ua), null, String(ua));
        assert.equal(isSearchCrawler(ua), false, String(ua));
    }
});

test('keys are unique across both tables, and the tables are frozen', () => {
    const keys = [...AGENTS, ...CRAWLERS].map(a => a.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(Object.isFrozen(AGENTS) && Object.isFrozen(AGENTS[0]));
    assert.ok(Object.isFrozen(CRAWLERS) && Object.isFrozen(CRAWLERS[0]));
});
