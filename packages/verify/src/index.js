// siteread: is that crawler who it says it is? Vendor IP lists + a User-Agent table +
// scanner-path signatures, with zero dependencies. See README.md.

export { AGENTS, CRAWLERS, detectAgent, detectCrawler, isSearchCrawler } from './agents.js';
export { SCANNER_PATH_RE, isScannerPath } from './scanner.js';
export {
    SOURCES, parseCidr, parseList, normIp,
    REFRESH_AFTER_MS, DROP_AFTER_MS, MIN_PREFIX, MAX_PREFIXES, MAX_BODY_CHARS,
} from './ip-ranges.js';
export { createVerifier, memoryStore } from './verifier.js';
export { fileStore } from './file-store.js';
export { VERSION } from './version.js';
export { digest, parseSitemap, parseGoal } from './digest/index.js';
export { parseCsv } from './digest/csv.js';
export { classifySource } from './digest/referrer.js';
export { parseLine } from './digest/log.js';
export { sharePayload, validateShare, isoWeek, weekStart, addWeeks, SHARE_METRICS, SHARE_SCHEMA, SHARE_URL, SHARE_REFUSALS } from './share.js';
