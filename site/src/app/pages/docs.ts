import { Component, inject } from '@angular/core';
import { DomSanitizer, Meta, SafeHtml } from '@angular/platform-browser';
import { DOCS, VERSION } from '../generated/docs';

@Component({
  selector: 'app-docs',
  templateUrl: './docs.html',
})
export class Docs {
  protected readonly version = VERSION;
  // Trusted on purpose: the HTML is rendered at build time from this repo's own READMEs
  // (scripts/docs.mjs), never from anything a visitor or the service sends. Angular's sanitizer
  // would strip the heading ids the contents links point at.
  protected readonly sections = DOCS.map(d => ({
    id: d.id,
    title: d.title,
    html: inject(DomSanitizer).bypassSecurityTrustHtml(d.html) as SafeHtml,
  }));

  constructor() {
    inject(Meta).updateTag({
      name: 'description',
      content: 'siteread docs: the check, lists, digest and share commands, the seo-read skill, the library, the vendor lists and the feed format.',
    });
  }
}
