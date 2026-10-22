import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { VERSION } from '../generated/docs';

@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.html',
})
export class Privacy {
  protected readonly version = VERSION;
  // The README's own dry run (packages/verify/README.md, Share), so the two never disagree on shape.
  protected readonly payload = JSON.stringify({
    schema: 1,
    id: '3803e566762f2e56ba381b993ddf466e',
    week: '2026-W42',
    siteread: VERSION,
    metrics: {
      people: 4, peopleFromSearch: 1, peopleFromAi: 0, peopleFromSocial: 2,
      aiAnswerFetches: 0, aiSearchFetches: 0, aiTrainingFetches: 2, searchEngineFetches: 8, aiSpoofedPct: 25,
      gscImpressions: 238, gscClicks: 3, gscCtrPct: 1.3, gscPosition: 17.9,
    },
  }, null, 2);

  constructor() {
    inject(Meta).updateTag({
      name: 'description',
      content: 'What siteread sends, and what it never does: no hostnames, URLs or visitor IPs leave your machine. A share is a week of totals, sent only on a yes.',
    });
  }
}
