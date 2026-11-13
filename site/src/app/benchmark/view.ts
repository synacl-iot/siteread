import { Benchmark, BenchmarkMetric, NamedRow } from '../api';

// benchmark.json → what the page prints. Pure, so every reader gets the same
// text: a fixed en-US number format and UTC times, never the reader's locale or zone.

export interface MetricSpec {
  key: string;
  label: string;
  about: string;
  unit?: '%';
}

export interface GroupSpec {
  title: string;
  note: string;
  rows: MetricSpec[];
}

// How the page names and groups SHARE_METRICS (packages/verify/src/share.js). The service's own
// `about` is the precise definition; these are the short labels a reader scans. A metric the
// service has and this list does not still shows, under "More", in the service's words.
export const GROUPS: readonly GroupSpec[] = [
  {
    title: 'People', note: 'from access logs', rows: [
      { key: 'people', label: 'People', about: 'browsers that loaded a page and its assets, never a scanner path' },
      { key: 'peopleFromSearch', label: 'From search', about: 'first visit came from a search engine' },
      { key: 'peopleFromAi', label: 'From AI assistants', about: 'first visit came from ChatGPT, Perplexity, Claude and others' },
      { key: 'peopleFromSocial', label: 'From social', about: 'first visit came from a social site or forum' },
    ],
  },
  {
    title: 'AI agents', note: 'verified against each vendor’s published IP list', rows: [
      { key: 'aiAnswerFetches', label: 'Reading for a person', about: 'ChatGPT-User, Perplexity-User, Claude-User page fetches' },
      { key: 'aiSearchFetches', label: 'Search indexing', about: 'OAI-SearchBot, PerplexityBot, Claude-SearchBot, Applebot' },
      { key: 'aiTrainingFetches', label: 'Training crawls', about: 'GPTBot, ClaudeBot' },
      { key: 'aiSpoofedPct', label: 'Spoofed AI traffic', about: 'requests under an AI user-agent from outside the vendor’s list, whole log', unit: '%' },
    ],
  },
  {
    title: 'Search', note: 'Search Console and verified search crawlers', rows: [
      { key: 'searchEngineFetches', label: 'Search crawler fetches', about: 'Googlebot and bingbot page fetches, verified' },
      { key: 'gscImpressions', label: 'Impressions', about: 'Search Console, the same 7 days' },
      { key: 'gscClicks', label: 'Clicks', about: 'Search Console, the same 7 days' },
      { key: 'gscCtrPct', label: 'Click-through rate', about: 'Search Console', unit: '%' },
      { key: 'gscPosition', label: 'Position', about: 'impression-weighted; lower is better' },
    ],
  },
];

// How the page introduces each named site; a label not listed here is named without a note.
export const NAMED_ABOUT: Readonly<Record<string, string>> = {
  'synacl.com': 'the site siteread was first built to read',
  'siteread.dev': 'this site, read by siteread itself',
};

export interface NamedCell {
  label: string;
  /** '96 · 44th'; null when that site did not report this number. */
  text: string | null;
  /** Its strip position in %, or null. */
  marker: number | null;
}

export interface RowView {
  key: string;
  label: string;
  about: string;
  shown: boolean;
  /** '41 · 118 · 356': the 25th, 50th and 75th percentile. Empty when hidden. */
  quartiles: string;
  /** '9 of 10 anonymous sites'. Empty when shown. */
  waiting: string;
  /** Each named site's value and, from the same threshold, its rank, in the service's order. */
  named: NamedCell[];
  sitesText: string;
  hiText: string;
  /** Strip geometry in % of the scale; the strip itself is decoration, the cells carry the numbers. */
  box: { left: number; width: number } | null;
  median: number | null;
  /** The named sites side by side, each bar against the largest of them; only sites with a value. */
  bars: { label: string; text: string; pct: number }[];
}

export interface GroupView {
  title: string;
  note: string;
  rows: RowView[];
}

export interface BenchmarkView {
  sites: number;
  minSites: number;
  named: { label: string; week: string | null }[];
  /** One sentence naming them: '2 sites are named, by their owner's choice: …'. Empty with none. */
  namedText: string;
  /** 'synacl.com and siteread.dev', for the header line. */
  namedLabels: string;
  windowText: string;
  builtText: string;
  /** No metric has reached minSites yet: the page leads with the count. */
  early: boolean;
  groups: GroupView[];
  history: { label: string; week: string; sites: number; pct: number }[];
  historyLabel: string;
  /** Anonymous sites so far against minSites, as a % for the meter (capped at 100). */
  progressPct: number;
  /** The named sites' latest weeks, most people first. */
  spotlights: Spotlight[];
  /** Headline counts for the top of the page. */
  kpis: Kpi[];
  /** Ratios worked out from each named site's own numbers. */
  ratios: RatioView[];
}

export interface Kpi {
  value: string;
  label: string;
}

export interface RatioView {
  key: string;
  title: string;
  about: string;
  rows: { label: string; text: string; pct: number }[];
}

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const fmt = (n: number) => NUMBER.format(n);

const withUnit = (text: string, unit?: '%') => (unit ? `${text} ${unit}` : text);

/** 44 → '44th', 1 → '1st', 12 → '12th'. */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** The smallest round number ≥ v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ), for a strip's right end. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => s * exp >= v - 1e-9) ?? 10;
  return Number((step * exp).toPrecision(12));
}

/** '2026-10-22T09:00:12.345Z' → '2026-10-22 09:00 UTC'. */
export const utcMinute = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

const pct = (v: number, hi: number) => Math.round(Math.max(0, Math.min(100, (v / hi) * 100)) * 10) / 10;

export function rowView(spec: MetricSpec, m: BenchmarkMetric | undefined, minSites: number, named: readonly NamedRow[]): RowView {
  const sites = m?.sites ?? 0;
  const q = m && m.p25 != null && m.p50 != null && m.p75 != null ? [m.p25, m.p50, m.p75] : null;
  const own = named.map(n => n.metrics[spec.key]);
  // The strip's right end: past the 75th percentile and every named value, so none sits on the
  // edge. A percentage never runs past 100.
  let hi = niceCeil(Math.max(q?.[2] ?? 0, ...own.map(o => o?.value ?? 0)) * 1.25);
  if (spec.unit === '%') hi = Math.min(hi, 100);
  return {
    key: spec.key,
    label: spec.label,
    about: spec.about,
    shown: Boolean(q),
    quartiles: q ? q.map(v => withUnit(fmt(v), spec.unit)).join(' · ') : '',
    waiting: q ? '' : `${sites} of ${minSites} anonymous sites`,
    named: named.map((n, i) => {
      const o = own[i];
      return {
        label: n.label,
        text: o ? withUnit(fmt(o.value), spec.unit) + (o.percentile != null ? ` · ${ordinal(o.percentile)}` : '') : null,
        marker: o ? pct(o.value, hi) : null,
      };
    }),
    sitesText: q ? `${sites} sites` : `shown from ${minSites}`,
    hiText: withUnit(fmt(hi), spec.unit),
    box: q ? { left: pct(q[0], hi), width: Math.round((pct(q[2], hi) - pct(q[0], hi)) * 10) / 10 } : null,
    median: q ? pct(q[1], hi) : null,
    bars: compareBars(named, own, spec.unit),
  };
}

function compareBars(named: readonly NamedRow[], own: ({ value: number } | undefined)[], unit?: '%') {
  const top = Math.max(0, ...own.map(o => o?.value ?? 0));
  return named.flatMap((n, i) => {
    const o = own[i];
    if (!o) return [];
    // A percentage keeps its own scale: 13 % is a short bar even when it is the largest.
    const scale = unit === '%' ? 100 : top;
    return [{ label: n.label, text: withUnit(fmt(o.value), unit), pct: scale > 0 ? pct(o.value, scale) : 0 }];
  });
}

/** 'synacl.com (the site …) is the one named site.' or 'N sites are named, by their owner's choice: …'. */
export function namedSentence(labels: readonly string[]): string {
  const say = (l: string) => (NAMED_ABOUT[l] ? `${l} (${NAMED_ABOUT[l]})` : l);
  if (!labels.length) return '';
  if (labels.length === 1) return `${say(labels[0])} is the one named site, by its owner's choice.`;
  const list = labels.map(say);
  return `${labels.length} sites are named, by their owner's choice: ${list.slice(0, -1).join(', ')} and ${list.at(-1)}.`;
}

export function benchmarkView(b: Benchmark): BenchmarkView {
  const named = b.named;
  const known = new Set(GROUPS.flatMap(g => g.rows.map(r => r.key)));
  const extra: MetricSpec[] = Object.keys(b.metrics).filter(k => !known.has(k)).map(k => ({ key: k, label: k, about: b.metrics[k].about }));
  const specs = extra.length ? [...GROUPS, { title: 'More', note: 'newer metrics', rows: extra }] : GROUPS;
  const groups = specs
    .map(g => ({
      title: g.title,
      note: g.note,
      rows: g.rows.filter(r => Object.hasOwn(b.metrics, r.key)).map(r => rowView(r, b.metrics[r.key], b.minSites, named)),
    }))
    .filter(g => g.rows.length);
  const weeks = b.history.slice(-8);
  const top = Math.max(1, ...weeks.map(h => h.sites));
  return {
    sites: b.sites,
    minSites: b.minSites,
    named: named.map(n => ({ label: n.label, week: n.week })),
    namedText: namedSentence(named.map(n => n.label)),
    namedLabels: named.length > 1 ? `${named.slice(0, -1).map(n => n.label).join(', ')} and ${named.at(-1)!.label}` : (named[0]?.label ?? ''),
    windowText: b.window ? `each site's latest share, ${b.window.from} to ${b.window.to}` : 'no shares yet',
    builtText: `built ${utcMinute(b.generatedAt)}`,
    early: !Object.values(b.metrics).some(m => m.p50 != null),
    groups,
    history: weeks.map(h => ({ label: h.week.slice(5), week: h.week, sites: h.sites, pct: Math.round((h.sites / top) * 100) })),
    historyLabel: weeks.length
      ? `Sites that shared, per week: ${weeks.map(h => `${h.sites} in ${h.week}`).join(', ')}`
      : 'No week has a share yet',
    progressPct: Math.min(100, Math.round((b.sites / Math.max(1, b.minSites)) * 100)),
    spotlights: spotlights(b),
    kpis: kpis(b),
    ratios: ratios(b),
  };
}

const sharing = (b: Benchmark) => b.named.filter(n => n.week);
const val = (n: NamedRow, k: string) => n.metrics[k]?.value;
const AI_KEYS = ['aiAnswerFetches', 'aiSearchFetches', 'aiTrainingFetches'];
const aiOf = (n: NamedRow) => (AI_KEYS.some(k => typeof val(n, k) === 'number') ? AI_KEYS.reduce((s, k) => s + (val(n, k) ?? 0), 0) : undefined);

/** The page's headline counts. Sums run over the named sites' latest weeks and say so. */
export function kpis(b: Benchmark): Kpi[] {
  const named = sharing(b);
  const sum = (f: (n: NamedRow) => number | undefined) => named.reduce((s, n) => s + (f(n) ?? 0), 0);
  const out: Kpi[] = [
    { value: `${fmt(b.sites)} / ${fmt(b.minSites)}`, label: 'anonymous sites toward the first spread' },
    { value: fmt(named.length), label: named.length === 1 ? 'named site sharing' : 'named sites sharing' },
  ];
  if (named.length) {
    out.push({ value: fmt(sum(n => val(n, 'people'))), label: 'people, the named sites’ latest weeks' });
    out.push({ value: fmt(sum(aiOf)), label: 'verified AI agent fetches, same weeks' });
  }
  out.push({ value: fmt(b.history.length), label: b.history.length === 1 ? 'week on record' : 'weeks on record' });
  return out;
}

interface RatioSpec {
  key: string;
  title: string;
  about: string;
  /** '%': the bar is the value out of 100. 'x': the bar is against the largest site. */
  unit: '%' | 'x';
  of: (n: NamedRow) => number | undefined;
}

const share = (part: number | undefined, whole: number | undefined) =>
  part === undefined || !whole ? undefined : (part / whole) * 100;

const RATIOS: readonly RatioSpec[] = [
  { key: 'fromSearch', title: 'People from search', about: 'share of people whose first visit came from a search engine', unit: '%',
    of: n => share(val(n, 'peopleFromSearch'), val(n, 'people')) },
  { key: 'fromAi', title: 'People from AI assistants', about: 'share of people who first came from ChatGPT, Perplexity, Claude and others', unit: '%',
    of: n => share(val(n, 'peopleFromAi'), val(n, 'people')) },
  { key: 'aiPerPerson', title: 'AI fetches per person', about: 'verified AI agent page fetches for every person who read a page', unit: 'x',
    of: n => (val(n, 'people') ? (aiOf(n) ?? 0) / val(n, 'people')! : undefined) },
  { key: 'aiVsSearch', title: 'AI fetches per search-engine fetch', about: 'verified AI agent fetches against verified Googlebot and bingbot fetches; above 1 × AI agents crawled more', unit: 'x',
    of: n => (val(n, 'searchEngineFetches') ? (aiOf(n) ?? 0) / val(n, 'searchEngineFetches')! : undefined) },
  { key: 'answerShare', title: 'AI fetches made for a person', about: 'share of verified AI fetches that were an assistant reading for someone, not a crawl', unit: '%',
    of: n => share(val(n, 'aiAnswerFetches'), aiOf(n)) },
  { key: 'spoofed', title: 'Spoofed AI traffic', about: 'requests under an AI user-agent from outside the vendor’s list', unit: '%',
    of: n => val(n, 'aiSpoofedPct') },
  { key: 'ctr', title: 'Search click-through', about: 'Search Console clicks per impression', unit: '%',
    of: n => val(n, 'gscCtrPct') ?? share(val(n, 'gscClicks'), val(n, 'gscImpressions')) },
];

/** Each ratio, per named site that has the numbers for it; a ratio no site can give is left out. */
export function ratios(b: Benchmark): RatioView[] {
  const named = sharing(b);
  return RATIOS.map(r => {
    const vals = named.map(n => ({ label: n.label, v: r.of(n) })).filter((x): x is { label: string; v: number } => x.v !== undefined && Number.isFinite(x.v));
    const top = Math.max(0, ...vals.map(x => x.v));
    const rows = vals.map(x => ({
      label: x.label,
      text: r.unit === '%' ? `${fmt(x.v)} %` : `${fmt(x.v)} ×`,
      pct: r.unit === '%' ? pct(x.v, 100) : top > 0 ? pct(x.v, top) : 0,
    }));
    return { key: r.key, title: r.title, about: r.about, rows };
  }).filter(r => r.rows.length);
}

// ── Named-site spotlight ─────────────────────────────────────────────────────────────────────
// While the anonymous count is under minSites, every quartile is hidden and the named sites are
// the only real numbers on the page, so the page leads with them: a few headline figures and two
// bars, one for where people came from and one for what kind of AI fetch the site got.

/** One part of a segmented bar. `cls` picks its color: s1 teal, s2 orange, s3 violet, other gray. */
export interface Segment {
  key: string;
  label: string;
  value: number;
  /** Its share of the bar's whole, rounded to a whole %, for the label. */
  pct: number;
  cls: 's1' | 's2' | 's3' | 'other';
}

export interface Tile {
  label: string;
  value: string;
  note: string;
}

export interface Spotlight {
  label: string;
  about: string;
  week: string;
  /** The site's share is older than the newest week in the window. */
  stale: boolean;
  tiles: Tile[];
  /** null when the site reported no people. */
  people: { total: number; segments: Segment[]; label: string } | null;
  /** null when the site reported no AI agent fetches. */
  ai: { total: number; segments: Segment[]; label: string } | null;
  /** Verified AI agents against verified search engines; null without search-engine numbers. */
  crawl: { total: number; segments: Segment[]; label: string } | null;
  /** Search Console impressions down to clicks; null without both. */
  search: SearchFunnel | null;
  /** Spoofed share of AI user-agent requests, for the home page; null when not reported. */
  spoofedPct: number | null;
}

export interface SearchFunnel {
  impressions: string;
  clicks: string;
  /** Clicks as a % of impressions: the clicks bar's width against the impressions bar. */
  clickPct: number;
  ctr: string;
  position: string | null;
  label: string;
}

function segments(parts: { key: string; label: string; value: number; cls: Segment['cls'] }[], total: number): Segment[] {
  return parts
    .filter(p => p.value > 0)
    .map(p => ({ ...p, pct: Math.round((p.value / total) * 100) }));
}

const barLabel = (title: string, segs: Segment[]) =>
  `${title}: ${segs.map(s => `${s.label} ${fmt(s.value)} (${s.pct} %)`).join(', ')}`;

/** A named site's latest week, as the page's spotlight shows it. null when it has not shared. */
export function spotlight(n: NamedRow, windowTo: string | null): Spotlight | null {
  if (!n.week) return null;
  const v = (k: string) => n.metrics[k]?.value;
  const has = (k: string) => typeof v(k) === 'number';
  const tiles: Tile[] = [];
  if (has('people')) tiles.push({ label: 'People', value: fmt(v('people')!), note: 'real browsers, scanners left out' });
  const aiKeys = ['aiAnswerFetches', 'aiSearchFetches', 'aiTrainingFetches'];
  const aiTotal = aiKeys.reduce((s, k) => s + (v(k) ?? 0), 0);
  if (aiKeys.some(has)) tiles.push({ label: 'AI agent fetches', value: fmt(aiTotal), note: 'verified against vendor IP lists' });
  if (has('gscClicks')) tiles.push({ label: 'Search clicks', value: fmt(v('gscClicks')!), note: has('gscPosition') ? `average position ${fmt(v('gscPosition')!)}` : 'Search Console' });
  else if (has('searchEngineFetches')) tiles.push({ label: 'Search crawler fetches', value: fmt(v('searchEngineFetches')!), note: 'Googlebot and bingbot, verified' });
  if (has('aiSpoofedPct')) tiles.push({ label: 'Spoofed AI traffic', value: `${fmt(v('aiSpoofedPct')!)} %`, note: 'claimed an AI user-agent, came from elsewhere' });

  const people = v('people') ?? 0;
  let peopleBar: Spotlight['people'] = null;
  if (people > 0) {
    const search = v('peopleFromSearch') ?? 0;
    const ai = v('peopleFromAi') ?? 0;
    const social = v('peopleFromSocial') ?? 0;
    const segs = segments([
      { key: 'search', label: 'Search', value: search, cls: 's1' },
      { key: 'ai', label: 'AI assistants', value: ai, cls: 's2' },
      { key: 'social', label: 'Social', value: social, cls: 's3' },
      { key: 'other', label: 'Direct and other', value: Math.max(0, people - search - ai - social), cls: 'other' },
    ], people);
    peopleBar = { total: people, segments: segs, label: barLabel(`Where ${n.label}'s ${fmt(people)} people came from`, segs) };
  }

  let aiBar: Spotlight['ai'] = null;
  if (aiTotal > 0) {
    const segs = segments([
      { key: 'answer', label: 'Reading for a person', value: v('aiAnswerFetches') ?? 0, cls: 's2' },
      { key: 'search', label: 'Search indexing', value: v('aiSearchFetches') ?? 0, cls: 's1' },
      { key: 'training', label: 'Training crawls', value: v('aiTrainingFetches') ?? 0, cls: 's3' },
    ], aiTotal);
    aiBar = { total: aiTotal, segments: segs, label: barLabel(`${n.label}'s ${fmt(aiTotal)} AI agent fetches`, segs) };
  }

  // Who crawled more: verified AI agents or verified search engines, as one two-part bar.
  let crawl: Spotlight['crawl'] = null;
  const engines = v('searchEngineFetches') ?? 0;
  if (aiTotal + engines > 0 && has('searchEngineFetches')) {
    const segs = segments([
      { key: 'ai', label: 'AI agents', value: aiTotal, cls: 's2' },
      { key: 'engines', label: 'Googlebot and bingbot', value: engines, cls: 's1' },
    ], aiTotal + engines);
    crawl = { total: aiTotal + engines, segments: segs, label: barLabel(`Who crawled ${n.label} more`, segs) };
  }

  let search: SearchFunnel | null = null;
  const imp = v('gscImpressions');
  const clk = v('gscClicks');
  if (imp && typeof clk === 'number') {
    const ctrPct = v('gscCtrPct') ?? (clk / imp) * 100;
    const pos = has('gscPosition') ? fmt(v('gscPosition')!) : null;
    search = {
      impressions: fmt(imp),
      clicks: fmt(clk),
      clickPct: pct(clk, imp),
      ctr: `${fmt(ctrPct)} %`,
      position: pos,
      label: `${n.label}'s search: ${fmt(imp)} impressions, ${fmt(clk)} clicks, ${fmt(ctrPct)} % click-through${pos ? `, average position ${pos}` : ''}`,
    };
  }

  return {
    label: n.label,
    about: NAMED_ABOUT[n.label] ?? '',
    week: n.week,
    stale: windowTo != null && n.week < windowTo,
    tiles,
    people: peopleBar,
    ai: aiBar,
    crawl,
    search,
    spoofedPct: has('aiSpoofedPct') ? v('aiSpoofedPct')! : null,
  };
}

/** Every named site that has shared, the one with the most people first. */
export function spotlights(b: Benchmark): Spotlight[] {
  return b.named
    .map(n => spotlight(n, b.window?.to ?? null))
    .filter((s): s is Spotlight => s !== null)
    .sort((a, z) => (z.people?.total ?? 0) - (a.people?.total ?? 0));
}
