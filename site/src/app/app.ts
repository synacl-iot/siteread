import { Location } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

const NPM = 'https://www.npmjs.com/package/siteread';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (publicChrome()) {
      <header class="site-header">
        <div class="wrap">
          <a routerLink="/" class="brand">siteread<span>.dev</span></a>
          <nav aria-label="Main">
            <ul class="site-nav">
              <li><a routerLink="/benchmark" routerLinkActive ariaCurrentWhenActive="page">Benchmark</a></li>
              <li><a routerLink="/docs" routerLinkActive ariaCurrentWhenActive="page">Docs</a></li>
              <li><a routerLink="/privacy" routerLinkActive ariaCurrentWhenActive="page">Privacy</a></li>
              <li><a [href]="npm">npm</a></li>
            </ul>
          </nav>
        </div>
      </header>
    }
    <router-outlet />
    @if (publicChrome()) {
      <footer class="site-footer">
        <div class="wrap">
          <p>siteread is free and open source, MIT licensed.</p>
          <ul class="links">
            <li><a [href]="npm">npm package</a></li>
            <li><a [href]="source">Source on GitHub</a></li>
            <li><a routerLink="/privacy">What share sends</a></li>
          </ul>
        </div>
      </footer>
    }
  `,
})
export class App {
  protected readonly npm = NPM;
  protected readonly source = 'https://github.com/synacl-iot/siteread';
  // The operator page draws its own header: it is private, so it carries no public navigation.
  // The initial value comes from the address, so that page never flashes the public header.
  protected readonly publicChrome = toSignal(
    inject(Router).events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(e => !isOperator(e.urlAfterRedirects)),
    ),
    { initialValue: !isOperator(inject(Location).path()) },
  );
}

function isOperator(url: string) {
  return /^\/operator(\/|\?|#|$)/.test(url);
}
