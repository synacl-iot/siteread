import { InjectionToken } from '@angular/core';

// The service's public address, set at build time (angular.json `define`: production
// https://api.siteread.dev, development http://127.0.0.1:8787). The site runs only in the
// browser, so this is the only address it uses.
declare const SITEREAD_API: string | undefined;
export const PUBLIC_API = typeof SITEREAD_API === 'string' ? SITEREAD_API : 'https://api.siteread.dev';

export const API_BASE = new InjectionToken<string>('API_BASE', { factory: () => PUBLIC_API });

/** GET /v1/benchmark.json (the hosted service's benchmark aggregate). */
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

/** GET /v1/account and the other /v1/account routes: the signed-in account. Never its email. */
export interface AccountView {
  plan: string;
  createdOn: string;
  verifiedOn: string | null;
  /** The live key's first 8 characters and an ellipsis, or null when there is none. */
  key: string | null;
  /** Linked share ids. */
  sites: string[];
}
