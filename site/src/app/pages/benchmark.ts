import { isPlatformServer, NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, computed, inject, input, makeStateKey, PLATFORM_ID, signal, TransferState } from '@angular/core';
import { ResolveFn, RouterLink } from '@angular/router';
import { catchError, map, Observable, of, tap, timeout } from 'rxjs';
import { API_BASE, Benchmark, PUBLIC_API } from '../api';
import { benchmarkView } from '../benchmark/view';
import { SpotlightCard } from '../benchmark/spotlight';
import { CopyButton } from '../copy-button';
import { jsonLd, ORIGIN, pageMeta } from '../seo';

/** `snapshot`: the numbers the build put in the page's HTML, not fetched by this browser. */
export type BenchmarkLoad = ({ ok: true; data: Benchmark } | { ok: false }) & { snapshot?: true };

const looksLikeBenchmark = (b: unknown): b is Benchmark => {
  const x = b as Benchmark | null;
  return Boolean(x && typeof x.metrics === 'object' && x.metrics && Array.isArray(x.named) && Array.isArray(x.history)
    && typeof x.sites === 'number' && typeof x.minSites === 'number' && typeof x.generatedAt === 'string');
};

export function fetchBenchmark(http: HttpClient, api: string, ms: number): Observable<BenchmarkLoad> {
  return http.get<unknown>(`${api}/v1/benchmark.json`).pipe(
    timeout(ms),
    map(data => {
      if (!looksLikeBenchmark(data)) throw new Error('not a benchmark');
      return { ok: true as const, data };
    }),
    catchError(() => of({ ok: false as const })),
  );
}

const SNAPSHOT = makeStateKey<BenchmarkLoad>('benchmark');

/**
 * The numbers, fetched before the page renders, so it never shows half a table.
 *
 * At build time (prerender) they go into the HTML, for crawlers and AI agents that run no
 * JavaScript, and into the page's transfer state. A service that does not answer gives the page
 * that says so, never a failed build. In the browser, the first view of a prerendered page starts
 * from that same snapshot, so hydration finds the HTML it expects; the page then fetches the live
 * numbers over it. A later visit within the app fetches live straight away.
 */
export const benchmarkResolver: ResolveFn<BenchmarkLoad> = () => {
  const http = inject(HttpClient);
  const api = inject(API_BASE);
  const state = inject(TransferState);
  if (isPlatformServer(inject(PLATFORM_ID))) {
    return fetchBenchmark(http, api, 10_000).pipe(tap(load => state.set(SNAPSHOT, load)));
  }
  const snapshot = state.get(SNAPSHOT, null);
  if (snapshot) {
    state.remove(SNAPSHOT);
    return of({ ...snapshot, snapshot: true as const });
  }
  return fetchBenchmark(http, api, 3000);
};

@Component({
  selector: 'app-benchmark',
  imports: [RouterLink, NgTemplateOutlet, CopyButton, SpotlightCard],
  templateUrl: './benchmark.html',
})
export class BenchmarkPage {
  /** From the route resolver (withComponentInputBinding). */
  readonly benchmark = input<BenchmarkLoad>();
  /** The live numbers, fetched in the browser over a build-time snapshot. */
  private readonly live = signal<Benchmark | null>(null);
  protected readonly view = computed(() => {
    const live = this.live();
    if (live) return benchmarkView(live);
    const b = this.benchmark();
    return b?.ok ? benchmarkView(b.data) : null;
  });
  protected readonly json = `${PUBLIC_API}/v1/benchmark.json`;
  /** The meter's marks, one per site still to come: 1 … minSites − 1. */
  protected readonly ticks = (n: number) => Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1);
  protected readonly commands = 'npx siteread share --dry-run\nnpx siteread share';
  // Copy only the dry run: pasting both lines would send right after printing.
  protected readonly dryRun = 'npx siteread share --dry-run';

  constructor() {
    const http = inject(HttpClient);
    const api = inject(API_BASE);
    // Browser only, once the prerendered page is hydrated. If the service does not answer, the
    // snapshot stays, with its "built" time saying how old it is.
    afterNextRender(() => {
      if (!this.benchmark()?.snapshot) return;
      fetchBenchmark(http, api, 3000).subscribe(load => {
        if (load.ok) this.live.set(load.data);
      });
    });
    const description = 'How sites compare. Sites share anonymous weekly numbers. Every row shows how many sites it is based on. The numbers cover people by source, verified AI agents and search.';
    pageMeta({ title: 'How sites compare · siteread', description, path: '/benchmark' });
    jsonLd('dataset', {
      '@type': 'Dataset',
      name: 'siteread benchmark: how small sites compare, week by week',
      description: description + ' Quartiles appear once enough anonymous sites report a number. Named sites show their own values.',
      url: `${ORIGIN}/benchmark`,
      isAccessibleForFree: true,
      creator: { '@type': 'Organization', name: 'siteread', url: ORIGIN },
      variableMeasured: ['People', 'People from search', 'People from AI assistants', 'AI agent fetches', 'Spoofed AI traffic', 'Search Console clicks and impressions'],
      distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: this.json }],
    });
  }
}
