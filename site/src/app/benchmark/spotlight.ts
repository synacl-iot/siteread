import { NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { Segment, Spotlight } from './view';

/**
 * One named site's latest week: headline figures and two segmented bars. Used on the benchmark
 * page and, for the busiest named site, on the home page. Every number is printed as text; the
 * bars repeat them as shapes and are hidden from screen readers, which read the `label` instead.
 */
@Component({
  selector: 'app-spotlight',
  template: `
    @let s = site();
    <article class="card big spot" [attr.aria-labelledby]="'spot-' + s.label">
      <header class="spot-head">
        <div class="stack tight-stack">
          <h3 class="spot-name" [id]="'spot-' + s.label">{{ s.label }}</h3>
          @if (s.about) {
            <p class="muted">{{ s.about }}</p>
          }
        </div>
        <p class="mono spot-week" [class.stale]="s.stale">week {{ s.week }}@if (s.stale) { · last share}</p>
      </header>

      <dl class="tiles">
        @for (t of s.tiles; track t.label) {
          <div class="tile">
            <dt>{{ t.label }}</dt>&ngsp;
            <dd class="tile-value">{{ t.value }}</dd>&ngsp;
            <dd class="tile-note">{{ t.note }}</dd>
          </div>
        }
      </dl>

      @if (s.people; as p) {
        <ng-container *ngTemplateOutlet="bar; context: { title: 'Where people came from', total: p.total, unit: 'people', segs: p.segments, label: p.label }" />
      }
      @if (s.ai; as a) {
        <ng-container *ngTemplateOutlet="bar; context: { title: 'What AI agents came for', total: a.total, unit: 'fetches', segs: a.segments, label: a.label }" />
      }
      @if (s.crawl; as c) {
        <ng-container *ngTemplateOutlet="bar; context: { title: 'Who crawled more', total: c.total, unit: 'verified fetches', segs: c.segments, label: c.label }" />
      }
      @if (s.search; as f) {
        <div class="seg-block funnel">
          <p class="seg-title"><strong>Search, impressions to clicks</strong> <span class="muted mono">{{ f.ctr }} click-through@if (f.position) { · position {{ f.position }}}</span></p>
          <div class="funnel-rows" role="img" [attr.aria-label]="f.label">
            <div class="funnel-row"><span class="funnel-name">Impressions</span>&ngsp;<div class="funnel-track"><div class="funnel-bar s1" style="width: 100%" [title]="f.impressions + ' impressions'"></div></div>&ngsp;<span class="mono funnel-num">{{ f.impressions }}</span></div>
            <div class="funnel-row"><span class="funnel-name">Clicks</span>&ngsp;<div class="funnel-track"><div class="funnel-bar s2" [style.width.%]="f.clickPct" [title]="f.clicks + ' clicks, ' + f.ctr"></div></div>&ngsp;<span class="mono funnel-num">{{ f.clicks }}</span></div>
          </div>
        </div>
      }
    </article>

    <ng-template #bar let-title="title" let-total="total" let-unit="unit" let-segs="segs" let-label="label">
      <div class="seg-block">
        <p class="seg-title"><strong>{{ title }}</strong> <span class="muted mono">{{ total }} {{ unit }}</span></p>
        <div class="seg-bar" role="img" [attr.aria-label]="label">
          @for (g of asSegs(segs); track g.key) {
            <div class="seg" [class]="g.cls" [style.flex-grow]="g.value" [title]="g.label + ': ' + g.value + ' (' + g.pct + ' %)'"></div>
          }
        </div>
        <ul class="seg-legend" aria-hidden="true">
          @for (g of asSegs(segs); track g.key) {
            <li><span class="swatch" [class]="g.cls"></span>{{ g.label }}&ngsp; <span class="mono">{{ g.value }} · {{ g.pct }} %</span></li>
          }
        </ul>
      </div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class SpotlightCard {
  readonly site = input.required<Spotlight>();
  protected asSegs = (s: unknown) => s as Segment[];
}
