import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

const NPM = 'https://www.npmjs.com/package/siteread';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
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
    <router-outlet />
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
  `,
})
export class App {
  protected readonly npm = NPM;
  protected readonly source = 'https://github.com/synacl-iot/siteread';
}
