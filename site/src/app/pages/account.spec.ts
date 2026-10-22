import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { tokenFromHash } from '../account';
import { API_BASE, AccountView } from '../api';
import { AccountPage } from './account';
import { AccountVerify } from './account-verify';

@Component({ template: '' })
class Blank {}

const SESSION = 'b'.repeat(64);
const VIEW: AccountView = { plan: 'free', createdOn: '2026-10-22', verifiedOn: '2026-10-22', key: 'sr_f29a4…', sites: ['0'.repeat(32)] };

function setup<T>(component: Type<T>) {
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideRouter([{ path: '**', component: Blank }]), provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: 'http://api.test' }],
  });
  const fixture = TestBed.createComponent(component);
  return { fixture, el: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) };
}

describe('tokenFromHash', () => {
  it('takes 64 hex digits after #t= and nothing else', () => {
    expect(tokenFromHash(`#t=${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    for (const h of ['', '#t=', `#t=${'a'.repeat(63)}`, `#t=${'A'.repeat(64)}`, '#x=1']) expect(tokenFromHash(h)).toBeNull();
  });
});

describe('AccountPage', () => {
  beforeEach(() => localStorage.clear());

  it('signed out: asks for an email and posts it', async () => {
    const { fixture, el, http } = setup(AccountPage);
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#acct-email')!;
    expect(input.type).toBe('email');
    input.value = 'me@example.com';
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('http://api.test/v1/account/start');
    expect(req.request.body).toEqual({ email: 'me@example.com' });
    req.flush({ ok: true, sent: 'If the address is valid, a sign-in link is on its way.' });
    await fixture.whenStable();
    expect(el.textContent).toContain('a sign-in link is on its way');
    http.verify();
  });

  it('signed in: loads the account with the bearer session and shows the key prefix, never an email', async () => {
    localStorage.setItem('siteread-account-session', SESSION);
    const { fixture, el, http } = setup(AccountPage);
    const req = http.expectOne('http://api.test/v1/account');
    expect(req.request.headers.get('authorization')).toBe(`Bearer ${SESSION}`);
    req.flush({ ok: true, account: VIEW });
    await fixture.whenStable();
    expect(el.textContent).toContain('Your key starts sr_f29a4…');
    expect(el.textContent).toContain('0'.repeat(32));
    expect(el.textContent).not.toContain('@');
  });

  it('refuses a share id that is not 32 hex digits before calling the service', async () => {
    localStorage.setItem('siteread-account-session', SESSION);
    const { fixture, el, http } = setup(AccountPage);
    http.expectOne('http://api.test/v1/account').flush({ ok: true, account: VIEW });
    await fixture.whenStable();
    el.querySelector<HTMLInputElement>('#acct-site')!.value = 'example.com';
    el.querySelector<HTMLInputElement>('#acct-site')!.form!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('.siteread/share-id');
    http.verify();
  });

  it('a 401 forgets the session', async () => {
    localStorage.setItem('siteread-account-session', SESSION);
    const { fixture, el, http } = setup(AccountPage);
    http.expectOne('http://api.test/v1/account').flush({ ok: false, error: 'sign in again' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(localStorage.getItem('siteread-account-session')).toBeNull();
    expect(el.querySelector('#acct-email')).not.toBeNull();
  });
});

describe('AccountVerify', () => {
  beforeEach(() => localStorage.clear());

  it('posts the token from the fragment, wipes it from the address, and keeps the session', async () => {
    const token = 'c'.repeat(64);
    history.replaceState(null, '', `/account/verify#t=${token}`);
    const { fixture, http } = setup(AccountVerify);
    expect(location.hash).toBe('');
    const req = http.expectOne('http://api.test/v1/account/verify');
    expect(req.request.body).toEqual({ token });
    req.flush({ ok: true, session: { token: SESSION }, account: VIEW });
    await fixture.whenStable();
    expect(localStorage.getItem('siteread-account-session')).toBe(SESSION);
  });

  it('says so when the link has no token', async () => {
    history.replaceState(null, '', '/account/verify');
    const { fixture, el, http } = setup(AccountVerify);
    await fixture.whenStable();
    expect(el.textContent).toContain('no sign-in code');
    http.verify();
  });
});
