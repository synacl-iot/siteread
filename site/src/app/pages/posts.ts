/** The blog's posts, newest first. Each one's route, prerender entry and sitemap line go with it. */
export interface Post {
  slug: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD`, the day it went live. */
  date: string;
  byline: string;
}

export const LAUNCH: Post = {
  slug: 'introducing-siteread',
  title: 'Most of the AI traffic in our logs was fake. So we had to build a system to tell it apart, project siteread',
  description: 'Who read your site this week, was it good, and what to write next: siteread checks every crawler in your access log against the list its vendor publishes, writes a weekly memo, and runs on your machine.',
  date: '2026-10-23',
  // The owner's call (CLAUDE.md): left visible so the page cannot go live without one.
  byline: '[byline]',
};

export const POSTS: Post[] = [LAUNCH];
