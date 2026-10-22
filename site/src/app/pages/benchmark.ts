import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input, RESPONSE_INIT } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ResolveFn, RouterLink } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';
import { API_BASE, Benchmark, PUBLIC_API } from '../api';
import { benchmarkView } from '../benchmark/view';
import { CopyButton } from '../copy-button';

export type BenchmarkLoad = { ok: true; data: Benchmark } | { ok: false };

const looksLikeBenchmark = (b: unknown): b is Benchmark => {
  const x = b as Benchmark | null;
  return Boolean(x && typeof x.metrics === 'object' && x.metrics && Array.isArray(x.named) && Array.isArray(x.history)
    && typeof x.sites === 'number' && typeof x.minSites === 'number' && typeof x.generatedAt === 'string');
};

/**
 * The numbers, fetched before the page renders so they are in the HTML: crawlers and AI agents
 * read it without running JavaScript. On the server this is the internal address, and the
 * browser reuses the answer through the transfer cache instead of fetching again.
 */
export const benchmarkResolver: ResolveFn<BenchmarkLoad> = () => {
  const response = inject(RESPONSE_INIT, { optional: true });
  return inject(HttpClient).get<unknown>(`${inject(API_BASE)}/v1/benchmark.json`).pipe(
    timeout(3000),
    map(data => {
      if (!looksLikeBenchmark(data)) throw new Error('not a benchmark');
      return { ok: true as const, data };
    }),
    catchError(() => {
      // No crawler or cache may keep an empty benchmark: a 503 that says when to come back.
      if (response) {
        const headers = new Headers(response.headers);
        headers.set('retry-after', '600');
        headers.set('cache-control', 'no-store');
        response.status = 503;
        response.headers = headers;
      }
      return of({ ok: false as const });
    }),
  );
};

@Component({
  selector: 'app-benchmark',
  imports: [RouterLink, NgTemplateOutlet, CopyButton],
  templateUrl: './benchmark.html',
})
export class BenchmarkPage {
  /** From the route resolver (withComponentInputBinding). */
  readonly benchmark = input<BenchmarkLoad>();
  protected readonly view = computed(() => {
    const b = this.benchmark();
    return b?.ok ? benchmarkView(b.data) : null;
  });
  protected readonly json = `${PUBLIC_API}/v1/benchmark.json`;
  protected readonly commands = 'npx siteread share --dry-run\nnpx siteread share';
  // Copy only the dry run: pasting both lines would send right after printing.
  protected readonly dryRun = 'npx siteread share --dry-run';

  constructor() {
    inject(Meta).updateTag({
      name: 'description',
      content: 'How sites compare: anonymous weekly numbers from sites that chose to share, with the number of sites printed on every row.',
    });
  }
}
