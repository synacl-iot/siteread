import { Routes } from '@angular/router';
import { Home } from './pages/home';
import { BenchmarkPage, benchmarkResolver } from './pages/benchmark';
import { Docs } from './pages/docs';
import { Privacy } from './pages/privacy';
import { NotFound } from './pages/not-found';
import { Blog } from './pages/blog';
import { PostLaunch } from './pages/post-launch';
import { PostChatgptWeek } from './pages/post-chatgpt-week';
import { CHATGPT_WEEK, LAUNCH } from './pages/posts';

export const routes: Routes = [
  { path: '', component: Home, title: 'siteread: who read your site this week' },
  {
    path: 'benchmark', component: BenchmarkPage, title: 'How sites compare · siteread',
    resolve: { benchmark: benchmarkResolver },
  },
  { path: 'docs', component: Docs, title: 'Docs · siteread' },
  { path: 'privacy', component: Privacy, title: 'What siteread sends · siteread' },
  { path: 'blog', component: Blog, title: 'Blog · siteread' },
  { path: `blog/${LAUNCH.slug}`, component: PostLaunch, title: `${LAUNCH.title} · siteread` },
  { path: `blog/${CHATGPT_WEEK.slug}`, component: PostChatgptWeek, title: `${CHATGPT_WEEK.title} · siteread` },
  // Lazy: most visitors never need the account pages. Linked as Account in the header.
  { path: 'account', loadComponent: () => import('./pages/account').then(m => m.AccountPage), title: 'Your account · siteread' },
  { path: 'account/verify', loadComponent: () => import('./pages/account-verify').then(m => m.AccountVerify), title: 'Signing in · siteread' },
  { path: '**', component: NotFound, title: 'Not found · siteread' },
];
