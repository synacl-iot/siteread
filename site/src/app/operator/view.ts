import { OperatorStatus } from '../api';
import { fmt, utcMinute } from '../benchmark/view';

// /v1/operator/status → what the operator page prints. Counts only, like the status itself.

const DAY_HOURS = 24;

// The refusal codes (SHARE_REFUSALS in packages/verify/src/share.js, plus the endpoint's own
// `operator-denied` and `internal`) folded into the columns an operator acts on. A code this list
// does not know lands in "Other", so a new one is counted, never lost.
export const REFUSAL_COLUMNS: readonly { title: string; codes: readonly string[] }[] = [
  { title: 'Unknown field', codes: ['unknown-field', 'unknown-metric'] },
  { title: 'Bad value', codes: ['body', 'schema', 'id', 'version', 'metric-value', 'not-json'] },
  { title: 'Week', codes: ['week', 'future-week', 'old-week'] },
  { title: 'Too large / type', codes: ['too-large', 'content-type'] },
  // 'new-site-cap' is the refusal the proof of work replaced; days counted before still show here.
  { title: 'No proof', codes: ['proof', 'new-site-cap'] },
  { title: 'Token denied', codes: ['operator-denied'] },
  { title: 'Server error', codes: ['internal'] },
];
const KNOWN = new Set(REFUSAL_COLUMNS.flatMap(c => c.codes));

// API requests by route and kind of client (as the hosted service classifies them), as the operator reads them.
// Page views of /benchmark are its fetches by browsers. Days before the site ran in the browser
// counted them as `local`, the site's own server rendering the page, so both count as views.
export const USAGE_COLUMNS: readonly string[] = [
  'Feed, by siteread', 'Feed, other', 'Benchmark, page views', 'Benchmark, other', 'Health', 'Other paths',
];

type Hits = Record<string, Record<string, number>>;

/** One day's requests, one number per USAGE_COLUMNS entry. */
export function usageCells(hits: Hits = {}): number[] {
  const all = (route: string) => sum(hits[route] ?? {});
  const one = (route: string, client: string) => hits[route]?.[client] ?? 0;
  const views = one('benchmark', 'browser') + one('benchmark', 'local');
  return [
    one('feed', 'siteread'), all('feed') - one('feed', 'siteread'),
    views, all('benchmark') - views,
    all('health'), all('other'),
  ];
}

export interface OperatorView {
  feedCard: { value: string; note: string; warn: boolean };
  benchCard: { value: string; note: string };
  newCard: { value: string; note: string };
  refusedCard: { value: string; note: string };
  feedTodayCard: { value: string; note: string };
  usage: { day: string; cells: number[] }[];
  usageColumns: readonly string[];
  /** siteread versions that called in the last 7 days, most calls first: '0.3.0 ×12 · 0.2.1 ×3'. */
  versions: string;
  lastRun: string;
  lists: { agent: string; prefixes: string; fetched: string; fresh: boolean; error: string }[];
  newSites: { day: string; sites: number; pct: number }[];
  newSitesLabel: string;
  weeks: { week: string; sites: number; pct: number }[];
  weeksLabel: string;
  columns: string[];
  days: { day: string; taken: number; cells: number[] }[];
  named: string;
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** Refusals of one day, one number per column (REFUSAL_COLUMNS, then Other). */
export function refusalCells(refused: Record<string, number>): number[] {
  const cells = REFUSAL_COLUMNS.map(c => c.codes.reduce((n, code) => n + (refused[code] ?? 0), 0));
  cells.push(Object.entries(refused).filter(([k]) => !KNOWN.has(k)).reduce((n, [, v]) => n + v, 0));
  return cells;
}

export function operatorView(s: OperatorStatus): OperatorView {
  const lists = s.feed?.lists ?? [];
  const stale = lists.filter(l => !(l.ageHours < DAY_HOURS));
  const run = s.lastFeedRun;
  const errors = run?.errors ?? {};
  const today = s.requests.at(-1);
  const refusedToday = today ? sum(today.refused) : 0;
  const todayCodes = today ? Object.entries(today.refused).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`) : [];
  const newTop = Math.max(1, ...s.newSites.map(d => d.sites));
  const weeks = (s.benchmark?.history ?? []).slice(-8);
  const weekTop = Math.max(1, ...weeks.map(w => w.sites));
  const b = s.benchmark;
  return {
    feedCard: lists.length
      ? {
          value: `${lists.length - stale.length} of ${lists.length} fresh`,
          note: stale.length ? `${stale.map(l => l.agent).join(', ')} kept from an older fetch` : 'every list fetched in the last 24 h',
          warn: stale.length > 0,
        }
      : { value: 'no feed yet', note: 'the feed job has not run', warn: true },
    benchCard: b
      ? { value: `${b.sites} ${b.sites === 1 ? 'site' : 'sites'}`, note: `built ${utcMinute(b.generatedAt)}${b.window ? ` · ${b.window.from} to ${b.window.to}` : ''}` }
      : { value: 'not built', note: 'the aggregate job has not run' },
    newCard: {
      value: String(s.newSitesToday.sites),
      note: `a new site's proof costs ${s.newSitesToday.proofBits} bits now; one more per 50 new sites, back to base at 00:00 UTC`,
    },
    refusedCard: { value: String(refusedToday), note: todayCodes.length ? todayCodes.join(', ') : 'none today' },
    feedTodayCard: (() => {
      const f = today?.hits?.['feed'] ?? {};
      const n = sum(f);
      return { value: `${n} ${n === 1 ? 'fetch' : 'fetches'}`, note: `${f['siteread'] ?? 0} by siteread; each install fetches at most once a day` };
    })(),
    usage: s.requests.slice(-7).reverse().map(d => ({ day: d.day, cells: usageCells(d.hits) })),
    usageColumns: USAGE_COLUMNS,
    versions: (() => {
      const by = new Map<string, number>();
      for (const d of s.requests.slice(-7)) for (const [ver, n] of Object.entries(d.versions ?? {})) by.set(ver, (by.get(ver) ?? 0) + n);
      const list = [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return list.length ? list.map(([ver, n]) => `${ver} ×${n}`).join(' · ') : 'none yet';
    })(),
    lastRun: !run
      ? 'the feed job has not run'
      : run.error
        ? `last run ${utcMinute(run.at)} failed: ${run.error}`
        : `last run ${utcMinute(run.at)} · fetched ${run.fetched?.length ?? 0}, failed ${run.failed?.length ?? 0}`,
    lists: lists.map(l => ({
      agent: l.agent,
      prefixes: fmt(l.prefixes),
      fetched: utcMinute(l.fetchedAt),
      fresh: l.ageHours < DAY_HOURS,
      error: errors[l.agent] ?? '',
    })),
    newSites: s.newSites.map(d => ({ day: d.day, sites: d.sites, pct: Math.round((d.sites / newTop) * 100) })),
    newSitesLabel: `New sites per day, ${s.newSites[0]?.day ?? ''} to ${s.newSites.at(-1)?.day ?? ''}: ${s.newSites.map(d => d.sites).join(', ')}`,
    weeks: weeks.map(w => ({ week: w.week, sites: w.sites, pct: Math.round((w.sites / weekTop) * 100) })),
    weeksLabel: weeks.length ? `Sites per week: ${weeks.map(w => `${w.sites} in ${w.week}`).join(', ')}` : 'No week has a share yet',
    columns: [...REFUSAL_COLUMNS.map(c => c.title), 'Other'],
    days: s.requests.slice(-7).reverse().map(d => ({ day: d.day, taken: d.taken, cells: refusalCells(d.refused) })),
    named: b?.named.length ? b.named.map(n => `${n.label}: ${n.week ?? 'no share in the window'}`).join(' · ') : 'no named site',
  };
}
