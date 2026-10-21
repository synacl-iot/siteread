import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentileOf, quantile, latestPerSite, windowOf, compare, aggregate } from '../src/benchmark.js';
import { share, id, NOW } from './helpers.js';

test('percentileOf: mid-rank, ties count half, one site is the 50th', () => {
    assert.equal(percentileOf([1, 2, 3, 4], 3), 63);    // (2 below + 1/2) / 4
    assert.equal(percentileOf([1, 2, 3, 4], 1), 13);
    assert.equal(percentileOf([5], 5), 50);
    assert.equal(percentileOf([2, 2, 2, 2], 2), 50);
    assert.equal(percentileOf([], 1), null);
});

test('quantile: linear between ranks', () => {
    const s = [1, 2, 3, 4, 5];
    assert.equal(quantile(s, 50), 3);
    assert.equal(quantile(s, 25), 2);
    assert.ok(Math.abs(quantile(s, 10) - 1.4) < 1e-9);
    assert.ok(Math.abs(quantile(s, 90) - 4.6) < 1e-9);
    assert.equal(quantile([7], 90), 7);
    assert.equal(quantile([], 50), null);
});

test('latestPerSite: one row per site, its latest within the 4 weeks ending at the week', () => {
    assert.deepEqual(windowOf('2027-W01'), ['2026-W51', '2026-W52', '2026-W53', '2027-W01']);
    const rows = [
        share(1, '2026-W40', { people: 10 }),
        share(1, '2026-W42', { people: 12 }),
        share(2, '2026-W38', { people: 99 }),   // 5 weeks before W42: out
        share(3, '2026-W43', { people: 50 }),   // after W42: out
        share(4, '2026-W39', { people: 1 }),
    ];
    const pop = latestPerSite(rows, '2026-W42');
    assert.deepEqual(pop.map(r => [r.id, r.week]).sort(), [[id(1), '2026-W42'], [id(4), '2026-W39']]);
});

test('compare: a percentile per metric, among the sites that report that metric', () => {
    const rows = [
        share(1, '2026-W42', { people: 4, gscClicks: 3 }),
        share(2, '2026-W42', { people: 10 }),
        share(3, '2026-W41', { people: 1, gscClicks: 9 }),
    ];
    const r = compare(rows, rows[0]);
    assert.deepEqual(r, {
        week: '2026-W42', window: { from: '2026-W39', to: '2026-W42' }, sites: 3,
        percentiles: {
            people: { value: 4, percentile: 50, sites: 3 },
            gscClicks: { value: 3, percentile: 25, sites: 2 },
        },
    });
});

test('aggregate: quantiles only from MIN_SITES up, n printed always, ids never', () => {
    const rows = [1, 2, 3, 4].map(n => share(n, '2026-W42', { people: n * 10, gscClicks: n }));
    rows.push(share(9, '2026-W40', { people: 1 }));          // an older week: counts in the window
    rows.push(share(9, '2026-W30', { people: 1 }));          // history only
    const doc = aggregate(rows, { now: NOW });
    assert.deepEqual(doc.window, { from: '2026-W39', to: '2026-W42' });
    assert.equal(doc.sites, 5);
    assert.equal(doc.minSites, 5);
    assert.deepEqual(doc.metrics.people, { about: doc.metrics.people.about, sites: 5, p10: 4.6, p25: 10, p50: 20, p75: 30, p90: 36 });
    assert.deepEqual(doc.metrics.gscClicks, { about: doc.metrics.gscClicks.about, sites: 4 });
    assert.deepEqual(doc.metrics.gscPosition, { about: doc.metrics.gscPosition.about, sites: 0 });
    assert.deepEqual(doc.history, [{ week: '2026-W30', sites: 1 }, { week: '2026-W40', sites: 1 }, { week: '2026-W42', sites: 4 }]);
    const text = JSON.stringify(doc);
    for (const n of [1, 2, 3, 4, 9]) assert.ok(!text.includes(id(n)));

    // A share for a week that has not started yet (a skewed client clock) is not the latest week.
    const ahead = aggregate([...rows, share(5, '2026-W50', { people: 7 })], { now: NOW });
    assert.equal(ahead.window.to, '2026-W42');

    const empty = aggregate([], { now: NOW });
    assert.equal(empty.window, null);
    assert.equal(empty.sites, 0);
    assert.deepEqual(empty.history, []);
});
