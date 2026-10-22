// The merged crawler-list feed: every vendor list in one document, the one
// createVerifier({ feedUrl }) reads:
//
//   { "siteread": "0.3.0", "generatedAt": "…",
//     "lists": { "<agent>": { "prefixes": ["cidr", …], "fetchedAt": "…", "source": "<vendor url>" } } }
//
// It is built by the package's own verifier against the vendors, so the feed obeys the same rules
// a local install does: a failed fetch keeps the previous copy with its old fetchedAt, a copy
// nobody could refresh for 8 days is dropped, and every prefix is bounded and re-validated.
// `fetchedAt` is when the FEED fetched the list from the vendor. The client keeps that time, so its
// 24 h / 8 day rules still measure the age of the vendor data, not of the hop through here.
//
// Every run refetches (force). A client takes a feed copy only when it is newer than its own and
// then keeps it until it is 24 h old, so the feed has to stay well younger than that: run this
// every few hours (the Node server does every 6).

// Relative imports, not the npm package: the feed and the client must be the same code at the same
// commit, and only the modules the feed needs (no fs, no zlib) so a non-Node host can bundle it.
import { createVerifier } from '../../packages/verify/src/verifier.js';
import { SOURCES } from '../../packages/verify/src/ip-ranges.js';
import { VERSION } from '../../packages/verify/src/version.js';
import { jsonDoc } from './store.js';

export const FEED_KEY = 'feed/lists.json';
export const FEED_EVERY_MS = 6 * 3_600_000;

/** One feed run: fetch every vendor list, publish the merged document. Never throws on a vendor. */
export async function buildFeed({ store, fetch: fetchImpl = globalThis.fetch, now = Date.now, log = console, sources = SOURCES } = {}) {
    const state = jsonDoc(store, 'feed/state.json');
    const verifier = createVerifier({ store: state, fetch: fetchImpl, now, log, sources });
    const result = await verifier.refresh({ force: true });
    if (result.error) throw new Error(`feed state: ${result.error}`);
    const held = (await state.get())?.lists ?? {};
    const lists = {};
    for (const { agent, url } of sources) {
        const l = held[agent];
        if (l?.prefixes?.length && l.fetchedAt) lists[agent] = { prefixes: l.prefixes, fetchedAt: l.fetchedAt, source: url };
    }
    const feed = { siteread: VERSION, generatedAt: new Date(now()).toISOString(), lists };
    await store.put(FEED_KEY, JSON.stringify(feed));
    return { feed, result };
}
