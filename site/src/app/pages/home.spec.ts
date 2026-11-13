import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { sample } from '../benchmark/view.spec';
import { BenchmarkLoad } from './benchmark';
import { FAQ, Home } from './home';

async function render(load?: BenchmarkLoad) {
  TestBed.configureTestingModule({
    imports: [Home],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(Home);
  if (load) fixture.componentRef.setInput('benchmark', load);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('Home', () => {
  it('shows the busiest named site’s real week when the benchmark answered', async () => {
    const el = await render({ ok: true, data: sample({ named: [
      { label: 'siteread.dev', week: '2026-W42', metrics: { people: { value: 14 } } },
      { label: 'synacl.com', week: '2026-W42', metrics: { people: { value: 223 } } },
    ] }) });
    expect(text(el.querySelector('#real-week')!)).toBe('A real week from a named site');
    expect(text(el.querySelector('app-spotlight .spot-name')!)).toBe('synacl.com');
  });

  it('makes the case under the hero, with live numbers when the benchmark answered', async () => {
    const el = await render({ ok: true, data: sample({ sites: 3, named: [
      { label: 'synacl.com', week: '2026-W42', metrics: { people: { value: 223 }, aiSearchFetches: { value: 184 } } },
    ] }) });
    const items = [...el.querySelectorAll('.moat-item')].map(text);
    expect(items.length).toBe(4);
    expect(items[0]).toContain('13 vendor IP lists');
    expect(items[1]).toContain('synacl.com logged 184 verified AI agent fetches');
    expect(items[3]).toContain('4 sites sharing');
    expect(el.textContent).not.toMatch(/\b(only|first) (tool|one)\b/i);
  });

  it('the case still stands without the service', async () => {
    const el = await render({ ok: false });
    const items = [...el.querySelectorAll('.moat-item')].map(text);
    expect(items.length).toBe(4);
    expect(items[3]).toContain('free public data An open benchmark Sites share');
  });

  it('leaves the real week out when the service did not answer', async () => {
    const el = await render({ ok: false });
    expect(el.querySelector('#real-week')).toBeNull();
    expect(el.querySelectorAll('.logline').length).toBe(5);
  });

  it('every log line uses an address the panel can stand behind: documentation ranges or a vendor’s own', async () => {
    const el = await render();
    const ips = [...el.querySelectorAll('.logline .ip')].map(e => text(e));
    for (const ip of ips) expect(ip).toMatch(/^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|66\.249\.66\.|160\.79\.10[4-7]\.)/);
  });

  it('writes the FAQ into the page and into FAQPage data, word for word, with a canonical link', async () => {
    const el = await render();
    expect([...el.querySelectorAll('.faq summary')].map(e => text(e))).toEqual(FAQ.map(f => f.q));
    const ld = JSON.parse(document.head.querySelector('script[data-ld="faq"]')!.textContent!);
    expect(ld.mainEntity.map((q: { name: string }) => q.name)).toEqual(FAQ.map(f => f.q));
    expect(document.head.querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe('https://siteread.dev/');
  });
});
