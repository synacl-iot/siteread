import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Blog } from './blog';
import { PostLaunch } from './post-launch';
import { LAUNCH } from './posts';

describe('the blog', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const head = () => TestBed.inject(DOCUMENT).head;
  const og = (property: string) => head().querySelector(`meta[property="${property}"]`)?.getAttribute('content');

  it('lists the launch post', () => {
    const fixture = TestBed.createComponent(Blog);
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector('.post-list a')!;
    expect(link.textContent).toBe(LAUNCH.title);
    expect(link.getAttribute('href')).toBe(`/blog/${LAUNCH.slug}`);
  });

  it('gives the post its canonical, description and preview tags, and takes them away on leaving', () => {
    const fixture = TestBed.createComponent(PostLaunch);
    fixture.detectChanges();
    const url = `https://siteread.dev/blog/${LAUNCH.slug}`;
    expect(head().querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe(url);
    expect(head().querySelector('meta[name="description"]')!.getAttribute('content')).toBe(LAUNCH.description);
    expect(og('og:url')).toBe(url);
    expect(og('og:type')).toBe('article');
    expect(og('og:title')).toBe(LAUNCH.title);
    expect(og('article:published_time')).toBe(LAUNCH.date);
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')!.textContent).toBe(LAUNCH.title);

    fixture.destroy();
    expect(head().querySelector('link[rel="canonical"]')).toBeNull();
    expect(og('og:url')).toBeUndefined();
  });

  it('never names a plan or a price', () => {
    const fixture = TestBed.createComponent(PostLaunch);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).not.toMatch(/[$€£]\s?\d|pricing|\bS[12]\b|paid plan|per month/i);
  });
});
