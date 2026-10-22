import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { timeout } from 'rxjs';
import { API_BASE, OperatorStatus } from '../api';
import { operatorView } from '../operator/view';

/**
 * The private status page. Never indexed (the proxy sends `x-robots-tag`, robots.txt disallows it).
 * The token lives in this component's signal and nowhere else: not in storage, not in the URL,
 * so a reload asks again. The hidden username field lets a password manager fill the token.
 */
@Component({
  selector: 'app-operator',
  templateUrl: './operator.html',
})
export class Operator {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE);
  private readonly token = signal('');
  protected readonly status = signal<OperatorStatus | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly hasToken = computed(() => this.token() !== '');
  protected readonly view = computed(() => {
    const s = this.status();
    return s ? operatorView(s) : null;
  });

  constructor() {
    inject(Meta).updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }

  protected submit(event: Event, input: HTMLInputElement) {
    event.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    this.token.set(t);
    input.value = '';
    this.load();
  }

  protected load() {
    if (!this.token()) return;
    this.busy.set(true);
    this.error.set('');
    this.http
      .get<OperatorStatus>(`${this.api}/v1/operator/status`, { headers: { authorization: `Bearer ${this.token()}` } })
      .pipe(timeout(10_000))
      .subscribe({
        next: s => {
          this.status.set(s);
          this.busy.set(false);
        },
        error: (e: unknown) => {
          this.busy.set(false);
          if (e instanceof HttpErrorResponse && e.status === 401) {
            this.forget();
            this.error.set('That token was refused.');
          } else {
            this.error.set('The service did not answer. It may be down, or this page is not the origin it allows.');
          }
        },
      });
  }

  protected forget() {
    this.token.set('');
    this.status.set(null);
    this.error.set('');
  }
}
