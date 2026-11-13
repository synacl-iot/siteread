import { HttpClient } from '@angular/common/http';
import { afterNextRender, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { API_BASE, Benchmark } from '../api';
import { SpotlightCard } from '../benchmark/spotlight';
import { fmt, spotlights } from '../benchmark/view';
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

interface MoatPoint {
  num: string;
  unit: string;
  title: string;
  text: string;
}

/** Shown as an open list and written into the page's FAQPage data, so the two never differ. */
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Do I need to add a script or tag to my site?',
    a: 'No. siteread reads the access log your server already writes. It supports nginx and Apache combined logs, Caddy JSON and nginx JSON. Gzipped logs work too. You can add a Search Console export if you have one. AI agents and crawlers run no JavaScript. A tag never sees them. The log does.',
  },
  {
    q: 'How does it know a crawler is real?',
    a: 'siteread uses the IP lists that vendors publish for their bots. These include Google, Bing, OpenAI, Anthropic, Perplexity and Apple. A request with an AI user-agent from an IP outside the list is spoofed. It is not counted as that AI. If a vendor publishes no list, the verdict is unknown. siteread does not guess.',
  },
  {
    q: 'Does it send my data anywhere?',
    a: 'Nothing by default. siteread runs on your machine and only downloads the public IP lists. Sharing is opt-in. A share sends one week of totals to the benchmark. siteread prints the exact payload and asks before it sends. Hostnames, URLs and visitor IPs never leave your machine.',
  },
  {
    q: 'Do I need Claude Code?',
    a: 'No. The siteread CLI works on its own. It gives you the verdicts and the weekly digest as JSON. The seo-read skill for Claude Code turns the digest into a dated memo with next steps.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. The tool is free and open source under the MIT licence. The public benchmark is free too.',
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
  private readonly data = computed(() => this.live() ?? (this.benchmark()?.ok ? (this.benchmark() as { data: Benchmark }).data : null));
  /** The busiest named site's latest week, or null when the benchmark is not there. */
  protected readonly lead = computed(() => {
    const b = this.data();
    return b ? (spotlights(b)[0] ?? null) : null;
  });

  /**
   * The case for siteread, one number per point, each true today. The list counts come from
   * packages/verify/src/ip-ranges.js SOURCES (15 agents; Anthropic serves one list for its three).
   * The last two points use the live benchmark when it answered.
   */
  protected readonly moat = computed((): MoatPoint[] => {
    const b = this.data();
    const lead = this.lead();
    const sharing = b ? b.sites + b.named.filter(n => n.week).length : null;
    const ai = lead?.ai?.total;
    return [
      { num: '13', unit: 'vendor IP lists', title: 'Every crawler is checked',
        text: 'siteread checks 15 crawlers, including ChatGPT-User, ClaudeBot and Googlebot. Each request is matched against the IP list its vendor publishes. If the IP is not on the list, the request is spoofed. It is not counted.' },
      { num: '0', unit: 'lines of JavaScript', title: 'Sees what a tag misses',
        text: ai != null && lead
          ? `AI agents do not run scripts. An analytics tag never counts them. Your access log does. ${lead.label} logged ${fmt(ai)} verified AI agent fetches in its latest shared week.`
          : 'AI agents do not run scripts. An analytics tag never counts them. Your access log does.' },
      { num: '0', unit: 'visitor IPs sent', title: 'Your log stays on your machine',
        text: 'The CLI and the skill read files on your disk. Sharing is optional. A share is one week of totals. It never contains a hostname, a URL or a visitor IP.' },
      { num: sharing != null ? fmt(sharing) : 'free', unit: sharing != null ? (sharing === 1 ? 'site sharing' : 'sites sharing') : 'public data', title: 'An open benchmark',
        text: 'Sites share verified weekly numbers. Every row shows how many sites it is based on. The data is free as JSON. Each new share makes the comparison better.' },
    ];
  });

  protected readonly check = 'npx siteread check <ip> "<user-agent>"';
  protected readonly install = 'claude plugin marketplace add synacl-iot/siteread\nclaude plugin install siteread@siteread';
  protected readonly faq = FAQ;
  protected readonly posts = POSTS.slice(0, 2);

  protected readonly lines: readonly Verdict[] = [
    { ip: '160.79.104.10', claim: 'Claude-User/1.0', path: '/docs/', kind: 'ok', word: 'verified', why: 'listed in claude.com/crawling/bots.json' },
    { ip: '203.0.113.9', claim: 'ChatGPT-User/1.0', path: '/pricing/', kind: 'bad', word: 'spoofed', why: 'not listed in openai.com/chatgpt-user.json' },
    { ip: '66.249.66.1', claim: 'Googlebot/2.1', path: '/sitemap.xml', kind: 'ok', word: 'verified', why: 'listed in Google’s googlebot.json' },
    { ip: '198.51.100.23', claim: 'ClaudeBot/1.0', path: '/.env', kind: 'bad', word: 'spoofed', why: 'not listed in claude.com/crawling/bots.json' },
    { ip: '192.0.2.44', claim: 'Safari/17.6', path: '/blog/', kind: 'person', word: 'person', why: 'a real browser that came from chatgpt.com' },
  ];

  /** What a JavaScript analytics tag sees, against what the log shows. */
  protected readonly compare: readonly { what: string; tag: string; log: string }[] = [
    { what: 'People who load your pages', tag: 'Only when the script is allowed to run.', log: 'Yes. Scanners are left out.' },
    { what: 'ChatGPT, Claude and Perplexity reading a page for someone', tag: 'No. They run no JavaScript.', log: 'Yes. Each one is verified.' },
    { what: 'AI search indexing and training crawls', tag: 'No.', log: 'Yes. Split by vendor and purpose.' },
    { what: 'Bots pretending to be ChatGPT or Googlebot', tag: 'No.', log: 'Yes. Marked spoofed and left out.' },
    { what: 'Search Console clicks and position next to the log', tag: 'No.', log: 'Yes. Shown for the same weeks.' },
    { what: 'Where your visitors’ data goes', tag: 'To the analytics vendor.', log: 'Nowhere. It stays on your machine.' },
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

    const description = 'See who really read your site this week. siteread checks every crawler in your access log against its vendor’s IP list. Fake ChatGPT and Googlebot traffic is not counted. It runs on your machine.';
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
