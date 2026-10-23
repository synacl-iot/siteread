import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { DOCS } from './generated/docs';

@Component({ template: '' })
class Blank {}

describe('App', () => {
  async function at(url: string) {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([{ path: '**', component: Blank }]), provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('has the public header and footer on public pages', async () => {
    const el = await at('/benchmark');
    expect([...el.querySelectorAll('.site-nav a')].map(a => a.textContent)).toEqual(['Benchmark', 'Docs', 'Blog', 'Privacy', 'Account', 'npm']);
    expect(el.querySelector('.site-footer')!.textContent).toContain('MIT licensed');
  });

});

describe('the generated docs', () => {
  it('holds every section, with no link into the private repo', () => {
    expect(DOCS.map(d => d.id)).toEqual(['install', 'cli', 'digest', 'seo-read', 'share', 'library', 'vendor-lists', 'feed', 'why']);
    for (const d of DOCS) {
      expect(d.html.length).toBeGreaterThan(100);
      for (const [, href] of d.html.matchAll(/href="([^"]*)"/g)) expect(href).toMatch(/^(https:\/\/|docs#)/);
    }
  });

  it('turns a repo-relative link into this page’s anchor, or the file on GitHub', async () => {
    const { render } = await import('../../scripts/docs.mjs' as string);
    const html = render('[the skill](../../plugins/siteread/README.md), [the charter](../../CHARTER.md), [x](#install), [out](../../../etc)', 'feed', 'packages/verify/README.md');
    expect(html).toContain('href="docs#seo-read"');
    expect(html).toContain('href="https://github.com/synacl-iot/siteread/blob/main/CHARTER.md"');
    expect(html).toContain('href="docs#install"');
    expect(html).toContain('out');
    expect(html).not.toContain('etc"');   // a path out of the repo stays plain text
    for (const d of DOCS) {
      expect(d.html).not.toContain('href=""');
    }
  });
});
