#!/usr/bin/env node
// One job, once, for a cron or a scheduler: node bin/job.js feed|aggregate [--data dir]
// Prints what it published as JSON; exits 1 when the job failed.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { fromEnv } from '../src/config.js';
import { dirStore } from '../src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: { data: { type: 'string', default: process.env.SITEREAD_DATA ?? path.join(here, '..', '.data') } },
});
const name = positionals[0];
if (positionals.length !== 1 || !['feed', 'aggregate'].includes(name)) {
    process.stderr.write('usage: node bin/job.js feed|aggregate [--data dir]\n');
    process.exit(1);
}

try {
    // The same named rows as the server: an aggregate run from cron must not drop them.
    const config = fromEnv(process.env);
    if (name === 'aggregate' && !config.named.size) {
        process.stderr.write('siteread-cloud: aggregate: SITEREAD_NAMED is not set, so the benchmark gets no named row\n');
    }
    const app = createApp({ store: dirStore(o.data), ...config });
    if (name === 'feed') {
        const { feed, result } = await app.runFeed();
        const counts = Object.fromEntries(Object.entries(feed.lists).map(([a, l]) => [a, { prefixes: l.prefixes.length, fetchedAt: l.fetchedAt }]));
        process.stdout.write(`${JSON.stringify({ generatedAt: feed.generatedAt, lists: counts, failed: result.errors }, null, 2)}\n`);
        if (!Object.keys(feed.lists).length) process.exitCode = 1;
    } else {
        process.stdout.write(`${JSON.stringify(await app.runAggregate(), null, 2)}\n`);
    }
} catch (err) {
    process.stderr.write(`siteread-cloud: ${name}: ${err?.message || err}\n`);
    process.exitCode = 1;
}
