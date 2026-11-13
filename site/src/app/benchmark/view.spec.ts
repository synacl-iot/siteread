import { Benchmark, NamedRow } from '../api';
import { benchmarkView, kpis, namedSentence, niceCeil, ordinal, ratios, rowView, spotlight, spotlights, utcMinute } from './view';

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
  const named = sample().named;

  it('a shown metric: quartiles, rank, geometry inside the scale', () => {
    const r = rowView({ key: 'people', label: 'People', about: '' }, metric(14, [41, 118, 356]), 10, named);
    expect(r.shown).toBe(true);
    expect(r.quartiles).toBe('41 · 118 · 356');
    expect(r.named).toEqual([{ label: 'synacl.com', text: '96 · 44th', marker: 19.2 }]);
    expect(r.sitesText).toBe('14 sites');
    expect(r.hiText).toBe('500');
    expect(r.box).toEqual({ left: 8.2, width: 63 });
    expect(r.median).toBe(23.6);
  });

  it('a hidden metric: the count only, the named value without a rank', () => {
    const r = rowView({ key: 'gscClicks', label: 'Clicks', about: '' }, metric(9), 10, named);
    expect(r.shown).toBe(false);
    expect(r.quartiles).toBe('');
    expect(r.waiting).toBe('9 of 10 anonymous sites');
    expect(r.named).toEqual([{ label: 'synacl.com', text: '31', marker: 77.5 }]);
    expect(r.box).toBeNull();
    expect(r.median).toBeNull();
  });

  it('a percentage never scales past 100 and carries its unit', () => {
    const r = rowView({ key: 'aiSpoofedPct', label: 'Spoofed', about: '', unit: '%' }, metric(14, [38, 64, 95]), 10, []);
    expect(r.hiText).toBe('100 %');
    expect(r.quartiles).toBe('38 % · 64 % · 95 %');
    expect(r.named).toEqual([]);
  });
});

describe('benchmarkView', () => {
  it('groups the known metrics in page order and keeps the header facts', () => {
    const v = benchmarkView(sample());
    expect(v.groups.map(g => g.title)).toEqual(['People', 'AI agents', 'Search']);
    expect(v.groups.map(g => g.rows.map(r => r.key))).toEqual([['people'], ['aiSpoofedPct'], ['gscClicks']]);
    expect(v.early).toBe(false);
    expect(v.named).toEqual([{ label: 'synacl.com', week: '2026-W42' }]);
    expect(v.namedText).toBe("synacl.com (the site siteread was first built to read) is the one named site, by its owner's choice.");
    expect(v.namedLabels).toBe('synacl.com');
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
    expect(v.named).toEqual([]);
    expect(v.namedText).toBe('');
    expect(v.groups[0].rows[0].named).toEqual([]);
    expect(v.history).toEqual([]);
    expect(v.windowText).toBe('no shares yet');
  });
});

describe('several named sites', () => {
  const two = sample({
    named: [
      { label: 'synacl.com', week: '2026-W42', metrics: { people: { value: 96, percentile: 44 } } },
      { label: 'siteread.dev', week: null, metrics: {} },
    ],
  });

  it('names them in one sentence, each with its note', () => {
    expect(namedSentence(['synacl.com', 'siteread.dev'])).toBe(
      "2 sites are named, by their owner's choice: synacl.com (the site siteread was first built to read) and siteread.dev (this site, read by siteread itself).");
    expect(namedSentence(['a.example', 'b.example', 'c.example'])).toBe("3 sites are named, by their owner's choice: a.example, b.example and c.example.");
  });

  it('gives each its own cell and marker, and a site with no share yet says so', () => {
    const v = benchmarkView(two);
    expect(v.namedLabels).toBe('synacl.com and siteread.dev');
    expect(v.groups[0].rows[0].named).toEqual([
      { label: 'synacl.com', text: '96 · 44th', marker: 19.2 },
      { label: 'siteread.dev', text: null, marker: null },
    ]);
  });

  it('stretches the strip past the largest named value', () => {
    const r = rowView({ key: 'people', label: 'People', about: '' }, metric(14, [41, 118, 356]), 10, [
      { label: 'a', week: 'w', metrics: { people: { value: 96 } } },
      { label: 'b', week: 'w', metrics: { people: { value: 900 } } },
    ]);
    expect(r.hiText).toBe('1,200');
    expect(r.named.map(c => c.marker)).toEqual([8, 75]);
  });
});

describe('spotlight', () => {
  // synacl.com's week 2026-W44 as the service published it.
  const synacl = {
    label: 'synacl.com', week: '2026-W44', metrics: {
      people: { value: 223 }, peopleFromSearch: { value: 41 }, peopleFromAi: { value: 14 }, peopleFromSocial: { value: 4 },
      aiAnswerFetches: { value: 36 }, aiSearchFetches: { value: 184 }, aiTrainingFetches: { value: 155 },
      searchEngineFetches: { value: 237 }, aiSpoofedPct: { value: 13.3 },
      gscImpressions: { value: 1228 }, gscClicks: { value: 38 }, gscCtrPct: { value: 3.1 }, gscPosition: { value: 7.5 },
    },
  };

  it('headline figures, the people split with the rest as direct and other, and the AI split', () => {
    const s = spotlight(synacl, '2026-W46')!;
    expect(s.stale).toBe(true);
    expect(s.about).toBe('the site siteread was first built to read');
    expect(s.tiles.map(t => `${t.label} ${t.value}`)).toEqual(
      ['People 223', 'AI agent fetches 375', 'Search clicks 38', 'Spoofed AI traffic 13.3 %']);
    expect(s.people!.segments.map(g => [g.key, g.value, g.pct])).toEqual(
      [['search', 41, 18], ['ai', 14, 6], ['social', 4, 2], ['other', 164, 74]]);
    expect(s.ai!.segments.map(g => [g.key, g.value, g.pct])).toEqual(
      [['answer', 36, 10], ['search', 184, 49], ['training', 155, 41]]);
    expect(s.people!.label).toContain('Search 41 (18 %)');
  });

  it('leaves out empty parts and bars, and uses crawler fetches when there is no Search Console', () => {
    const s = spotlight({ label: 'siteread.dev', week: '2026-W46', metrics: {
      people: { value: 14 }, peopleFromSearch: { value: 0 }, peopleFromAi: { value: 0 }, peopleFromSocial: { value: 0 },
      aiAnswerFetches: { value: 0 }, aiSearchFetches: { value: 0 }, aiTrainingFetches: { value: 2 },
      searchEngineFetches: { value: 15 }, aiSpoofedPct: { value: 0.5 },
    } }, '2026-W46')!;
    expect(s.stale).toBe(false);
    expect(s.tiles.map(t => t.label)).toContain('Search crawler fetches');
    expect(s.people!.segments.map(g => g.key)).toEqual(['other']);
    expect(s.ai!.segments.map(g => g.key)).toEqual(['training']);
    expect(spotlight({ label: 'x', week: '2026-W46', metrics: {} }, null)).toEqual(
      { label: 'x', about: '', week: '2026-W46', stale: false, tiles: [], people: null, ai: null, crawl: null, search: null, spoofedPct: null });
  });

  it('who crawled more, and the search funnel from impressions to clicks', () => {
    const s = spotlight(synacl, '2026-W46')!;
    expect(s.crawl!.segments.map(g => [g.key, g.value, g.pct])).toEqual([['ai', 375, 61], ['engines', 237, 39]]);
    expect(s.search).toEqual({
      impressions: '1,228', clicks: '38', clickPct: 3.1, ctr: '3.1 %', position: '7.5',
      label: "synacl.com's search: 1,228 impressions, 38 clicks, 3.1 % click-through, average position 7.5",
    });
    expect(s.spoofedPct).toBe(13.3);
  });

  it('ratios per named site, worked out from its own numbers', () => {
    const b = sample({ named: [synacl, { label: 'quiet.dev', week: null, metrics: {} }] });
    const r = Object.fromEntries(ratios(b).map(x => [x.key, x.rows.map(y => y.text)]));
    expect(r).toEqual({
      fromSearch: ['18.4 %'], fromAi: ['6.3 %'], aiPerPerson: ['1.7 ×'], aiVsSearch: ['1.6 ×'],
      answerShare: ['9.6 %'], spoofed: ['13.3 %'], ctr: ['3.1 %'],
    });
    expect(ratios(sample({ named: [] }))).toEqual([]);
  });

  it('headline counts sum the named sites’ latest weeks', () => {
    const k = kpis(sample({ sites: 0, named: [synacl, { label: 'small.dev', week: '2026-W46', metrics: { people: { value: 14 }, aiTrainingFetches: { value: 2 } } }] }));
    expect(k.map(x => `${x.value} ${x.label}`)).toEqual([
      '0 / 10 anonymous sites toward the first spread', '2 named sites sharing',
      '237 people, the named sites’ latest weeks', '377 verified AI agent fetches, same weeks', '2 weeks on record',
    ]);
  });

  it('early rows compare the named sites on one bar scale; a percentage stays out of 100', () => {
    const two: NamedRow[] = [
      { label: 'a', week: 'w', metrics: { people: { value: 50 }, aiSpoofedPct: { value: 13.3 } } },
      { label: 'b', week: 'w', metrics: { people: { value: 200 } } },
    ];
    expect(rowView({ key: 'people', label: '', about: '' }, metric(2), 10, two).bars).toEqual(
      [{ label: 'a', text: '50', pct: 25 }, { label: 'b', text: '200', pct: 100 }]);
    expect(rowView({ key: 'aiSpoofedPct', label: '', about: '', unit: '%' }, metric(2), 10, two).bars).toEqual(
      [{ label: 'a', text: '13.3 %', pct: 13.3 }]);
  });

  it('a site that has not shared has no spotlight; the busiest site leads', () => {
    expect(spotlight({ label: 'x', week: null, metrics: {} }, '2026-W46')).toBeNull();
    const order = spotlights(sample({ named: [
      { label: 'small.dev', week: '2026-W42', metrics: { people: { value: 5 } } },
      synacl,
      { label: 'quiet.dev', week: null, metrics: {} },
    ] })).map(s => s.label);
    expect(order).toEqual(['synacl.com', 'small.dev']);
  });

  it('the meter fills to the share of minSites, never past it', () => {
    expect(benchmarkView(sample({ sites: 3 })).progressPct).toBe(30);
    expect(benchmarkView(sample()).progressPct).toBe(100);
  });
});
