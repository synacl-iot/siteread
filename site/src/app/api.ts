import { InjectionToken } from '@angular/core';

// The service's public address, set at build time (angular.json `define`: production
// https://api.siteread.dev, development http://127.0.0.1:8787). The SSR server swaps in its own
// internal address (app.config.server.ts); the browser always uses this one.
declare const SITEREAD_API: string | undefined;
export const PUBLIC_API = typeof SITEREAD_API === 'string' ? SITEREAD_API : 'https://api.siteread.dev';

export const API_BASE = new InjectionToken<string>('API_BASE', { factory: () => PUBLIC_API });

/** GET /v1/benchmark.json (cloud/src/benchmark.js `aggregate`). */
export interface Benchmark {
  siteread: string;
  generatedAt: string;
  window: { from: string; to: string } | null;
  /** Anonymous sites in the window; named sites are not counted here. */
  sites: number;
  minSites: number;
  metrics: Record<string, BenchmarkMetric>;
  named: NamedRow[];
  history: { week: string; sites: number }[];
}

export interface BenchmarkMetric {
  about: string;
  lowerIsBetter: boolean;
  /** Anonymous sites that report this metric. The quartiles exist only from `minSites`. */
  sites: number;
  p25?: number;
  p50?: number;
  p75?: number;
}

export interface NamedRow {
  label: string;
  /** null: the site has not shared in the window. */
  week: string | null;
  metrics: Record<string, { value: number; percentile?: number }>;
}

/** GET /v1/operator/status (cloud/src/app.js `operatorStatus`). Counts only. */
export interface OperatorStatus {
  ok: true;
  siteread: string;
  now: string;
  feed: { generatedAt: string; lists: { agent: string; prefixes: number; fetchedAt: string; ageHours: number }[] } | null;
  lastFeedRun:
    | { at: string; fetched?: string[]; failed?: string[]; dropped?: string[]; errors?: Record<string, string>; error?: string }
    | null;
  benchmark: {
    generatedAt: string;
    sites: number;
    window: { from: string; to: string } | null;
    history: { week: string; sites: number }[];
    named: { label: string; week: string | null }[];
  } | null;
  newSites: { day: string; sites: number }[];
  newSitesToday: { sites: number; max: number };
  requests: { day: string; taken: number; refused: Record<string, number> }[];
}
