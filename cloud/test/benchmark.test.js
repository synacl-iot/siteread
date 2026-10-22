import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentileOf, quantile, latestPerSite, windowOf, bandOf, standing, aggregate } from '../src/benchmark.js';
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

test('bandOf: below, between and above the published quartiles; a tie goes up', () => {
    const m = { p25: 10, p50: 20, p75: 30 };
    assert.deepEqual([9, 10, 19, 20, 29, 30, 1e6].map(v => bandOf(v, m)),
        ['below-p25', 'p25-p50', 'p25-p50', 'p50-p75', 'p50-p75', 'p75-up', 'p75-up']);
});

test('standing: a band only where the snapshot publishes quartiles, the count everywhere', () => {
    const snapshot = {
        generatedAt: '2026-10-21T12:00:00.000Z', window: { from: '2026-W39', to: '2026-W42' }, sites: 12, minSites: 10,
        metrics: { people: { sites: 12, p25: 10, p50: 20, p75: 30 }, gscClicks: { sites: 9 } },
    };
    const r = standing(share(1, '2026-W42', { people: 25, gscClicks: 3, peopleFromAi: 1 }), snapshot);
    assert.deepEqual(r, {
        week: '2026-W42',
        against: { generatedAt: '2026-10-21T12:00:00.000Z', window: { from: '2026-W39', to: '2026-W42' }, sites: 12, minSites: 10 },
        metrics: { people: { value: 25, sites: 12, band: 'p50-p75' }, gscClicks: { value: 3, sites: 9 }, peopleFromAi: { value: 1, sites: 0 } },
    });
    assert.deepEqual(standing(share(1, '2026-W42', { people: 25 }), null), { week: '2026-W42', against: null, metrics: { people: { value: 25, sites: 0 } } });
});

test('aggregate: quartiles only, from 10 anonymous sites up; n and history always, ids never', () => {
    const rows = [];
    for (let n = 1; n <= 9; n++) rows.push(share(n, '2026-W42', { people: n * 10, gscClicks: n }));
    rows.push(share(20, '2026-W40', { people: 100 }));     // an older week: counts in the window
    rows.push(share(20, '2026-W30', { people: 1 }));       // history only
    const doc = aggregate(rows, { now: NOW });
    assert.deepEqual(doc.window, { from: '2026-W39', to: '2026-W42' });
    assert.equal(doc.sites, 10);
    assert.equal(doc.minSites, 10);
    // 10, 20 … 100: p25 at rank 2.25, p50 at 4.5, p75 at 6.75. No p10 or p90: with them, five
    // numbers over a few values give those values back.
    const { about, ...people } = doc.metrics.people;
    assert.ok(about);
    assert.deepEqual(people, { lowerIsBetter: false, sites: 10, p25: 32.5, p50: 55, p75: 77.5 });
    assert.deepEqual(Object.keys(doc.metrics.gscClicks), ['about', 'lowerIsBetter', 'sites']);
    assert.equal(doc.metrics.gscClicks.sites, 9);
    assert.equal(doc.metrics.gscPosition.lowerIsBetter, true);
    assert.deepEqual(doc.named, []);
    assert.deepEqual(doc.history, [{ week: '2026-W30', sites: 1 }, { week: '2026-W40', sites: 1 }, { week: '2026-W42', sites: 9 }]);
    const text = JSON.stringify(doc);
    for (const n of [1, 2, 9, 20]) assert.ok(!text.includes(id(n)));
    assert.ok(!/"p10"|"p90"/.test(text));

    // A share for a week that has not started yet (a skewed client clock) is not the latest week.
    const ahead = aggregate([...rows, share(5, '2026-W50', { people: 7 })], { now: NOW });
    assert.equal(ahead.window.to, '2026-W42');

    const empty = aggregate([], { now: NOW });
    assert.equal(empty.window, null);
    assert.equal(empty.sites, 0);
    assert.deepEqual(empty.history, []);
});

test('aggregate: a named site shows by label, never by id, outside the quartiles; its rank from 10 up', () => {
    const rows = [];
    for (let n = 1; n <= 10; n++) rows.push(share(n, '2026-W42', { people: n }));
    rows.push(share(99, '2026-W41', { people: 50, gscClicks: 3 }));
    const named = new Map([[id(99), 'synacl.com'], [id(98), 'gone.example']]);
    const doc = aggregate(rows, { now: NOW, named });
    assert.equal(doc.sites, 10);                  // anonymous sites only
    assert.equal(doc.metrics.people.p50, 5.5);    // 1 … 10, without the named 50
    assert.deepEqual(doc.named, [
        // people: 10 anonymous below 50 → (10 + 1/2) / 11; gscClicks: no anonymous site has it, so no rank
        { label: 'synacl.com', week: '2026-W41', metrics: { people: { value: 50, percentile: 95 }, gscClicks: { value: 3 } } },
        // configured but no share in the window: listed, empty, so the page can say it stopped
        { label: 'gone.example', week: null, metrics: {} },
    ]);
    assert.equal(doc.history.find(h => h.week === '2026-W41').sites, 1);   // history counts every site
    const text = JSON.stringify(doc);
    assert.ok(!text.includes(id(99)) && !text.includes(id(98)));

    // Nine anonymous sites: the named site's own value is still public, its rank is not.
    const few = aggregate(rows.filter(r => r.id !== id(10)), { now: NOW, named });
    assert.deepEqual(few.named[0].metrics.people, { value: 50 });
    assert.ok(!('p50' in few.metrics.people));
});
