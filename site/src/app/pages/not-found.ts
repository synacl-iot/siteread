import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <main class="wrap page">
      <section class="stack">
        <h1 class="display h1 small">Not found</h1>
        <p class="lede">There is no page at this address. Try the <a routerLink="/">home page</a>, the <a routerLink="/benchmark">benchmark</a> or the <a routerLink="/docs">docs</a>.</p>
      </section>
    </main>
  `,
})
export class NotFound {}
