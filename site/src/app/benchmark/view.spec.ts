import { Benchmark } from '../api';
import { benchmarkView, niceCeil, ordinal, rowView, utcMinute } from './view';

const metric = (sites: number, q?: [number, number, number], lowerIsBetter = false) => ({
  about: 'x', lowerIsBetter, sites, ...(q ? { p25: q[0], p50: q[1], p75: q[2] } : {}),
});

export function sample(over: Partial<Benchmark> = {}): Benchmark {
  return {
    siteread: '0.3.0',
    generatedAt: '2026-10-22T09:00:12.345Z',
    window: { from: '2026-W39', to: '2026-W42' },
    sites: 14,
    minSites: 10,
    metrics: {
      people: metric(14, [41, 118, 356]),
      aiSpoofedPct: metric(14, [38, 64, 83]),
      gscClicks: metric(9),
    },
    named: [{ label: 'synacl.com', week: '2026-W42', metrics: { people: { value: 96, percentile: 44 }, gscClicks: { value: 31 } } }],
    history: [{ week: '2026-W41', sites: 12 }, { week: '2026-W42', sites: 15 }],
    ...over,
  };
}

describe('formatting', () => {
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 44, 101, 111].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '44th', '101st', '111th']);
  });

  it('rounds a strip end up to a round number', () => {
    expect([0, -1, 0.7, 1, 4.45, 445, 1001, 12.5].map(niceCeil)).toEqual([1, 1, 0.8, 1, 5, 500, 1200, 15]);
  });

  it('prints times in UTC to the minute, whatever the reader’s zone', () => {
    expect(utcMinute('2026-10-22T09:00:12.345Z')).toBe('2026-10-22 09:00 UTC');
  });
});

describe('rowView', () => {
  const named = sample().named[0];

  it('a shown metric: quartiles, rank, geometry inside the scale', () => {
    const r = rowView({ key: 'people', label: 'People', about: '' }, metric(14, [41, 118, 356]), 10, named);
    expect(r.shown).toBe(true);
    expect(r.quartiles).toBe('41 · 118 · 356');
    expect(r.named).toBe('96 · 44th');
    expect(r.sitesText).toBe('14 sites');
    expect(r.hiText).toBe('500');
    expect(r.box).toEqual({ left: 8.2, width: 63 });
    expect(r.median).toBe(23.6);
    expect(r.marker).toBe(19.2);
  });

  it('a hidden metric: the count only, the named value without a rank', () => {
    const r = rowView({ key: 'gscClicks', label: 'Clicks', about: '' }, metric(9), 10, named);
    expect(r.shown).toBe(false);
    expect(r.quartiles).toBe('');
    expect(r.waiting).toBe('9 of 10 anonymous sites');
    expect(r.named).toBe('31');
    expect(r.box).toBeNull();
    expect(r.median).toBeNull();
  });

  it('a percentage never scales past 100 and carries its unit', () => {
    const r = rowView({ key: 'aiSpoofedPct', label: 'Spoofed', about: '', unit: '%' }, metric(14, [38, 64, 95]), 10, null);
    expect(r.hiText).toBe('100 %');
    expect(r.quartiles).toBe('38 % · 64 % · 95 %');
    expect(r.named).toBeNull();
    expect(r.marker).toBeNull();
  });
});

describe('benchmarkView', () => {
  it('groups the known metrics in page order and keeps the header facts', () => {
    const v = benchmarkView(sample());
    expect(v.groups.map(g => g.title)).toEqual(['People', 'AI agents', 'Search']);
    expect(v.groups.map(g => g.rows.map(r => r.key))).toEqual([['people'], ['aiSpoofedPct'], ['gscClicks']]);
    expect(v.early).toBe(false);
    expect(v.named).toEqual({ label: 'synacl.com', week: '2026-W42' });
    expect(v.windowText).toBe("each site's latest share, 2026-W39 to 2026-W42");
    expect(v.builtText).toBe('built 2026-10-22 09:00 UTC');
    expect(v.history).toEqual([
      { label: 'W41', week: '2026-W41', sites: 12, pct: 80 },
      { label: 'W42', week: '2026-W42', sites: 15, pct: 100 },
    ]);
  });

  it('is early while no metric has its quartiles', () => {
    const v = benchmarkView(sample({ sites: 2, metrics: { people: metric(2), gscClicks: metric(1) } }));
    expect(v.early).toBe(true);
  });

  it('shows a metric this page does not know yet, in the service’s words', () => {
    const v = benchmarkView(sample({ metrics: { people: metric(14, [1, 2, 3]), newThing: { ...metric(3), about: 'something new' } } }));
    expect(v.groups.at(-1)).toMatchObject({ title: 'More', rows: [{ key: 'newThing', label: 'newThing', about: 'something new' }] });
  });

  it('works with no named site and no history', () => {
    const v = benchmarkView(sample({ named: [], history: [], window: null }));
    expect(v.named).toBeNull();
    expect(v.groups[0].rows[0].named).toBeNull();
    expect(v.history).toEqual([]);
    expect(v.windowText).toBe('no shares yet');
  });
});
