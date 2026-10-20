// Who a request CLAIMS to be, from its User-Agent. A claim only: anyone can send any UA, and
// on the site this was extracted from most AI user-agents outside the vendors' IP lists were a
// scanner cycling through them (ip-ranges.js has the numbers). verifier.js turns a claim into a
// verdict.
//
// Ported from the AI-traffic classifier Synacl Labs runs on synacl.com (2026-10).
//
// purpose: `answer`   fetched live while answering someone (ChatGPT-User, Perplexity-User)
//          `search`   building the assistant's search index (OAI-SearchBot, PerplexityBot)
//          `training` a model-training crawl (GPTBot, ClaudeBot, CCBot)

// Ordered: the FIRST match on the User-Agent wins. Not AI (left out on purpose, see CRAWLERS):
// PetalBot, GoogleOther, Googlebot, bingbot. Copilot's fetches cannot be told apart from Bing's.
export const AGENTS = Object.freeze([
    { key: 'chatgpt-user',         re: /ChatGPT-User/i,         assistant: 'chatgpt',     purpose: 'answer' },
    { key: 'oai-searchbot',        re: /OAI-SearchBot/i,        assistant: 'chatgpt',     purpose: 'search' },
    { key: 'gptbot',               re: /GPTBot/i,               assistant: 'chatgpt',     purpose: 'training' },
    // Before claude-user: Claude Code's WebFetch sends `Claude-User (claude-code/2.1.292; …)` from
    // the user's OWN machine, so it can never be in Anthropic's IP list and stays on the 444 rule.
    { key: 'claude-code',          re: /^claude-code\/|^Claude-User \(claude-code\//i, assistant: 'claude', purpose: 'answer',
        note: "Claude Code's WebFetch runs from the user's own machine, so no vendor list can cover it" },
    { key: 'claude-user',          re: /Claude-User/i,          assistant: 'claude',      purpose: 'answer' },
    { key: 'claude-searchbot',     re: /Claude-SearchBot/i,     assistant: 'claude',      purpose: 'search' },
    { key: 'claudebot',            re: /ClaudeBot/i,            assistant: 'claude',      purpose: 'training' },
    { key: 'perplexity-user',      re: /Perplexity-User/i,      assistant: 'perplexity',  purpose: 'answer' },
    { key: 'perplexitybot',        re: /PerplexityBot/i,        assistant: 'perplexity',  purpose: 'search' },
    { key: 'applebot',             re: /Applebot/i,             assistant: 'apple',       purpose: 'search' },
    { key: 'amazonbot',            re: /Amazonbot/i,            assistant: 'amazon',      purpose: 'search' },
    { key: 'meta-externalfetcher', re: /meta-externalfetcher/i, assistant: 'meta',        purpose: 'answer' },
    { key: 'meta-externalagent',   re: /meta-externalagent/i,   assistant: 'meta',        purpose: 'training' },
    { key: 'duckassistbot',        re: /DuckAssistBot/i,        assistant: 'duckduckgo',  purpose: 'answer' },
    { key: 'mistralai-user',       re: /MistralAI-User/i,       assistant: 'mistral',     purpose: 'answer' },
    { key: 'youbot',               re: /YouBot/i,               assistant: 'you',         purpose: 'search' },
    // Not a real User-Agent (Google-Extended is a robots.txt token): always spoofed in practice.
    // Google's crawlers obey it, but fetch as Googlebot; nothing real ever sends it as a UA.
    { key: 'google-extended',      re: /Google-Extended/i,      assistant: 'gemini',      purpose: 'training',
        robotsTokenOnly: true, note: 'Google-Extended is a robots.txt token, never a real user-agent' },
    { key: 'ccbot',                re: /CCBot/i,                assistant: 'commoncrawl', purpose: 'training' },
    { key: 'bytespider',           re: /Bytespider/i,           assistant: 'bytedance',   purpose: 'training' },
    { key: 'cohere',               re: /cohere-ai/i,            assistant: 'cohere',      purpose: 'training' },
    { key: 'deepseek',             re: /DeepSeekBot/i,          assistant: 'deepseek',    purpose: 'training' },
    { key: 'xai',                  re: /xAI-Grok|GrokBot/i,     assistant: 'grok',        purpose: 'training' },
    { key: 'ai2bot',               re: /AI2Bot/i,               assistant: 'ai2',         purpose: 'training' },
].map(Object.freeze));

// Classic search-engine and SEO-tool crawlers, the non-AI half of the original CRAWLER_RE. The
// AI names it also matched (GPTBot, OAI-SearchBot, ChatGPT, ClaudeBot, Applebot, Amazonbot,
// Bytespider) live in AGENTS, which is checked first. purpose: `search` (an engine's index),
// `seo` (a backlink/SEO tool's crawl) or `preview` (a link-preview fetch).
export const CRAWLERS = Object.freeze([
    { key: 'googlebot',           re: /Googlebot/i,           operator: 'google',     purpose: 'search' },
    { key: 'bingbot',             re: /bingbot/i,             operator: 'bing',       purpose: 'search' },
    { key: 'yandexbot',           re: /YandexBot/i,           operator: 'yandex',     purpose: 'search' },
    { key: 'duckduckbot',         re: /DuckDuckBot/i,         operator: 'duckduckgo', purpose: 'search' },
    { key: 'slurp',               re: /Slurp/i,               operator: 'yahoo',      purpose: 'search' },
    { key: 'petalbot',            re: /PetalBot/i,            operator: 'huawei',     purpose: 'search' },
    { key: 'ahrefsbot',           re: /AhrefsBot/i,           operator: 'ahrefs',     purpose: 'seo' },
    { key: 'semrushbot',          re: /SemrushBot/i,          operator: 'semrush',    purpose: 'seo' },
    { key: 'mj12bot',             re: /MJ12bot/i,             operator: 'majestic',   purpose: 'seo' },
    { key: 'facebookexternalhit', re: /facebookexternalhit/i, operator: 'meta',       purpose: 'preview' },
].map(Object.freeze));

// One cheap test before the ordered walk: most lines are not an AI agent at all.
const ANY_AGENT_RE = new RegExp(AGENTS.map(a => a.re.source).join('|'), 'i');
const ANY_CRAWLER_RE = new RegExp(CRAWLERS.map(c => c.re.source).join('|'), 'i');

/** The AGENTS entry a User-Agent claims to be, or null. */
export function detectAgent(ua) {
    if (typeof ua !== 'string' || !ua || !ANY_AGENT_RE.test(ua)) return null;
    for (const a of AGENTS) if (a.re.test(ua)) return a;
    return null;
}

/** The CRAWLERS entry a User-Agent claims to be, or null. Not an AI agent: those match AGENTS. */
export function detectCrawler(ua) {
    if (typeof ua !== 'string' || !ua || !ANY_CRAWLER_RE.test(ua)) return null;
    if (detectAgent(ua)) return null;
    for (const c of CRAWLERS) if (c.re.test(ua)) return c;
    return null;
}

/** True when the UA claims to be a classic search-engine or SEO crawler (never an AI agent). */
export function isSearchCrawler(ua) {
    return detectCrawler(ua) !== null;
}
