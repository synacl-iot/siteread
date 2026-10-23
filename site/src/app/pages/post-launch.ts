import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CopyButton } from '../copy-button';
import { pageMeta } from '../seo';
import { LAUNCH } from './posts';

@Component({
  selector: 'app-post-launch',
  imports: [RouterLink, CopyButton],
  templateUrl: './post-launch.html',
})
export class PostLaunch {
  protected readonly post = LAUNCH;
  protected readonly check = 'npx siteread check <ip> "<user-agent>"';
  protected readonly plugin = 'claude plugin marketplace add synacl-iot/siteread\nclaude plugin install siteread@siteread';

  constructor() {
    pageMeta({
      title: LAUNCH.title,
      description: LAUNCH.description,
      path: `/blog/${LAUNCH.slug}`,
      type: 'article',
      published: LAUNCH.date,
      image: LAUNCH.image,
    });
  }
}
