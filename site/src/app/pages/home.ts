import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { API_BASE, Benchmark } from '../api';
import { SpotlightCard } from '../benchmark/spotlight';
import { spotlights } from '../benchmark/view';
import { CopyButton } from '../copy-button';
import { jsonLd, ORIGIN, pageMeta } from '../seo';
import { BenchmarkLoad, fetchBenchmark } from './benchmark';
import { POSTS } from './posts';

/** A log line and what siteread says about it, for the hero's panel. Documentation addresses only. */
interface Verdict {
  ip: string;
  claim: string;
  path: string;
  kind: 'ok' | 'bad' | 'person';
  word: string;
  why: string;
}

/** Shown as an open list and written into the page's FAQPage data, so the two never differ. */
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Do I need to add a script or tag to my site?',
    a: 'No. siteread reads the access log your web server already writes (nginx or Apache combined, Caddy’s JSON, or an nginx JSON log_format; gzipped is fine) and, if you have one, a Search Console export. AI agents and crawlers run no JavaScript, so a tag never sees them; the log does.',
  },
  {
    q: 'How does it know a crawler is real?',
    a: 'Every vendor that publishes the IP ranges its bots use, from Google and Bing to OpenAI, Anthropic, Perplexity and Apple, has its list checked. A request with an AI user-agent from outside that list is counted as spoofed, not as the AI. Where a vendor publishes no list, the verdict is unknown rather than a guess.',
  },
  {
    q: 'What does it send, and to whom?',
    a: 'Nothing by default. It runs on your machine and only downloads the public IP lists. If you choose to run share, it sends one week of totals to the benchmark, prints the exact payload first, and asks before sending. Hostnames, URLs and visitor IPs never leave your machine.',
  },
  {
    q: 'Do I need Claude Code?',
    a: 'No. The siteread CLI gives you the verdicts and the weekly digest as JSON on its own. The seo-read skill for Claude Code turns that digest into a dated memo with what to do next.',
  },
  {
    q: 'What does it cost?',
    a: 'The tool is free and open source under the MIT licence, and so is the public benchmark.',
  },
];

@Component({
  selector: 'app-home',
  imports: [RouterLink, CopyButton, SpotlightCard],
  templateUrl: './home.html',
})
export class Home {
  /** From the route resolver: the same snapshot the benchmark page uses. */
  readonly benchmark = input<BenchmarkLoad>();
  private readonly live = signal<Benchmark | null>(null);
  /** The busiest named site's latest week, or null when the benchmark is not there. */
  protected readonly lead = computed(() => {
    const b = this.live() ?? (this.benchmark()?.ok ? (this.benchmark() as { data: Benchmark }).data : null);
    return b ? (spotlights(b)[0] ?? null) : null;
  });

  protected readonly check = 'npx siteread check <ip> "<user-agent>"';
  protected readonly install = 'claude plugin marketplace add synacl-iot/siteread\nclaude plugin install siteread@siteread';
  protected readonly faq = FAQ;
  protected readonly posts = POSTS.slice(0, 2);

  protected readonly lines: readonly Verdict[] = [
    { ip: '160.79.104.10', claim: 'Claude-User/1.0', path: '/docs/', kind: 'ok', word: 'verified', why: 'in claude.com/crawling/bots.json' },
    { ip: '203.0.113.9', claim: 'ChatGPT-User/1.0', path: '/pricing/', kind: 'bad', word: 'spoofed', why: 'not in openai.com/chatgpt-user.json' },
    { ip: '66.249.66.1', claim: 'Googlebot/2.1', path: '/sitemap.xml', kind: 'ok', word: 'verified', why: 'in Google’s googlebot.json' },
    { ip: '198.51.100.23', claim: 'ClaudeBot/1.0', path: '/.env', kind: 'bad', word: 'spoofed', why: 'not in claude.com/crawling/bots.json' },
    { ip: '192.0.2.44', claim: 'Safari/17.6', path: '/blog/', kind: 'person', word: 'person', why: 'loaded the page and its assets, arrived from chatgpt.com' },
  ];

  /** What a JavaScript analytics tag sees, against what the log shows. */
  protected readonly compare: readonly { what: string; tag: string; log: string }[] = [
    { what: 'People who load your pages', tag: 'yes, if they allow the script', log: 'yes, from the log, scanners left out' },
    { what: 'ChatGPT, Claude and Perplexity reading a page for someone', tag: 'no, they run no JavaScript', log: 'yes, each one verified' },
    { what: 'AI search indexing and training crawls', tag: 'no', log: 'yes, by vendor and purpose' },
    { what: 'Bots pretending to be ChatGPT or Googlebot', tag: 'no', log: 'yes, called spoofed and left out' },
    { what: 'Search Console clicks and position next to the log', tag: 'no', log: 'yes, the same weeks side by side' },
    { what: 'Where your visitors’ data goes', tag: 'to the analytics vendor', log: 'nowhere: it runs on your machine' },
  ];

  constructor() {
    const http = inject(HttpClient);
    const api = inject(API_BASE);
    // As on the benchmark page: the prerendered numbers first, the live ones over them.
    afterNextRender(() => {
      if (!this.benchmark()?.snapshot) return;
      fetchBenchmark(http, api, 3000).subscribe(load => {
        if (load.ok) this.live.set(load.data);
      });
    });

    const description = 'Who read your site this week, was it good, and what to write next. Every crawler in your access log checked against the IP list its vendor publishes, so fake ChatGPT and Googlebot traffic is not counted. Runs on your machine.';
    pageMeta({ title: 'siteread: who read your site this week', description, path: '/' });
    jsonLd('software', {
      '@type': 'SoftwareApplication',
      name: 'siteread',
      description,
      url: `${ORIGIN}/`,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux, Windows (Node.js 20 or later)',
      license: 'https://opensource.org/licenses/MIT',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      sameAs: ['https://github.com/synacl-iot/siteread', 'https://www.npmjs.com/package/siteread'],
    });
    jsonLd('faq', {
      '@type': 'FAQPage',
      mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
}
