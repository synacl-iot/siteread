// The siteread.dev server: Angular's SSR engine on plain node:http, no framework.
//
//   PORT (4000), HOST (127.0.0.1), SITEREAD_API_INTERNAL (http://127.0.0.1:8787, app.config.server.ts)
//
// PRIVACY. There is no access log, here or anywhere in this file: a request's address, path and
// user-agent are never written. A render failure logs the error message, nothing about who asked.
//
// Static files come from a map built once at startup from dist/site/browser, matched exactly:
// no path is ever joined onto the folder at request time, so no "../" can walk out of it. HTML
// is left to the engine, which serves the prerendered pages itself with their route headers.

import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const browserDist = join(import.meta.dirname, '../browser');

// Run as the server, or imported by the build (to list routes) and by `ng serve`? Angular's
// isMainModule compares the start path as written, and the VM starts this file through the
// `current` symlink while Node reports the resolved path: it said no, and the process exited 0.
const isMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
const engine = new AngularNodeAppEngine();

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Every response: no framing, no sniffing, no referrer sent to the sites this one links to.
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'cross-origin-opener-policy': 'same-origin',
};

interface StaticFile { body: Buffer; type: string; cache: string }

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** URL path → file, read into memory once: the whole static set is a few hundred KB. */
export function staticFiles(root: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  for (const p of walk(root)) {
    const ext = p.slice(p.lastIndexOf('.'));
    const type = TYPES[ext];
    if (!type || !statSync(p).isFile()) continue;
    const url = '/' + relative(root, p).split(sep).join('/');
    // The build hashes its bundle names (main-ABC123.js), so those never change; fonts and the
    // rest of public/ keep their names and are revalidated after a day.
    const hashed = /-[A-Z0-9]{8,}\.(js|css)$/.test(url);
    files.set(url, {
      body: readFileSync(p),
      type,
      cache: hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    });
  }
  return files;
}

// Built only when this file runs as the server: the build also imports it, to list the routes,
// before browser/ exists, and under `ng serve` the dev server serves those files itself.
const files = isMain ? staticFiles(browserDist) : new Map<string, StaticFile>();

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: Buffer | string) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) {
  const method = req.method ?? 'GET';
  const path = (req.url ?? '/').split('?')[0];
  const file = files.get(path);
  if (file && (method === 'GET' || method === 'HEAD')) {
    return send(res, 200, { 'content-type': file.type, 'content-length': String(file.body.length), 'cache-control': file.cache },
      method === 'HEAD' ? undefined : file.body);
  }
  try {
    const response = await engine.handle(req);
    if (response) {
      for (const [k, v] of Object.entries(SECURITY)) if (!response.headers.has(k)) response.headers.set(k, v);
      return await writeResponseToNodeResponse(response, res);
    }
    if (next) return next();
    send(res, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=60' }, 'not found\n');
  } catch (err) {
    if (next) return next(err);
    process.stderr.write(`siteread-site: render failed: ${err instanceof Error ? err.message : String(err)}\n`);
    if (!res.headersSent) send(res, 500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'internal error\n');
    else res.end();
  }
}

if (isMain) {
  const port = Number(process.env['PORT'] || 4000);
  const host = process.env['HOST'] || '127.0.0.1';
  const server = createServer((req, res) => void handle(req, res));
  server.listen(port, host, () => process.stderr.write(`siteread-site: listening on http://${host}:${port}\n`));
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.once(sig, () => server.close(() => process.exit(0)));
}

/** For `ng serve` and the build's route extraction. */
export const reqHandler = createNodeRequestHandler(handle);
