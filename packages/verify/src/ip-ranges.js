// The vendors' published crawler IP lists: what tells a real ChatGPT-User from a scanner
// wearing its User-Agent. The store is pluggable (verifier.js).
//
// WHY (measured on one site's nginx log, 2026-09-17 → 10-16). A scanner cycles AI user-agents:
// 217 of 221 ChatGPT-User requests from outside OpenAI's list came from IPs that also got a 444
// (nginx's "close the connection, send nothing" answer to a scanner path), and DeepSeekBot /
// CCBot / Grok / Perplexity-User / Claude-SearchBot were 100 % spoofed. Where a vendor publishes
// a list, "IP is in it" is the test; where none exists, the fallback is "the IP never hit a
// scanner path" (the 444 rule: createVerifier's `isKnownScannerIp`). On that site the two tests
// agreed almost perfectly, so the fallback is honest, just weaker.
//
// The 444 rule CANNOT clear a crawler that follows a bad link into a scanner path. ClaudeBot
// (on the 444 rule until 10-17) resolved a GitHub README's relative links against the site,
// asked for /protocol//blob/master/examples/docker-compose.yml, drew one 444, and all 50 of
// that IP's reads that day were counted spoofed. Anthropic publishes ONE list for its bots,
// claude.com/crawling/bots.json, used here for all three Claude agents: on 30 days of log every
// ClaudeBot IP and every page-reading Claude-User IP was in it, and the four IPs probing
// /.env-style paths under Claude names were not. (Claude-User from Anthropic's 160.79.104.0/21
// was NOT in it: that is the MCP connector calling a tool server, not a page read. The list
// published 2026-10-07 does carry two /28s from that range.)
//
// SHAPE. A list is refetched only when its stored copy is > 24 h old. A failed fetch keeps the
// previous copy; a copy nobody could refresh for 8 days is dropped, so a vendor's moved ranges
// cannot quietly mark its new IPs as spoofed forever. Nothing here throws: no store, no network
// or a broken list all end in "no list for that agent", which is the verdict 'unknown'.

import net from 'node:net';

export const REFRESH_AFTER_MS = 24 * 3_600_000;
export const DROP_AFTER_MS = 8 * 86_400_000;
export const FETCH_TIMEOUT_MS = 8_000;
// A list is a few hundred prefixes; these bound what a broken (or hostile) response can cost.
export const MAX_BODY_CHARS = 2_000_000;
export const MAX_PREFIXES = 20_000;
// The broadest prefix a list may hold. A /0 would verify EVERY address, and since the CLI reads
// the hosted feed by default, the feed's server vouches for every client's "verified": if it were
// ever taken over, it could add a broad range to any agent and every spoofer in it would pass.
// Measured 2026-10-22, the broadest real prefix in any list is OpenAI's /16 (chatgpt-user) for
// IPv4 and Google's /64 for IPv6, so these limits cost nothing real and cut the worst case from
// a /8 to a /16. A list holding a broader prefix is refused whole (its previous copy kept, the
// error reported), never trimmed: trimming would silently turn a vendor's real new range into
// "spoofed", and a refusal says out loud that a limit or a list needs a look.
export const MIN_PREFIX = Object.freeze({ ipv4: 16, ipv6: 32 });
// Two processes sharing a store can disagree on the time by a little. A fetchedAt further in
// the future than this is not skew: it would keep a list "fresh" forever and defeat the drop.
const CLOCK_SKEW_MS = 5 * 60_000;

const CLAUDE_BOTS = 'https://claude.com/crawling/bots.json';

// Agent key (agents.js AGENTS / CRAWLERS) → its vendor's published list. Every URL answers
// { creationTime, prefixes: [{ ipv4Prefix } | { ipv6Prefix }] } (all checked 2026-10-21).
// The hosted feed (api.siteread.dev): every list above in one document, refetched from the vendors every
// 6 h. The CLI reads it by default (the charter: the feed is opt-out); the library does not, and
// the hosted service's feed job must not, since it is what builds the feed.
export const FEED_URL = 'https://api.siteread.dev/v1/lists.json';

export const SOURCES = Object.freeze([
    { agent: 'chatgpt-user',     url: 'https://openai.com/chatgpt-user.json' },
    { agent: 'oai-searchbot',    url: 'https://openai.com/searchbot.json' },
    { agent: 'gptbot',           url: 'https://openai.com/gptbot.json' },
    { agent: 'perplexity-user',  url: 'https://www.perplexity.com/perplexity-user.json' },
    { agent: 'perplexitybot',    url: 'https://www.perplexity.com/perplexitybot.json' },
    { agent: 'applebot',         url: 'https://search.developer.apple.com/applebot.json' },
    // Not claude-code: Claude Code's WebFetch runs on the user's own machine, never from these.
    { agent: 'claude-user',      url: CLAUDE_BOTS },
    { agent: 'claude-searchbot', url: CLAUDE_BOTS },
    { agent: 'claudebot',        url: CLAUDE_BOTS },
    // Classic search. googlebot.json covers Googlebot and its -Image/-News/-Video variants.
    { agent: 'googlebot',        url: 'https://developers.google.com/static/search/apis/ipranges/googlebot.json' },
    { agent: 'bingbot',          url: 'https://www.bing.com/toolbox/bingbot.json' },
].map(Object.freeze));

/** 'a.b.c.d/n' or 'x::/n' → { type, net, prefix, cidr } (normalised), or null; MIN_PREFIX applies. */
export function parseCidr(raw) {
    const p = cidrOf(raw);
    return p && p.prefix >= MIN_PREFIX[p.type] ? p : null;
}

/** parseCidr without the breadth limit, so a list parser can tell "too broad" from "not a prefix". */
function cidrOf(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    const slash = s.indexOf('/');
    if (slash < 1 || s.length > 64) return null;
    const addr = s.slice(0, slash);
    const bits = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(bits)) return null;
    const prefix = Number(bits);
    const type = net.isIPv4(addr) ? 'ipv4' : net.isIPv6(addr) ? 'ipv6' : null;
    if (!type) return null;
    if (prefix > (type === 'ipv4' ? 32 : 128)) return null;
    return { type, net: addr.toLowerCase(), prefix, cidr: `${addr.toLowerCase()}/${prefix}` };
}

// One prefix of a list: skipped when it is not a prefix at all, the whole list refused when it
// is one broader than MIN_PREFIX (see there).
function addPrefix(out, raw) {
    const p = cidrOf(raw);
    if (!p) return;
    if (p.prefix < MIN_PREFIX[p.type]) throw new Error(`${p.cidr} is broader than /${MIN_PREFIX[p.type]}; list refused`);
    out.add(p.cidr);
}

/** The vendors' shared format: { prefixes: [{ ipv4Prefix } | { ipv6Prefix }] } → [cidr]. Throws on a too-broad prefix. */
export function parseList(body) {
    const items = Array.isArray(body?.prefixes) ? body.prefixes : [];
    const out = new Set();
    for (const it of items) {
        if (out.size >= MAX_PREFIXES) break;
        addPrefix(out, it?.ipv4Prefix ?? it?.ipv6Prefix);
    }
    return [...out];
}

/** A feed's or a stored copy's prefixes ([cidr]) → [cidr], re-validated and bounded. Throws on a too-broad prefix. */
export function parsePrefixes(list) {
    if (!Array.isArray(list)) return [];
    const out = new Set();
    for (const c of list.slice(0, MAX_PREFIXES)) addPrefix(out, c);
    return [...out];
}

// An address as the log writes it → { ip, type }, or null. An IPv4-mapped IPv6 address
// (::ffff:1.2.3.4, what a dual-stack listener can log) is checked as the IPv4 it is.
export function normIp(raw) {
    let s = String(raw ?? '').trim().toLowerCase();
    const zone = s.indexOf('%');
    if (zone !== -1) s = s.slice(0, zone);
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
    if (mapped) s = mapped[1];
    if (net.isIPv4(s)) return { ip: s, type: 'ipv4' };
    if (net.isIPv6(s)) return { ip: s, type: 'ipv6' };
    return null;
}

/** ms since epoch from a stored fetchedAt, or NaN. */
export function fetchedAtMs(l) {
    return typeof l?.fetchedAt === 'string' ? Date.parse(l.fetchedAt) : NaN;
}

/** True when a copy fetched at `at` is younger than `maxAgeMs` at `now` (and not from the future). */
export function youngerThan(at, now, maxAgeMs) {
    return Number.isFinite(at) && now - at < maxAgeMs && at - now <= CLOCK_SKEW_MS;
}

/** { lists: { agent: { prefixes, fetchedAt } } } from whatever a store returned. */
export function normDoc(doc) {
    const lists = doc && typeof doc === 'object' && doc.lists && typeof doc.lists === 'object' && !Array.isArray(doc.lists)
        ? doc.lists : {};
    // A copy: the caller mutates it, and an in-memory store may hand out its own object.
    const out = {};
    for (const [agent, l] of Object.entries(lists)) {
        if (l && typeof l === 'object' && Array.isArray(l.prefixes)) {
            out[agent] = { prefixes: l.prefixes.slice(0, MAX_PREFIXES), fetchedAt: l.fetchedAt };
        }
    }
    return { lists: out };
}

/**
 * A matcher over a stored document: { hasList(agent), contains(agent, addr), get(agent) }.
 * Only the agents in `sources` are loaded, and a copy past the drop age is ignored even if
 * nobody ran refresh() to delete it.
 */
export function buildMatcher(doc, { sources = SOURCES, now = Date.now() } = {}) {
    const lists = new Map();   // agent → { block, count, fetchedAt }
    for (const { agent } of sources) {
        if (lists.has(agent)) continue;
        const l = doc?.lists?.[agent];
        if (!l || !Array.isArray(l.prefixes)) continue;
        if (!youngerThan(fetchedAtMs(l), now, DROP_AFTER_MS)) continue;
        const block = new net.BlockList();
        let count = 0;
        for (const c of l.prefixes.slice(0, MAX_PREFIXES)) {
            const p = parseCidr(c);
            if (!p) continue;
            try { block.addSubnet(p.net, p.prefix, p.type); count++; } catch { /* skip */ }
        }
        if (count) lists.set(agent, { block, count, fetchedAt: l.fetchedAt });
    }
    return {
        hasList: (agent) => lists.has(agent),
        /** `addr` is normIp()'s { ip, type } or a raw address string. */
        contains(agent, addr) {
            const l = lists.get(agent);
            const a = l && (typeof addr === 'object' && addr ? addr : normIp(addr));
            if (!a) return false;
            try { return l.block.check(a.ip, a.type); } catch { return false; }
        },
        get: (agent) => {
            const l = lists.get(agent);
            return l ? { prefixes: l.count, fetchedAt: l.fetchedAt } : null;
        },
    };
}

// The body, read at most MAX_BODY_CHARS deep: a hostile endpoint streaming forever is cut off
// here (and by the fetch timeout) instead of being buffered whole before the size check.
async function readCapped(res, max = MAX_BODY_CHARS) {
    const reader = res.body?.getReader?.();
    if (!reader) {
        const text = await res.text();
        if (text.length > max) throw new Error('response too large');
        return text;
    }
    const dec = new TextDecoder();
    let text = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (text.length > max) {
            await reader.cancel().catch(() => {});
            throw new Error('response too large');
        }
    }
    return text + dec.decode();
}

/** GET a URL and JSON.parse it, bounded in time and size. Throws on any failure. */
export async function fetchJson(url, fetchImpl, { userAgent } = {}) {
    const headers = { accept: 'application/json' };
    if (userAgent) headers['user-agent'] = userAgent;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers });
    if (!res || !res.ok) throw new Error(`HTTP ${res?.status}`);
    const text = await readCapped(res);
    // A list URL that answers 200 with an HTML page (a moved list, a CDN challenge) must not
    // parse as an empty list: JSON.parse is the check. (Content-Type is no help: OpenAI serves
    // chatgpt-user.json as application/octet-stream.)
    return JSON.parse(text);
}

/** One vendor list → [cidr]. Throws when it holds nothing usable. */
export async function fetchList(url, fetchImpl, opts) {
    const prefixes = parseList(await fetchJson(url, fetchImpl, opts));
    if (!prefixes.length) throw new Error('no usable prefixes');
    return prefixes;
}
