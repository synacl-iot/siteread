import { Component, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { AccountApi, failure, tokenFromHash } from '../account';

/**
 * Where the emailed link lands. The token is after `#`, which a browser never sends, so it is in no
 * server log; it is posted once, then wiped from the address bar and the history.
 */
@Component({
  selector: 'app-account-verify',
  imports: [RouterLink],
  template: `
    <main class="wrap page tight account">
      <section class="stack acct-form">
        <h1 class="display h2">Signing in</h1>
        @if (error()) {
          <p class="notice" role="alert">{{ error() }}</p>
          <a routerLink="/account" class="btn primary">Ask for a new link</a>
        } @else {
          <p class="muted">One moment…</p>
        }
      </section>
    </main>
  `,
})
export class AccountVerify {
  private readonly account = inject(AccountApi);
  private readonly router = inject(Router);
  protected readonly error = signal('');

  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
    const token = tokenFromHash(location.hash);
    history.replaceState(null, '', location.pathname);
    if (!token) {
      this.error.set('This link has no sign-in code in it.');
      return;
    }
    this.account.verify(token).subscribe({
      next: r => {
        this.account.setSession(r.session.token);
        this.router.navigateByUrl('/account');
      },
      error: e => this.error.set(failure(e)),
    });
  }
}
