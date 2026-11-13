import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PUBLIC_API } from '../api';
import { sample } from '../benchmark/view.spec';
import { BenchmarkLoad, BenchmarkPage } from './benchmark';

async function render(load: BenchmarkLoad) {
  const fixture = await mount(load);
  return fixture.nativeElement as HTMLElement;
}

async function mount(load: BenchmarkLoad) {
  TestBed.configureTestingModule({
    imports: [BenchmarkPage],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(BenchmarkPage);
  fixture.componentRef.setInput('benchmark', load);
  await fixture.whenStable();
  return fixture;
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

describe('BenchmarkPage', () => {
  it('prints n, the quartiles and the named row in the HTML', async () => {
    const el = await render({ ok: true, data: sample() });
    expect(text(el.querySelector('.bench-meta')!)).toBe(
      "14 anonymous sites + synacl.com · each site's latest share, 2026-W39 to 2026-W42 · built 2026-10-22 09:00 UTC");
    const people = el.querySelector('.metrics tbody tr')!;
    expect(text(people)).toContain('41 · 118 · 356');
    expect(text(people)).toContain('synacl.com 96 · 44th');
    expect(text(people)).toContain('14 sites');
    expect(people.querySelector('.strip-cell')!.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.early')).toBeNull();
  });

  it('a hidden row shows the count, not a spread', async () => {
    const el = await render({ ok: true, data: sample() });
    const rows = [...el.querySelectorAll('.metrics tbody tr')];
    const clicks = rows.find(r => text(r).startsWith('Clicks'))!;
    expect(text(clicks)).toContain('9 of 10 anonymous sites');
    expect(clicks.querySelector('.box')).toBeNull();
    expect(clicks.querySelector('.marker')).not.toBeNull();
  });

  it('leads with the count while the benchmark is early', async () => {
    const el = await render({ ok: true, data: sample({ sites: 2, metrics: { people: { about: '', lowerIsBetter: false, sites: 2 } } }) });
    expect(text(el.querySelector('.early-num')!)).toBe('2 of 10');
    expect(text(el.querySelector('.early-count')!.lastElementChild!)).toBe('anonymous sites needed before any spread is shown');
    expect(el.querySelector('.strip-cell')).toBeNull();
    expect(el.querySelector('.metrics .sites')).toBeNull();
    expect(text(el.querySelector('.add h2')!)).toBe('Be one of the first 10');
  });

  it('says so when the service did not answer', async () => {
    const el = await render({ ok: false });
    expect(text(el.querySelector('.notice')!)).toContain('has not been built yet, or the service did not answer');
    expect(el.querySelector('.metrics')).toBeNull();
  });

  it('never prints an id', async () => {
    const el = await render({ ok: true, data: sample() });
    expect(el.innerHTML).not.toMatch(/\b[0-9a-f]{32}\b/);
  });

  it('shows two named sites, each with its own marker, and says which has not shared yet', async () => {
    const el = await render({ ok: true, data: sample({
      named: [
        { label: 'synacl.com', week: '2026-W42', metrics: { people: { value: 96, percentile: 44 } } },
        { label: 'siteread.dev', week: null, metrics: {} },
      ],
    }) });
    expect(text(el.querySelector('.bench-meta')!)).toContain('14 anonymous sites + synacl.com and siteread.dev');
    expect(text(el.querySelector('.bench-intro')!)).toContain('2 sites are named');
    const people = el.querySelector('.metrics tbody tr')!;
    expect(people.querySelectorAll('.marker').length).toBe(1);
    expect(text(people)).toContain('synacl.com 96 · 44th');
    expect(text(people)).toContain('siteread.dev: no share yet');
    expect([...el.querySelectorAll('.notice')].map(text)).toContain('siteread.dev has not shared in this window yet.');
    expect(el.querySelectorAll('.legend .key-marker.m1').length).toBe(1);
  });

  it('fetches the live numbers over a build-time snapshot, and keeps the snapshot if that fails', async () => {
    const fixture = await mount({ ok: true, data: sample(), snapshot: true });
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${PUBLIC_API}/v1/benchmark.json`).flush(sample({ sites: 15, generatedAt: '2026-10-23T10:00:00.000Z' }));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('.bench-meta')!)).toContain('15 anonymous sites');
    expect(text(el.querySelector('.bench-meta')!)).toContain('built 2026-10-23 10:00 UTC');

    TestBed.resetTestingModule();
    const stale = await mount({ ok: true, data: sample(), snapshot: true });
    TestBed.inject(HttpTestingController).expectOne(`${PUBLIC_API}/v1/benchmark.json`).error(new ProgressEvent('error'));
    await stale.whenStable();
    expect(text((stale.nativeElement as HTMLElement).querySelector('.bench-meta')!)).toContain('14 anonymous sites');
  });

  it('does not fetch again when the browser fetched the numbers itself', async () => {
    await mount({ ok: true, data: sample() });
    TestBed.inject(HttpTestingController).expectNone(`${PUBLIC_API}/v1/benchmark.json`);
  });

  it('leads with each named site’s week: figures, the stale week, bars with their numbers in text', async () => {
    const el = await render({ ok: true, data: sample({ sites: 2, metrics: { people: { about: '', lowerIsBetter: false, sites: 2 } }, window: { from: '2026-W43', to: '2026-W46' }, named: [
      { label: 'synacl.com', week: '2026-W44', metrics: { people: { value: 223 }, peopleFromSearch: { value: 41 }, aiAnswerFetches: { value: 36 } } },
    ] }) });
    const spot = el.querySelector('app-spotlight')!;
    expect(text(spot.querySelector('.spot-week')!)).toBe('week 2026-W44 · last share');
    expect(text(spot.querySelector('.tiles')!)).toContain('People 223');
    const bar = spot.querySelector('.seg-bar')!;
    expect(bar.getAttribute('aria-label')).toContain('Search 41 (18 %)');
    expect(bar.querySelectorAll('.seg').length).toBe(2);
    expect(el.querySelector('.meter')!.getAttribute('aria-label')).toBe('2 of 10 anonymous sites so far');
  });

  it('while early, each row draws the named sites as bars with their numbers, and ratios get their own cards', async () => {
    const el = await render({ ok: true, data: sample({ sites: 2, metrics: { people: { about: '', lowerIsBetter: false, sites: 2 } }, named: [
      { label: 'synacl.com', week: '2026-W42', metrics: { people: { value: 223 }, peopleFromAi: { value: 14 } } },
    ] }) });
    const row = el.querySelector('.metrics tbody tr')!;
    expect(text(row.querySelector('.compare-cell')!)).toBe('synacl.com 223');
    expect(row.querySelector('.hbar')!.getAttribute('title')).toBe('synacl.com: 223');
    expect(row.querySelectorAll('.named').length).toBe(0);
    expect([...el.querySelectorAll('.ratio h3')].map(text)).toContain('People from AI assistants');
    expect(text(el.querySelector('.kpis')!)).toContain('2 / 10');
  });

  it('puts a canonical link and Dataset data in the head', async () => {
    await render({ ok: true, data: sample() });
    expect(document.head.querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe('https://siteread.dev/benchmark');
    const ld = JSON.parse(document.head.querySelector('script[data-ld="dataset"]')!.textContent!);
    expect(ld['@type']).toBe('Dataset');
  });
});
