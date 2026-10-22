import { RenderMode, ServerRoute } from '@angular/ssr';

// Why each mode:
// - Home, docs and privacy change only with a release, so they are built once into static HTML.
// - The benchmark is rendered per request with the current numbers in the HTML: crawlers and AI
//   agents read it without running JavaScript, which is this product's own subject. Caches may
//   keep it 5 minutes and serve it stale while refetching for the rest of the aggregate's hour.
//   When the service is down the resolver turns this into a 503 with no-store (pages/benchmark.ts).
// - The operator page needs a token only the browser holds, so the server sends the empty shell.
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender, headers: { 'cache-control': 'public, max-age=600' } },
  { path: 'docs', renderMode: RenderMode.Prerender, headers: { 'cache-control': 'public, max-age=600' } },
  { path: 'privacy', renderMode: RenderMode.Prerender, headers: { 'cache-control': 'public, max-age=600' } },
  {
    path: 'benchmark', renderMode: RenderMode.Server,
    headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=3300' },
  },
  {
    path: 'operator', renderMode: RenderMode.Client,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  },
  { path: '**', renderMode: RenderMode.Server, status: 404, headers: { 'cache-control': 'public, max-age=60' } },
];
