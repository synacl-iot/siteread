import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pageMeta } from '../seo';
import { POSTS } from './posts';

@Component({
  selector: 'app-blog',
  imports: [RouterLink],
  template: `
    <main class="wrap page tight blog">
      <section class="stack">
        <h1 class="display h1 small">Blog</h1>
        <p class="lede">What we learned reading our own logs, and what changed in siteread because of it.</p>
      </section>
      <ol class="post-list">
        @for (p of posts; track p.slug) {
          <li class="stack tight-stack">
            <p class="mono note"><time [attr.datetime]="p.date">{{ p.date }}</time></p>
            <h2 class="display h2 small"><a [routerLink]="'/blog/' + p.slug">{{ p.title }}</a></h2>
            <p class="muted">{{ p.description }}</p>
          </li>
        }
      </ol>
    </main>
  `,
})
export class Blog {
  protected readonly posts = POSTS;

  constructor() {
    pageMeta({
      title: 'Blog · siteread',
      description: 'Posts from siteread: what one site’s access log showed about AI crawlers and search, and what changed in the tool because of it.',
      path: '/blog',
    });
  }
}
