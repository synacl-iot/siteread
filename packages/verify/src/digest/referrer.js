// Where a visit came from: the Referer of its first page view, or the landing URL's utm_source.
//
// utm_source wins because the AI assistants mostly send no Referer: ChatGPT tags its links
// `?utm_source=chatgpt.com`, and on one site that tag was the only trace of what became the
// channel with the most tool use per visitor (2026-09). ChatGPT traffic never appears in GSC.

// [source, kind, host test]. First match wins, so gemini.google.com sits before google.
const SOURCES = [
    ['chatgpt', 'ai', /(^|\.)(chatgpt\.com|chat\.openai\.com)$/],
    ['perplexity', 'ai', /(^|\.)perplexity\.ai$/],
    ['claude', 'ai', /(^|\.)claude\.ai$/],
    ['gemini', 'ai', /^gemini\.google\.com$/],
    ['copilot', 'ai', /^copilot\.microsoft\.com$/],
    ['deepseek', 'ai', /(^|\.)deepseek\.com$/],
    // Duck.ai is DuckDuckGo's chat, not its search: a click from it is an assistant's answer.
    ['duckai', 'ai', /^duck\.ai$/],
    ['mistral', 'ai', /^chat\.mistral\.ai$/],
    ['grok', 'ai', /^grok\.com$/],
    ['meta-ai', 'ai', /(^|\.)meta\.ai$/],
    ['google', 'search', /(^|\.)google\.[a-z.]+$/],
    ['bing', 'search', /(^|\.)bing\.com$/],
    ['duckduckgo', 'search', /(^|\.)duckduckgo\.com$/],
    ['yandex', 'search', /(^|\.)yandex\.[a-z.]+$|(^|\.)ya\.ru$/],
    ['baidu', 'search', /(^|\.)baidu\.com$/],
    ['yahoo', 'search', /(^|\.)yahoo\.[a-z.]+$/],
    ['ecosia', 'search', /(^|\.)ecosia\.org$/],
    ['brave', 'search', /^search\.brave\.com$/],
    ['naver', 'search', /(^|\.)naver\.com$/],
    ['reddit', 'social', /(^|\.)reddit\.com$|^redd\.it$/],
    ['hackernews', 'social', /^news\.ycombinator\.com$/],
    ['x', 'social', /^(t\.co|x\.com|(www\.|mobile\.)?twitter\.com)$/],
    ['linkedin', 'social', /(^|\.)linkedin\.com$|^lnkd\.in$/],
    ['facebook', 'social', /(^|\.)facebook\.com$|^fb\.me$/],
    ['youtube', 'social', /(^|\.)youtube\.com$|^youtu\.be$/],
    ['dev.to', 'social', /^dev\.to$/],
    ['github', 'social', /(^|\.)github\.com$/],
    ['medium', 'social', /(^|\.)medium\.com$/],
    ['lobsters', 'social', /^lobste\.rs$/],
    ['bluesky', 'social', /^bsky\.app$/],
];

const UTM = new Map([
    ['chatgpt.com', 'chatgpt'], ['chatgpt', 'chatgpt'], ['openai', 'chatgpt'],
    ['perplexity', 'perplexity'], ['perplexity.ai', 'perplexity'], ['claude.ai', 'claude'], ['claude', 'claude'],
    ['copilot.com', 'copilot'], ['duck.ai', 'duckai'], ['grok.com', 'grok'], ['gemini', 'gemini'], ['reddit', 'reddit'], ['hn', 'hackernews'],
    ['news.ycombinator.com', 'hackernews'], ['twitter', 'x'], ['x', 'x'], ['linkedin', 'linkedin'],
    ['devto', 'dev.to'], ['dev.to', 'dev.to'], ['newsletter', 'newsletter'], ['email', 'email'],
]);
const KIND = new Map(SOURCES.map(([s, k]) => [s, k]));

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

const bare = h => h.replace(/^www\./, '');

/**
 * { source, kind } for a landing. kind: ai · search · social · referral · internal · direct.
 * `site` is the site's own host (www. ignored); a Referer from it is `internal`.
 */
export function classifySource(referer, target, { site = null } = {}) {
    const q = String(target ?? '').split('?')[1];
    if (q) {
        const utm = new URLSearchParams(q).get('utm_source');
        if (utm) {
            const u = utm.toLowerCase();
            const s = UTM.get(u) ?? u;
            return { source: s, kind: KIND.get(s) ?? 'campaign' };
        }
    }
    if (!referer || referer === '-') return { source: 'direct', kind: 'direct' };
    const h = hostOf(referer);
    if (!h) return { source: 'direct', kind: 'direct' };
    if (site && bare(h) === bare(site)) return { source: 'internal', kind: 'internal' };
    for (const [source, kind, re] of SOURCES) if (re.test(h)) return { source, kind };
    return { source: bare(h), kind: 'referral' };
}

/** The referer's host, for guessing the site's own host when `site` is not given. */
export function refererHost(referer) {
    return referer && referer !== '-' ? hostOf(referer) : null;
}
