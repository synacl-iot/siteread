#!/usr/bin/env node
// The whole service in one Node process: the HTTP endpoints plus both jobs on timers.
//
//   node bin/serve.js [--port 8787] [--host 127.0.0.1] [--data .data] [--public-url URL] [--no-jobs]
//
// The feed job runs at start and every 6 h, the aggregate job at start and every hour. With
// --no-jobs, run them from cron instead: node bin/job.js feed|aggregate --data <same dir>.
// Secrets and named rows come from the environment (src/config.js). Request counts are written to
// the store every hour and on shutdown, jobs or not.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { fromEnv } from '../src/config.js';
import { FEED_EVERY_MS } from '../src/feed.js';
import { dirStore } from '../src/store.js';
import { serve } from '../src/node.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: o } = parseArgs({
    options: {
        port: { type: 'string', default: process.env.PORT ?? '8787' },
        host: { type: 'string', default: process.env.HOST ?? '127.0.0.1' },
        data: { type: 'string', default: process.env.SITEREAD_DATA ?? path.join(here, '..', '.data') },
        'public-url': { type: 'string', default: process.env.SITEREAD_PUBLIC_URL ?? 'https://siteread.dev' },
        'no-jobs': { type: 'boolean', default: false },
    },
});

let config;
try { config = fromEnv(process.env); } catch (err) {
    process.stderr.write(`siteread-cloud: ${err.message}\n`);
    process.exit(1);
}
const app = createApp({ store: dirStore(o.data), publicUrl: o['public-url'], ...config });
const server = await serve(app, { port: Number(o.port), host: o.host });
const { port } = server.address();
process.stderr.write(`siteread-cloud: listening on http://${o.host}:${port}, data in ${o.data}; `
    + `${config.named.size} named row(s), operator page ${config.operatorToken ? `on for ${config.operatorOrigin}` : 'off'}\n`);

const flush = () => app.flushStats().catch(err => process.stderr.write(`siteread-cloud: stats flush failed: ${err.message}\n`));
setInterval(flush, 3_600_000);
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
        server.close();
        await flush();
        process.exit(0);
    });
}

async function job(name, fn) {
    try {
        const r = await fn();
        if (name === 'feed') {
            const { fetched, failed } = r.result;
            process.stderr.write(`siteread-cloud: feed: ${Object.keys(r.feed.lists).length} lists (fetched ${fetched.length}, failed ${failed.length}${failed.length ? `: ${failed.join(', ')}` : ''})\n`);
        } else {
            process.stderr.write(`siteread-cloud: aggregate: ${r.sites} site(s) in ${r.window ? `${r.window.from} → ${r.window.to}` : 'no window yet'}\n`);
        }
    } catch (err) {
        process.stderr.write(`siteread-cloud: ${name} job failed: ${err?.message || err}\n`);
    }
}

if (!o['no-jobs']) {
    await job('feed', app.runFeed);
    await job('aggregate', app.runAggregate);
    setInterval(() => job('feed', app.runFeed), FEED_EVERY_MS);
    setInterval(() => job('aggregate', app.runAggregate), 3_600_000);
}
