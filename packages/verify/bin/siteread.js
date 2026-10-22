#!/usr/bin/env node
// siteread CLI. No dependencies; arguments parsed by hand.
//
//   siteread check <ip> "<user-agent>"   exit 0 verified · 2 spoofed · 3 unknown / n/a · 1 usage or error
//   siteread lists
//   siteread digest --gsc <export> --log <file> …   JSON for the seo-read skill's weekly memo
//   siteread share [<digest>]           opt-in: one week's aggregates → the benchmark, where you stand back
//   siteread --help
//
// Lists are cached in one file (os.tmpdir()/siteread/lists.json, or $SITEREAD_CACHE) and
// refetched only when older than 24 h. The only network traffic is GETs of the vendors' lists,
// and `share`, which prints the exact bytes it would send and sends only on a yes.

import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createVerifier, fileStore, detectAgent, detectCrawler, digest, parseGoal, sharePayload, SHARE_METRICS, SHARE_URL, VERSION } from '../src/index.js';

const EXIT = { verified: 0, spoofed: 2, unknown: 3, 'n/a': 3, usage: 1 };
const cacheFile = process.env.SITEREAD_CACHE || path.join(os.tmpdir(), 'siteread', 'lists.json');

const HELP = `siteread ${VERSION}: is that crawler who it says it is?

Usage:
  siteread check <ip> "<user-agent>"   verdict for one request
  siteread lists                       every vendor list: prefixes and when it was fetched
  siteread digest [options]            a Search Console export + access log -> JSON numbers
                                       for a weekly read (the seo-read skill writes the memo)
  siteread share [<digest.json|dir>]   opt-in: send one week of a digest's aggregate numbers
                                       to the public benchmark and see where you stand
                                       (default: the newest digest in .siteread/digests)
  siteread --help | --version

Options:
  --no-cache   refetch every list now (a copy younger than 24 h is otherwise reused;
               a failed fetch still falls back to the cached copy)
  --json       print the full result as JSON

Digest options (at least one of --gsc / --log):
  --gsc <zip|dir>        Search Console Performance export (Export -> Download CSV)
  --log <file>           access log: nginx/Apache combined, Caddy JSON or nginx JSON, .gz ok
                         (repeat for several)
  --host <name>          keep only requests to this host, for a log of several sites (repeatable;
                         JSON logs carry the host, combined does not)
  --site <host>          your site's host (guessed from Referers otherwise)
  --sitemap <file>       a local sitemap.xml: count crawler fetches on its URLs only
  --from / --to <day>    keep only log days in this range (YYYY-MM-DD)
  --split <day>          GSC before/after comparison around a change made that day
  --goal <label=regex>   count people whose "METHOD /path status" matches (repeatable),
                         e.g. --goal 'signup=^POST /signup 2'
  --team-path <regex>    an IP that got a 2xx on such a path is your team, not a reader
  --exclude-ip <ip,...>  more IPs that are you (repeatable)
  --allow-path <regex>   your real paths that look like scanner probes (/install.sh)
  --tz <zone>            zone for log days (default America/Los_Angeles, GSC's)
  --prev <digest.json>   an earlier digest: GSC rows gain last read's numbers
  --out <dir>            write <dir>/<last day>.json instead of stdout, and use the newest
                         earlier digest in <dir> as --prev unless --prev is given
  --limit <n>            rows per table (default 25)
  --offline              use cached vendor lists only; no network at all

Share options (prints the exact payload first, then asks; never hostnames, URLs or IPs):
  --dry-run              print the payload and stop
  --yes                  send without asking (scripts; without a terminal it is required)
  --endpoint <url>       where to send it (default ${SHARE_URL}, or $SITEREAD_SHARE_URL)
  --id-file <file>       this site's random id (default .siteread/share-id, made on first use;
                         delete it to start over as a new site)

Exit codes (check):
  0 verified   the IP is in the vendor's published list for that agent
  2 spoofed    the vendor publishes a list and the IP is not in it
  3 unknown    no list to check against, or the UA is not a known AI agent or crawler
  1            usage error, or not an IP address

Cache: ${cacheFile}  (override with SITEREAD_CACHE)
Nothing leaves this machine except GETs of the vendors' public IP lists, and a share you approve.`;

// Options that take a value (digest only). Each keeps every value given, in order.
const VALUE_OPTS = new Set(['--gsc', '--log', '--out', '--site', '--sitemap', '--from', '--to', '--split', '--goal',
    '--team-path', '--exclude-ip', '--allow-path', '--tz', '--prev', '--limit', '--endpoint', '--id-file', '--host']);

function parseArgs(argv) {
    const flags = new Set();
    const opts = new Map();
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        let a = argv[i];
        if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
        let val;
        const eq = a.indexOf('=');
        if (a.startsWith('--') && eq > 0 && VALUE_OPTS.has(a.slice(0, eq))) { val = a.slice(eq + 1); a = a.slice(0, eq); }
        if (VALUE_OPTS.has(a)) {
            if (val === undefined) {
                if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
                val = argv[++i];
            }
            if (!opts.has(a)) opts.set(a, []);
            opts.get(a).push(val);
        } else if (a.startsWith('--') || a === '-h' || a === '-v') flags.add(a);
        else pos.push(a);
    }
    return { flags, opts, pos };
}

class UsageError extends Error {}

function usage(msg) {
    process.stderr.write(`siteread: ${msg}\nRun "siteread --help" for usage.\n`);
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
        process.stderr.write(`siteread: could not refresh ${agent}: ${result.errors?.[agent] || 'failed'} (${kept})\n`);
    }
    if (result.error) process.stderr.write(`siteread: cache ${cacheFile}: ${result.error}\n`);
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

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function cmdDigest({ flags, opts, pos }) {
    if (pos.length !== 1) return usage('digest takes options only, e.g. digest --gsc export.zip --log access.log');
    const one = k => opts.get(k)?.at(-1) ?? null;
    const logs = opts.get('--log') ?? [];
    const gsc = one('--gsc');
    if (!gsc && !logs.length) return usage('digest needs --gsc <export>, --log <file>, or both');
    for (const k of ['--from', '--to', '--split']) if (one(k) && !DAY_RE.test(one(k))) return usage(`${k} wants YYYY-MM-DD`);
    const re = (k) => {
        if (!one(k)) return null;
        try { return new RegExp(one(k), 'i'); } catch (err) { throw new UsageError(`${k}: ${err.message}`); }
    };
    let goals;
    try { goals = (opts.get('--goal') ?? []).map(parseGoal); } catch (err) { return usage(err.message); }
    const tz = one('--tz') ?? 'America/Los_Angeles';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { return usage(`--tz: unknown time zone "${tz}"`); }
    const limit = one('--limit') ? Number(one('--limit')) : 25;
    if (!Number.isInteger(limit) || limit < 1) return usage('--limit wants a positive whole number');
    let prev = null;
    if (one('--prev')) {
        try { prev = JSON.parse(readFileSync(one('--prev'), 'utf8')); } catch (err) { return usage(`--prev: ${err.message}`); }
    }

    let verifier = null;
    if (logs.length) {
        verifier = createVerifier({ store: fileStore(cacheFile), log: {} });
        if (flags.has('--offline')) {
            await verifier.load();
        } else {
            reportFailures(await verifier.refresh({ force: flags.has('--no-cache') }), verifier);
        }
        if (!verifier.lists().some(l => l.prefixes)) {
            process.stderr.write('siteread: no vendor lists available; every crawler will read as unknown\n');
        }
    }

    const out = await digest({
        gsc, logs, verifier, prev, limit,
        split: one('--split'), sitemapFile: one('--sitemap'),
        site: one('--site'), tz, from: one('--from'), to: one('--to'), goals,
        teamPath: re('--team-path'), allowPath: re('--allow-path'),
        excludeIps: new Set((opts.get('--exclude-ip') ?? []).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean)),
        hosts: opts.get('--host') ?? [],
    });
    if (verifier) out.vendorLists = verifier.lists().map(({ agent, prefixes, fetchedAt }) => ({ agent, prefixes, fetchedAt }));
    for (const w of out.warnings) process.stderr.write(`siteread: ${w}\n`);
    const dir = one('--out');
    if (!dir) {
        process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
        return 0;
    }
    // Named for the last day the read covers, which is only known now (GSC's lag is cut first).
    const name = `${out.gsc?.range.to ?? out.log?.range.to ?? 'empty'}.json`;
    mkdirSync(dir, { recursive: true });
    if (!prev && gsc) {
        const earlier = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < name).sort().at(-1);
        if (earlier) {
            const file = path.join(dir, earlier);
            const again = await digest({ gsc, prev: JSON.parse(readFileSync(file, 'utf8')), split: one('--split'), limit });
            out.gsc = again.gsc;
            out.prevFile = earlier;
        }
    }
    const file = path.join(dir, name);
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    process.stderr.write(`siteread: wrote ${file}${out.prevFile ? ` (compared with ${out.prevFile})` : ' (no earlier digest to compare with)'}\n`);
    process.stdout.write(`${file}\n`);
    return 0;
}

const USER_AGENT = `siteread/${VERSION} (+https://www.npmjs.com/package/siteread)`;
const DIGEST_RE = /^\d{4}-\d{2}-\d{2}\.json$/;
// A server's words go to the terminal: no escape sequences from someone else's endpoint.
const clean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
const BAND_TEXT = Object.freeze({
    'below-p25': 'below the 25th percentile', 'p25-p50': '25th to 50th percentile',
    'p50-p75': '50th to 75th percentile', 'p75-up': '75th percentile or above',
});

/** The site's random share id, made (0600) on first use. */
function shareId(file) {
    let id;
    try { id = readFileSync(file, 'utf8').trim(); } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        id = randomBytes(16).toString('hex');
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${id}\n`, { mode: 0o600, flag: 'wx' });
        process.stderr.write(`siteread: made a random id for this site in ${file} (delete it to start over as a new site)\n`);
    }
    if (!/^[0-9a-f]{32}$/.test(id)) throw new UsageError(`${file} does not hold a share id; delete it to make a new one`);
    return id;
}

// Plain http only to this machine: a share crosses the internet over TLS or not at all.
function endpointOk(raw) {
    let u;
    try { u = new URL(raw); } catch { return false; }
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

async function cmdShare({ flags, opts, pos }) {
    if (pos.length > 2) return usage('share takes at most one digest file or folder');
    const one = k => opts.get(k)?.at(-1) ?? null;
    let file = pos[1] ?? path.join('.siteread', 'digests');
    if (statSync(file).isDirectory()) {
        const newest = readdirSync(file).filter(f => DIGEST_RE.test(f)).sort().at(-1);
        if (!newest) return usage(`no digest (YYYY-MM-DD.json) in ${file}; run "siteread digest --out ${file}" first`);
        file = path.join(file, newest);
    }
    let d;
    try { d = JSON.parse(readFileSync(file, 'utf8')); } catch (err) { return usage(`${file}: ${err.message}`); }
    const endpoint = one('--endpoint') ?? process.env.SITEREAD_SHARE_URL ?? SHARE_URL;
    if (!endpointOk(endpoint)) return usage(`--endpoint must be an https:// URL (plain http only to localhost): ${endpoint}`);

    let built;
    try { built = sharePayload(d, { id: shareId(one('--id-file') ?? path.join('.siteread', 'share-id')) }); } catch (err) {
        if (err instanceof UsageError) throw err;
        process.stderr.write(`siteread: share: ${err.message}\n`);
        return 1;
    }
    // These exact bytes are what goes over the wire: print, then send the same string.
    const body = JSON.stringify(built.payload, null, 2);
    process.stderr.write(`siteread: the whole payload from ${file}, byte for byte, for ${endpoint}:\n`);
    process.stdout.write(`${body}\n`);
    for (const n of built.notes) process.stderr.write(`siteread: ${n}\n`);
    if (flags.has('--dry-run')) { process.stderr.write('siteread: not sent (--dry-run)\n'); return 0; }
    if (!flags.has('--yes')) {
        if (!process.stdin.isTTY) { process.stderr.write('siteread: not sent: no terminal to ask on; pass --yes to send it\n'); return 1; }
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        const answer = await rl.question('Send it? [y/N] ');
        rl.close();
        if (!/^y(es)?$/i.test(answer.trim())) { process.stderr.write('siteread: not sent\n'); return 0; }
    }

    let res, r = null;
    try {
        res = await fetch(endpoint, {
            method: 'POST', body, signal: AbortSignal.timeout(15_000),
            headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
        });
        try { r = JSON.parse(await res.text()); } catch { r = null; }
    } catch (err) {
        process.stderr.write(`siteread: could not reach ${endpoint}: ${err.cause?.code || err.message}\n`);
        return 1;
    }
    if (!res.ok || r?.ok !== true) {
        process.stderr.write(`siteread: ${endpoint} did not take it: HTTP ${res.status}${r?.error ? `: ${clean(r.error)}` : ''}\n`);
        return 1;
    }
    // Where each number falls among the quartiles the benchmark publishes, and only where it
    // publishes them: the service never answers finer than the public page (cloud/src/benchmark.js).
    const a = r.against;
    const min = Number(a?.minSites) || 10;
    const rows = Object.entries(r.metrics ?? {}).filter(([, m]) => m && typeof m === 'object');
    const where = m => BAND_TEXT[m.band] ?? `${Number(m.sites) || 0} site${Number(m.sites) === 1 ? '' : 's'}; shown from ${min}`;
    const w = Math.max(6, ...rows.map(([k]) => k.length));
    const ww = Math.max(5, ...rows.map(([, m]) => where(m).length));
    const out = [
        a
            ? `sent ${clean(r.week)}. Against the benchmark built ${clean(a.generatedAt).slice(0, 16).replace('T', ' ')} UTC: ${Number(a.sites) || 0} anonymous site${Number(a.sites) === 1 ? '' : 's'}, ${clean(a.window?.from)} to ${clean(a.window?.to)}`
            : `sent ${clean(r.week)}. The benchmark has not been built yet; it is rebuilt every hour.`,
        '',
        `${'metric'.padEnd(w)}  ${'yours'.padStart(9)}  ${'where'.padEnd(ww)}`,
        ...rows.map(([k, m]) => `${clean(k).padEnd(w)}  ${clean(m.value).padStart(9)}  ${where(m).padEnd(ww)}`.trimEnd()
            + (SHARE_METRICS[k]?.lowerIsBetter && m.band ? '  (lower is better)' : '')),
    ];
    if (!rows.some(([, m]) => m.band)) out.push('', `No number has ${min} anonymous sites yet, so none shows where you stand; your share counts toward them.`);
    if (r.benchmark) out.push('', `benchmark: ${clean(r.benchmark)}`);
    process.stdout.write(`${out.join('\n')}\n`);
    return 0;
}

async function main(argv) {
    let args;
    try { args = parseArgs(argv); } catch (err) { if (err instanceof UsageError) return usage(err.message); throw err; }
    const { flags, pos } = args;
    if (flags.has('--help') || flags.has('-h') || pos[0] === 'help') { process.stdout.write(`${HELP}\n`); return 0; }
    if (flags.has('--version') || flags.has('-v')) { process.stdout.write(`${VERSION}\n`); return 0; }
    const known = new Set(['--no-cache', '--json', '--offline', '--dry-run', '--yes']);
    const bad = [...flags].find(f => !known.has(f));
    if (bad) return usage(`unknown option ${bad}`);
    if (pos[0] === 'check') return cmdCheck(args);
    if (pos[0] === 'lists') return cmdLists(args);
    if (pos[0] === 'digest') {
        try { return await cmdDigest(args); } catch (err) {
            if (err instanceof UsageError) return usage(err.message);
            if (err?.code === 'ENOENT') return usage(`no such file: ${err.path}`);
            // Bad input (an export with no Dates.csv, a broken zip): say what, no stack trace.
            process.stderr.write(`siteread: digest: ${err?.message || err}\n`);
            return 1;
        }
    }
    if (pos[0] === 'share') {
        try { return await cmdShare(args); } catch (err) {
            if (err instanceof UsageError) return usage(err.message);
            if (err?.code === 'ENOENT') return usage(`no such file: ${err.path}`);
            process.stderr.write(`siteread: share: ${err?.message || err}\n`);
            return 1;
        }
    }
    if (!pos.length) { process.stdout.write(`${HELP}\n`); return EXIT.usage; }
    return usage(`unknown command "${pos[0]}"`);
}

main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => { process.stderr.write(`siteread: ${err?.stack || err}\n`); process.exitCode = 1; },
);
