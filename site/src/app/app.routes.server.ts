import { RenderMode, ServerRoute } from '@angular/ssr';

// The build writes each prerendered page as its own static file (outputMode "static"); no server
// renders anything at request time. Why each mode:
// - Home, docs, privacy and the benchmark are prerendered so crawlers and AI agents that run no
//   JavaScript read the text, which is this product's own subject. The benchmark's numbers are a
//   snapshot taken at build time, stamped "built <time>"; the browser fetches the live numbers
//   over it once the page is running (pages/benchmark.ts).
// - The account pages need a session only the browser holds, and anything else is the not-found
//   page: both come from the plain shell, index.csr.html.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'benchmark', renderMode: RenderMode.Prerender },
  { path: 'docs', renderMode: RenderMode.Prerender },
  { path: 'privacy', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client },
];
