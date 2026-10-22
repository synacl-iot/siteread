import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE } from '../api';
import { status } from '../operator/view.spec';
import { Operator } from './operator';

const TOKEN = 'a'.repeat(64);

async function setup() {
  TestBed.configureTestingModule({
    imports: [Operator],
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: 'http://api.test' }],
  });
  const fixture = TestBed.createComponent(Operator);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const submit = async () => {
    el.querySelector<HTMLInputElement>('#op-token')!.value = TOKEN;
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  return { fixture, el, submit, http: TestBed.inject(HttpTestingController) };
}

describe('Operator', () => {
  it('asks for the token first, with a field a password manager can fill', async () => {
    const { el } = await setup();
    const input = el.querySelector<HTMLInputElement>('#op-token')!;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('current-password');
    expect(el.querySelector<HTMLInputElement>('input[autocomplete="username"]')!.hidden).toBe(true);
    expect(el.querySelector('label[for="op-token"]')).not.toBeNull();
  });

  it('sends the token as a bearer header, clears the field, and shows the counts', async () => {
    const { fixture, el, submit, http } = await setup();
    await submit();
    const req = http.expectOne('http://api.test/v1/operator/status');
    expect(req.request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    req.flush(status());
    await fixture.whenStable();
    expect(el.textContent).toContain('1 of 2 fresh');
    expect(el.textContent).toContain('perplexity-user kept from an older fetch');
    expect(el.textContent).toContain('Token held in this tab only');
    expect(el.querySelectorAll('.op-table tbody tr').length).toBe(2 + 7);
    expect(el.innerHTML).not.toContain(TOKEN);
    http.verify();
  });

  it('forgets a refused token and says so', async () => {
    const { fixture, el, submit, http } = await setup();
    await submit();
    http.expectOne('http://api.test/v1/operator/status').flush({ ok: false }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('That token was refused.');
    expect(el.querySelector('#op-token')).not.toBeNull();
  });

  it('Forget token drops the status and asks again', async () => {
    const { fixture, el, submit, http } = await setup();
    await submit();
    http.expectOne('http://api.test/v1/operator/status').flush(status());
    await fixture.whenStable();
    [...el.querySelectorAll('button')].find(b => b.textContent!.includes('Forget token'))!.click();
    await fixture.whenStable();
    expect(el.querySelector('#op-token')).not.toBeNull();
    expect(el.textContent).not.toContain('1 of 2 fresh');
  });
});
