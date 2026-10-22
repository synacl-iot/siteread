import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, input } from '@angular/core';
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

/** The numbers, fetched by the browser before the page renders, so it never shows half a table. */
export const benchmarkResolver: ResolveFn<BenchmarkLoad> = () =>
  inject(HttpClient).get<unknown>(`${inject(API_BASE)}/v1/benchmark.json`).pipe(
    timeout(3000),
    map(data => {
      if (!looksLikeBenchmark(data)) throw new Error('not a benchmark');
      return { ok: true as const, data };
    }),
    catchError(() => of({ ok: false as const })),
  );

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
