import { Benchmark, BenchmarkMetric, NamedRow } from '../api';

// benchmark.json → what the page prints. Pure, so the server and the browser render the same
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
  };
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
  };
}
