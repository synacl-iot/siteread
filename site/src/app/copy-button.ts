import { Component, input, signal } from '@angular/core';

/** Copies `text` to the clipboard. Rendered on the server as a plain button; works once hydrated. */
@Component({
  selector: 'app-copy',
  template: `<button type="button" class="btn" (click)="copy()" [attr.aria-label]="label()">{{ done() ? 'Copied' : 'Copy' }}</button>`,
})
export class CopyButton {
  readonly text = input.required<string>();
  readonly label = input('Copy the command');
  protected readonly done = signal(false);

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.text());
      this.done.set(true);
      setTimeout(() => this.done.set(false), 2000);
    } catch {
      // No clipboard (an insecure context, a denied permission): the command is on the page to select.
    }
  }
}
