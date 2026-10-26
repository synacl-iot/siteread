import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Blog } from './blog';
import { PostLaunch } from './post-launch';
import { PostChatgptWeek } from './post-chatgpt-week';
import { CHATGPT_WEEK, LAUNCH } from './posts';

describe('the blog', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const head = () => TestBed.inject(DOCUMENT).head;
  const og = (property: string) => head().querySelector(`meta[property="${property}"]`)?.getAttribute('content');

  it('lists the posts, newest first', () => {
    const fixture = TestBed.createComponent(Blog);
    fixture.detectChanges();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.post-list a')];
    expect(links.map(a => a.getAttribute('href'))).toEqual([`/blog/${CHATGPT_WEEK.slug}`, `/blog/${LAUNCH.slug}`]);
    expect(links[1].textContent).toBe(LAUNCH.title);
  });

  it('gives the ChatGPT post its own canonical and title, and names no plan or price', () => {
    const fixture = TestBed.createComponent(PostChatgptWeek);
    fixture.detectChanges();
    expect(head().querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe(`https://siteread.dev/blog/${CHATGPT_WEEK.slug}`);
    expect(og('article:published_time')).toBe(CHATGPT_WEEK.date);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')!.textContent).toBe(CHATGPT_WEEK.title);
    expect(el.textContent!).not.toMatch(/[$€£]\s?\d|pricing|\bS[12]\b|paid plan|per month/i);
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
    expect(og('og:image')).toBe('https://siteread.dev/og/introducing-siteread.png');
    expect(head().querySelector('meta[name="twitter:card"]')!.getAttribute('content')).toBe('summary_large_image');
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
