/** The blog's posts, newest first. Each one's route, prerender entry and sitemap line go with it. */
export interface Post {
  slug: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD`, the day it went live. */
  date: string;
  byline: string;
  /** The link preview, 1200×630 in `public/og/`. */
  image?: { path: string; alt: string };
}

export const LAUNCH: Post = {
  slug: 'introducing-siteread',
  title: 'Most of the AI traffic in our logs was fake. So we had to build a system to tell it apart, project siteread',
  description: 'Who read your site this week, was it good, and what to write next: siteread checks every crawler in your access log against the list its vendor publishes, writes a weekly memo, and runs on your machine.',
  date: '2026-10-23',
  byline: 'Darshil',
  image: {
    path: '/og/introducing-siteread.png',
    alt: 'The post title over a log line siteread marks spoofed: a ChatGPT-User request from outside OpenAI’s list. 217 of 221 such requests came from IPs that also probed for scanner paths.',
  },
};

export const CHATGPT_WEEK: Post = {
  slug: 'chatgpt-3-to-23',
  title: 'ChatGPT sent us 3 people one week and 23 the next. What the log can and cannot say about that',
  description: 'The first real siteread run on synacl.com: ChatGPT went from 3 first arrivals to 23 in a week, OpenAI’s search crawler doubled its fetches, and Search Console saw none of it. The numbers, the caveats, and what changed in siteread 0.3.0.',
  date: '2026-10-26',
  byline: 'Darshil',
};

export const POSTS: Post[] = [CHATGPT_WEEK, LAUNCH];
