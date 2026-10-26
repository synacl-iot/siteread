import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pageMeta } from '../seo';
import { CHATGPT_WEEK } from './posts';

@Component({
  selector: 'app-post-chatgpt-week',
  imports: [RouterLink],
  templateUrl: './post-chatgpt-week.html',
})
export class PostChatgptWeek {
  protected readonly post = CHATGPT_WEEK;

  constructor() {
    pageMeta({
      title: CHATGPT_WEEK.title,
      description: CHATGPT_WEEK.description,
      path: `/blog/${CHATGPT_WEEK.slug}`,
      type: 'article',
      published: CHATGPT_WEEK.date,
    });
  }
}
