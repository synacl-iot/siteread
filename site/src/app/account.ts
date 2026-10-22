import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, throwError, timeout } from 'rxjs';
import { API_BASE, AccountView } from './api';

const KEY = 'siteread-account-session';

/** The token from a sign-in link's fragment (`#t=<64 hex>`), or null. */
export function tokenFromHash(hash: string): string | null {
  const t = new URLSearchParams(hash.replace(/^#/, '')).get('t');
  return t && /^[0-9a-f]{64}$/.test(t) ? t : null;
}

/** A short message for a failed call. */
export function failure(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'The service did not answer. Try again in a minute.';
    const msg = (e.error as { error?: unknown } | null)?.error;
    return typeof msg === 'string' && msg.length < 200 ? msg : `The service answered ${e.status}.`;
  }
  return 'The service did not answer in time.';
}

/**
 * The account session, kept in this browser's localStorage for its 30 days so a return visit stays
 * signed in. Only the session: the email is never stored here, nor sent back by the service.
 * The calls go to /v1/account on the hosted service; a 401 forgets the session.
 */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE);
  readonly session = signal<string | null>(readSession());

  setSession(token: string | null) {
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      // Storage blocked: the session lasts as long as this page.
    }
    this.session.set(token);
  }

  private auth() {
    return { headers: { authorization: `Bearer ${this.session() ?? ''}` } };
  }

  private signedIn<T>(o: Observable<T>): Observable<T> {
    return o.pipe(
      timeout(15_000),
      catchError((e: unknown) => {
        if (e instanceof HttpErrorResponse && e.status === 401) this.setSession(null);
        return throwError(() => e);
      }),
    );
  }

  start(email: string) {
    return this.http.post<{ ok: true; sent: string }>(`${this.api}/v1/account/start`, { email }).pipe(timeout(15_000));
  }

  verify(token: string) {
    return this.http
      .post<{ ok: true; session: { token: string }; account: AccountView }>(`${this.api}/v1/account/verify`, { token })
      .pipe(timeout(15_000));
  }

  me() {
    return this.signedIn(this.http.get<{ ok: true; account: AccountView }>(`${this.api}/v1/account`, this.auth()));
  }

  newKey() {
    return this.signedIn(this.http.post<{ ok: true; key: string }>(`${this.api}/v1/account/key`, {}, this.auth()));
  }

  link(id: string, unlink = false) {
    return this.signedIn(this.http.post<{ ok: true; account: AccountView }>(`${this.api}/v1/account/sites`, { id, unlink }, this.auth()));
  }

  signOut() {
    return this.signedIn(this.http.post<{ ok: true }>(`${this.api}/v1/account/signout`, {}, this.auth()));
  }

  delete() {
    return this.signedIn(this.http.post<{ ok: true }>(`${this.api}/v1/account/delete`, {}, this.auth()));
  }
}

function readSession(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
