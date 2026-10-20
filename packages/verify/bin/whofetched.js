#!/usr/bin/env node
// whofetched CLI. No dependencies; arguments parsed by hand.
//
//   whofetched check <ip> "<user-agent>"   exit 0 verified · 2 spoofed · 3 unknown / n/a · 1 usage or error
//   whofetched lists
//   whofetched --help
//
// Lists are cached in one file (os.tmpdir()/whofetched/lists.json, or $WHOFETCHED_CACHE) and
// refetched only when older than 24 h. The only network traffic is GETs of the vendors' lists.

import os from 'node:os';
import path from 'node:path';
import { createVerifier, fileStore, detectAgent, detectCrawler, VERSION } from '../src/index.js';

const EXIT = { verified: 0, spoofed: 2, unknown: 3, 'n/a': 3, usage: 1 };
const cacheFile = process.env.WHOFETCHED_CACHE || path.join(os.tmpdir(), 'whofetched', 'lists.json');

const HELP = `whofetched ${VERSION}: is that crawler who it says it is?

Usage:
  whofetched check <ip> "<user-agent>"   verdict for one request
  whofetched lists                       every vendor list: prefixes and when it was fetched
  whofetched --help | --version

Options:
  --no-cache   refetch every list now (a copy younger than 24 h is otherwise reused;
               a failed fetch still falls back to the cached copy)
  --json       print the full result as JSON

Exit codes (check):
  0 verified   the IP is in the vendor's published list for that agent
  2 spoofed    the vendor publishes a list and the IP is not in it
  3 unknown    no list to check against, or the UA is not a known AI agent or crawler
  1            usage error, or not an IP address

Cache: ${cacheFile}  (override with WHOFETCHED_CACHE)
Nothing leaves this machine except GETs of the vendors' public IP lists.`;

function parseArgs(argv) {
    const flags = new Set();
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
        if (a.startsWith('--') || a === '-h' || a === '-v') flags.add(a);
        else pos.push(a);
    }
    return { flags, pos };
}

function usage(msg) {
    process.stderr.write(`whofetched: ${msg}\nRun "whofetched --help" for usage.\n`);
    return EXIT.usage;
}

function when(iso) {
    return iso ? iso.replace(/\.\d{3}Z$/, 'Z') : 'never';
}

// Short host+path for one-line output: https://claude.com/crawling/bots.json → claude.com/crawling/bots.json
function shortUrl(u) {
    return String(u || '').replace(/^https?:\/\//, '');
}

function reportFailures(result, verifier) {
    const failed = [...new Set(result.failed)];
    if (!failed.length && !result.error) return;
    const held = new Map(verifier.lists().map(l => [l.agent, l]));
    for (const agent of failed) {
        const l = held.get(agent);
        const kept = l?.prefixes ? `kept the copy from ${when(l.fetchedAt)}` : 'no copy to fall back on';
        process.stderr.write(`whofetched: could not refresh ${agent}: ${result.errors?.[agent] || 'failed'} (${kept})\n`);
    }
    if (result.error) process.stderr.write(`whofetched: cache ${cacheFile}: ${result.error}\n`);
}

function describe(ip, ua, r, list) {
    const who = r.assistant ? `${r.agent} (${r.assistant}, ${r.purpose})` : `${r.agent} (${r.purpose})`;
    switch (r.reason) {
        case 'in-vendor-list':
            return `verified  ${ip} is ${who}: in ${shortUrl(r.source)} (${list.prefixes} prefixes, fetched ${when(list.fetchedAt)})`;
        case 'not-in-vendor-list':
            return `spoofed   ${ip} claims ${who} but is not in ${shortUrl(r.source)} (${list.prefixes} prefixes, fetched ${when(list.fetchedAt)})`;
        case 'robots-token-not-a-user-agent':
            return `spoofed   ${ip} claims ${who}: Google-Extended is a robots.txt token, never a real user-agent`;
        case 'known-scanner-ip':
            return `spoofed   ${ip} claims ${who} and has probed scanner paths`;
        case 'list-unavailable':
            return `unknown   ${ip} claims ${who}: could not load ${shortUrl(r.source)} and no cached copy`;
        case 'no-vendor-list': {
            const e = detectAgent(ua) || detectCrawler(ua);
            const why = e?.note ? `${e.note}` : 'its operator publishes no IP list';
            return `unknown   ${ip} claims ${who}: ${why}. If this IP also requested scanner paths in your log, treat it as spoofed`;
        }
        default:
            return `n/a       "${ua}" is not a known AI agent or search crawler`;
    }
}

async function cmdCheck({ flags, pos }) {
    if (pos.length !== 3) return usage('check takes exactly two arguments: <ip> "<user-agent>" (quote the user-agent)');
    const [, ip, ua] = pos;
    const verifier = createVerifier({ store: fileStore(cacheFile), log: {} });
    let r = verifier.check(ip, ua);
    if (r.reason === 'invalid-ip') return usage(`"${ip}" is not an IP address`);
    // Only touch the network when the claimed agent has a list to check against.
    if (r.source) {
        const result = await verifier.refresh({ force: flags.has('--no-cache') });
        reportFailures(result, verifier);
        r = verifier.check(ip, ua);
    }
    const list = verifier.lists().find(l => l.agent === r.agent) || {};
    if (flags.has('--json')) {
        process.stdout.write(`${JSON.stringify({ ip, userAgent: ua, ...r, list: r.source ? list : null }, null, 2)}\n`);
    } else {
        process.stdout.write(`${describe(ip, ua, r, list)}\n`);
    }
    return EXIT[r.verdict] ?? EXIT.usage;
}

async function cmdLists({ flags, pos }) {
    if (pos.length !== 1) return usage('lists takes no arguments');
    const verifier = createVerifier({ store: fileStore(cacheFile), log: {} });
    const result = await verifier.refresh({ force: flags.has('--no-cache') });
    reportFailures(result, verifier);
    const rows = verifier.lists();
    if (flags.has('--json')) {
        process.stdout.write(`${JSON.stringify({ cache: cacheFile, lists: rows }, null, 2)}\n`);
    } else {
        const w = Math.max(...rows.map(l => l.agent.length), 5);
        const out = [`${'agent'.padEnd(w)}  prefixes  fetched (UTC)         source`];
        for (const l of rows) {
            out.push(`${l.agent.padEnd(w)}  ${String(l.prefixes).padStart(8)}  ${when(l.fetchedAt).padEnd(20)}  ${l.url}`);
        }
        process.stdout.write(`${out.join('\n')}\n`);
    }
    return rows.some(l => l.prefixes) ? 0 : 1;
}

async function main(argv) {
    const args = parseArgs(argv);
    const { flags, pos } = args;
    if (flags.has('--help') || flags.has('-h') || pos[0] === 'help') { process.stdout.write(`${HELP}\n`); return 0; }
    if (flags.has('--version') || flags.has('-v')) { process.stdout.write(`${VERSION}\n`); return 0; }
    const known = new Set(['--no-cache', '--json']);
    const bad = [...flags].find(f => !known.has(f));
    if (bad) return usage(`unknown option ${bad}`);
    if (pos[0] === 'check') return cmdCheck(args);
    if (pos[0] === 'lists') return cmdLists(args);
    if (!pos.length) { process.stdout.write(`${HELP}\n`); return EXIT.usage; }
    return usage(`unknown command "${pos[0]}"`);
}

main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { process.stderr.write(`whofetched: ${err?.stack || err}\n`); process.exitCode = 1; },
);
