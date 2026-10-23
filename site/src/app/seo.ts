import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';

export const ORIGIN = 'https://siteread.dev';

export interface PageMeta {
  title: string;
  description: string;
  /** The page's path, from the root: `/blog`. */
  path: string;
  type?: 'website' | 'article';
  /** For an article: `YYYY-MM-DD`. */
  published?: string;
}

/**
 * The description, canonical link and Open Graph tags for one page. Call it from a component's
 * constructor. The prerender writes them into the page's HTML, which is what search engines and
 * link previews read; in the browser they are taken out again when the page is left, so a later
 * page in the app never carries this one's canonical or preview.
 */
export function pageMeta(m: PageMeta): void {
  const meta = inject(Meta);
  const doc = inject(DOCUMENT);
  const url = ORIGIN + m.path;
  const og: Record<string, string> = {
    'og:type': m.type ?? 'website',
    'og:site_name': 'siteread',
    'og:title': m.title,
    'og:description': m.description,
    'og:url': url,
  };
  if (m.published) og['article:published_time'] = m.published;

  meta.updateTag({ name: 'description', content: m.description });
  for (const [property, content] of Object.entries(og)) meta.updateTag({ property, content });
  meta.updateTag({ name: 'twitter:card', content: 'summary' });

  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'canonical';
    doc.head.appendChild(link);
  }
  link.href = url;

  inject(DestroyRef).onDestroy(() => {
    for (const property of Object.keys(og)) meta.removeTag(`property="${property}"`);
    meta.removeTag('name="twitter:card"');
    link.remove();
  });
}
