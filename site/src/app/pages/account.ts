import { Component, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { AccountApi, failure } from '../account';
import { AccountView } from '../api';
import { CopyButton } from '../copy-button';

const SHARE_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Your account: sign in by an emailed link, then your plan, an API key and the sites you linked by
 * their share id (`.siteread/share-id`). Free use needs no account; this page is for what comes
 * with one. The service never returns the email, so the page cannot show or leak it.
 */
@Component({
  selector: 'app-account',
  imports: [CopyButton],
  templateUrl: './account.html',
})
export class AccountPage {
  protected readonly api = inject(AccountApi);
  protected readonly account = signal<AccountView | null>(null);
  protected readonly newKey = signal('');
  protected readonly sent = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
    if (this.api.session()) this.load();
  }

  private run<T>(call: () => Observable<T>, next: (r: T) => void) {
    this.busy.set(true);
    this.error.set('');
    call().subscribe({
      next: r => {
        this.busy.set(false);
        next(r);
      },
      error: e => {
        this.busy.set(false);
        this.error.set(this.api.session() ? failure(e) : 'Your session ended. Sign in again.');
        if (!this.api.session()) this.account.set(null);
      },
    });
  }

  protected load() {
    this.run(() => this.api.me(), r => this.account.set(r.account));
  }

  protected start(event: Event, input: HTMLInputElement) {
    event.preventDefault();
    const email = input.value.trim();
    if (!email) return;
    this.run(() => this.api.start(email), r => this.sent.set(r.sent));
  }

  protected makeKey() {
    if (this.account()?.key && !confirm('Make a new key? The one you have stops working at once.')) return;
    this.run(() => this.api.newKey(), r => {
      this.newKey.set(r.key);
      this.load();
    });
  }

  protected link(event: Event, input: HTMLInputElement) {
    event.preventDefault();
    const id = input.value.trim().toLowerCase();
    if (!SHARE_ID_RE.test(id)) {
      this.error.set('A share id is the 32 letters and digits in .siteread/share-id, next to where you run siteread.');
      return;
    }
    this.run(() => this.api.link(id), r => {
      input.value = '';
      this.account.set(r.account);
    });
  }

  protected unlink(id: string) {
    this.run(() => this.api.link(id, true), r => this.account.set(r.account));
  }

  protected signOut() {
    const done = () => {
      this.api.setSession(null);
      this.account.set(null);
      this.newKey.set('');
    };
    this.api.signOut().subscribe({ next: done, error: done });
  }

  protected remove() {
    if (!confirm('Delete your account? Your email, key and links are deleted. Shares you sent stay, anonymous as they always were.')) return;
    this.run(() => this.api.delete(), () => {
      this.api.setSession(null);
      this.account.set(null);
      this.newKey.set('');
    });
  }
}
