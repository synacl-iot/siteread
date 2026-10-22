import { Routes } from '@angular/router';
import { Home } from './pages/home';
import { BenchmarkPage, benchmarkResolver } from './pages/benchmark';
import { Docs } from './pages/docs';
import { Privacy } from './pages/privacy';
import { NotFound } from './pages/not-found';

export const routes: Routes = [
  { path: '', component: Home, title: 'siteread: who read your site this week' },
  {
    path: 'benchmark', component: BenchmarkPage, title: 'How sites compare · siteread',
    resolve: { benchmark: benchmarkResolver },
  },
  { path: 'docs', component: Docs, title: 'Docs · siteread' },
  { path: 'privacy', component: Privacy, title: 'What siteread sends · siteread' },
  // Lazy: the operator page is the one bundle a visitor never needs.
  { path: 'operator', loadComponent: () => import('./pages/operator').then(m => m.Operator), title: 'Operator · siteread' },
  { path: '**', component: NotFound, title: 'Not found · siteread' },
];
