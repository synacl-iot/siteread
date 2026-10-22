import { OperatorStatus } from '../api';
import { operatorView, REFUSAL_COLUMNS, refusalCells, USAGE_COLUMNS, usageCells } from './view';

export function status(over: Partial<OperatorStatus> = {}): OperatorStatus {
  const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(9 + i).padStart(2, '0')}`);
  return {
    ok: true,
    siteread: '0.3.0',
    now: '2026-10-22T10:00:00.000Z',
    feed: {
      generatedAt: '2026-10-22T06:00:00.000Z',
      lists: [
        { agent: 'chatgpt-user', prefixes: 234, fetchedAt: '2026-10-22T06:00:00.000Z', ageHours: 4 },
        { agent: 'perplexity-user', prefixes: 4, fetchedAt: '2026-10-21T06:00:00.000Z', ageHours: 28 },
      ],
    },
    lastFeedRun: { at: '2026-10-22T06:00:00.000Z', fetched: ['chatgpt-user'], failed: ['perplexity-user'], errors: { 'perplexity-user': 'HTTP 503' } },
    benchmark: {
      generatedAt: '2026-10-22T09:00:00.000Z', sites: 15, window: { from: '2026-W39', to: '2026-W42' },
      history: [{ week: '2026-W41', sites: 12 }, { week: '2026-W42', sites: 15 }],
      named: [{ label: 'synacl.com', week: '2026-W42' }],
    },
    newSites: days.map((day, i) => ({ day, sites: i % 3 })),
    newSitesToday: { sites: 1, proofBits: 22 },
    requests: days.map(day => ({
      day, taken: 2,
      refused: (day === '2026-10-22' ? { 'unknown-field': 1, 'old-week': 1, 'operator-denied': 2 } : {}) as Record<string, number>,
      hits: day === '2026-10-22'
        ? { feed: { siteread: 5, other: 1 }, benchmark: { local: 40, browser: 3, siteread: 1 }, health: { other: 2 }, other: { other: 9 } }
        : { feed: { siteread: 4 } } as Record<string, Record<string, number>>,
      versions: (day === '2026-10-22' ? { '0.3.0': 5, '0.2.1': 1 } : { '0.3.0': 4 }) as Record<string, number>,
    })),
    ...over,
  };
}

describe('refusalCells', () => {
  it('folds codes into the columns, and an unknown code into Other', () => {
    const cells = refusalCells({ 'unknown-metric': 2, 'unknown-field': 1, 'not-json': 1, 'future-week': 3, 'brand-new': 5 });
    const by = Object.fromEntries([...REFUSAL_COLUMNS.map(c => c.title), 'Other'].map((t, i) => [t, cells[i]]));
    expect(by).toEqual({
      'Unknown field': 3, 'Bad value': 1, Week: 3, 'Too large / type': 0, 'No proof': 0,
      'Token denied': 0, 'Server error': 0, Other: 5,
    });
  });
});

describe('operatorView', () => {
  it('says which list is kept from an older fetch, and why', () => {
    const v = operatorView(status());
    expect(v.feedCard).toEqual({ value: '1 of 2 fresh', note: 'perplexity-user kept from an older fetch', warn: true });
    expect(v.lists.map(l => [l.agent, l.fresh, l.error])).toEqual([['chatgpt-user', true, ''], ['perplexity-user', false, 'HTTP 503']]);
    expect(v.lastRun).toBe('last run 2026-10-22 06:00 UTC · fetched 1, failed 1');
  });

  it('counts today’s refusals and lists the last 7 days newest first', () => {
    const v = operatorView(status());
    expect(v.refusedCard).toEqual({ value: '4', note: '1 unknown-field, 1 old-week, 2 operator-denied' });
    expect(v.days.map(d => d.day)).toEqual(['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17', '2026-10-16']);
    expect(v.days[0].cells.length).toBe(v.columns.length);
    expect(v.named).toBe('synacl.com: 2026-W42');
    expect(v.newCard).toEqual({ value: '1', note: "a new site's proof costs 22 bits now; one more per 50 new sites, back to base at 00:00 UTC" });
  });

  it('copes with a service that has built nothing yet', () => {
    const v = operatorView(status({ feed: null, lastFeedRun: null, benchmark: null }));
    expect(v.feedCard.value).toBe('no feed yet');
    expect(v.benchCard.value).toBe('not built');
    expect(v.lastRun).toBe('the feed job has not run');
    expect(v.weeks).toEqual([]);
  });

  it('reports a feed run that failed as a whole', () => {
    const v = operatorView(status({ lastFeedRun: { at: '2026-10-22T06:00:00.000Z', error: 'store is read-only' } }));
    expect(v.lastRun).toBe('last run 2026-10-22 06:00 UTC failed: store is read-only');
  });
});

describe('API usage', () => {
  it('splits the feed by siteread and the benchmark by page views', () => {
    expect(usageCells({ feed: { siteread: 5, other: 1 }, benchmark: { local: 40, browser: 3, siteread: 1 }, health: { other: 2 }, other: { other: 9 } }))
      .toEqual([5, 1, 43, 1, 2, 9]);
    expect(usageCells(undefined)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(usageCells({}).length).toBe(USAGE_COLUMNS.length);
  });

  it('counts today’s feed and the versions calling in over 7 days', () => {
    const v = operatorView(status());
    expect(v.feedTodayCard).toEqual({ value: '6 fetches', note: '5 by siteread; each install fetches at most once a day' });
    expect(v.usage[0]).toEqual({ day: '2026-10-22', cells: [5, 1, 43, 1, 2, 9] });
    expect(v.usage[1]).toEqual({ day: '2026-10-21', cells: [4, 0, 0, 0, 0, 0] });
    expect(v.versions).toBe('0.3.0 ×29 · 0.2.1 ×1');
  });

  it('copes with days counted before usage was', () => {
    const old = status();
    for (const d of old.requests) { delete d.hits; delete d.versions; }
    const v = operatorView(old);
    expect(v.feedTodayCard.value).toBe('0 fetches');
    expect(v.versions).toBe('none yet');
  });
});
