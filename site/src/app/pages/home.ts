import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CopyButton } from '../copy-button';

@Component({
  selector: 'app-home',
  imports: [RouterLink, CopyButton],
  templateUrl: './home.html',
})
export class Home {
  protected readonly check = 'npx siteread check <ip> "<user-agent>"';

  constructor() {
    inject(Meta).updateTag({
      name: 'description',
      content: 'Who read your site this week, was it good, and what to write next. Every crawler in your access log checked against the IP list its vendor publishes. Runs on your machine.',
    });
  }
}
