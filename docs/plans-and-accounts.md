# Plans and accounts

Decided by the owner on 2026-10-21 in the give-to-get discussion, and checked against the
repo as it stood on 2026-10-22 (phase 3 live). It covers what is decided, what was built since
that changes the picture, and what is still open. The full write-up with the research is a
private page: https://claude.ai/artifact/794Gf5p1yjdzReUBUjh3Zu

Paid is still deferred (charter principle 5). This doc is the shape the paid plans take when the
trigger fires ("repeated 'how does my site compare' demand"). Nothing here is built.

## The three plans

| Plan | What it is | Account | Status |
|---|---|---|---|
| **Free** | The package and the `seo-read` skill, fully local. Optional `siteread share` sends one week of aggregate numbers and gets back where each number stands among the published quartiles. | None (see below) | Live |
| **S1** | Free, plus benchmarks by industry and site size, and your own percentile history | Yes | Not built |
| **S2** | S1, plus read-depth benchmarks from beacon rollups, and the "what works" findings | Yes | Not built |

The names are the owner's pick (2026-10-21): Free, S1, S2.
Free covers both "anonymous, local" and "registered, sharing" from the original idea; sharing is
a choice inside Free, not a separate plan.

## Decisions (owner, 2026-10-21)

1. **Paid timing.** Principle 5 stands: S1 and S2 start only when the demand trigger fires. The
   fields S1 and S2 need (industry label, size bucket, change tags) should start accruing in the
   share payload before then, so the paid views have history on day one.
2. **Beacon.** The read beacon stays on the user's own server. S2's "beacon analytics" means
   benchmarks on read rate and read depth from rollups the digest computes, never a hosted
   collector. A hosted beacon would put visitor IPs and URLs on our server (non-goal).
3. **Accounts.** Least identity that works: an email-verified account issues a key, shares are
   stored under the random site id, and the email-to-site-id mapping lives in its own table and is
   deleted on request. The email never sits beside the numbers.
4. **What stays public.** The overall benchmark stays public on siteread.dev with `n` printed and
   the named rows. Industry cuts, history and "what works" are S1/S2.
5. **Code.** The paid service code is closed for now. The client, the payload schema and the free
   service stay open (MIT), so anyone can audit exactly what `share` sends.

## What phase 3 changed (needs the owner's confirmation)

Phase 3 shipped on 2026-10-22, after these decisions, and two of its choices bear on them:

- **Free sharing has no account, and works.** `share` sends with a random 128-bit id kept in
  `.siteread/share-id`, and a new id pays a proof of work whose price rises with the day's new
  sites. That solves the abuse problem accounts were meant to solve. Proposed reading of
  decision 3: Free stays account-free as built; the account arrives with S1/S2, where billing
  and history need it, and links to the site's existing share id.
- **The free service code is already public.** `cloud/` is in this repo, which went public on
  2026-10-22. Proposed reading of decision 5: the free service (feed, share, aggregate) stays here
  and open; S1/S2 server code lives in a separate private repo.
- **The benchmark publishes quartiles only** (25th/50th/75th), from at least 10 anonymous sites per
  metric. Industry cuts must follow the same rule: no cell published under 10 sites.

## The share payload

Schema 1, as shipped in `packages/verify/src/share.js`. The keys are `schema`, `id` (random),
`week` (ISO), `siteread` (version), `metrics` and, on a site's first share, `proof`. The metrics
are an allowlist of numbers for the digest's last 7 days:

`people`, `peopleFromSearch`, `peopleFromAi`, `peopleFromSocial`, `aiAnswerFetches`,
`aiSearchFetches`, `aiTrainingFetches`, `searchEngineFetches`, `aiSpoofedPct`, `gscImpressions`,
`gscClicks`, `gscCtrPct`, `gscPosition`.

Never sent: hostnames, URLs or paths, visitor IPs, user-agents, query text, goal labels. The CLI
prints the exact bytes and sends nothing without a yes.

**Not in schema 1 yet** (decision 1 wants them before paid): an industry label from a fixed list
of about 12, a sitemap-size bucket, change tags from a fixed list ("added llms.txt", "submitted
sitemap", "published 2+ posts"), and beacon rollups (read rate, median read depth). That would be
schema 2, with the same allowlist rule and no free text.

## Pricing (open)

Researched 2026-10-21; the owner has not picked a price.

- **Running cost** is not the constraint. Each site sends one payload a week. The service runs on
  its own small Vultr VM (see `cloud/HOSTING.md`). Payment fees and the owner's time are the real
  costs.
- **Comparable tools, monthly USD, as listed on 2026-10-21.** Privacy analytics: Pirsch $6/$12,
  Fathom from $15, Simple Analytics $20, Umami Cloud $20. AI crawler analytics: Known Agents
  (formerly Dark Visitors) free, $29, $299. AI search visibility: Otterly $29/$189/$489. None sells
  a cross-site AI-crawl benchmark.
- **Options for S1 / S2:**
  - A, low: $5/mo or $48/yr; $12/mo or $120/yr.
  - B, mid: $9/mo or $90/yr; $19/mo or $190/yr.
  - C, yearly only: $49/yr; $149/yr.
  - D, AI-tool anchor: $12/mo; $29/mo.

## Payments (open)

The operator's company is registered in India.

- **Razorpay** works for an Indian company and is cheapest per sale (2% + GST domestic; "up to
  3%" for international cards, per its marketing page). But it is a payment aggregator, not a
  merchant of record. The company would be the seller to every foreign buyer and owe their VAT;
  EU rules generally make a non-EU seller of digital services to consumers register from the
  first sale. Its docs list international cards for Checkout and Payment Links, not Subscriptions.
- **Paddle** accepts Indian sellers, is the merchant of record (handles VAT and sales tax), and
  charges 5% + 50¢ a sale, paid out by wire ($15 when currencies differ) or Payoneer.
- Lemon Squeezy pays Indian sellers only through PayPal (Stripe India is invite-only). Dodo
  Payments is a merchant of record, but its page does not say whether it onboards Indian companies.
- **Recommendation, not decided:** Paddle for international buyers, with Razorpay as an option for
  Indian buyers paying by UPI or in INR. Check the tax side with the company's CA before launch.

## Still open

- Confirm the two readings in "What phase 3 changed".
- Schema 2 fields and the fixed lists (industries, change tags), and when to ship them.
- S1/S2 prices and the payment route.
- Whether long-time sharers get S1 free for a while as a launch offer.
