// node:http in front of the app's fetch handler, for a Node host and for local runs.
//
// No access log, on purpose: the sender's IP is never read, printed or kept here. A proxy or
// platform in front of this may log it; turning that off is part of choosing the host.

import http from 'node:http';
import { Readable } from 'node:stream';

/** Listen; resolves to the http.Server once it is accepting (port 0 picks a free one). */
export function serve(app, { port = 8787, host = '127.0.0.1' } = {}) {
    const server = http.createServer(async (req, res) => {
        try {
            const headers = new Headers();
            for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
            const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
            const request = new Request(`http://localhost${req.url}`, {
                method: req.method, headers, body: hasBody ? Readable.toWeb(req) : undefined, duplex: 'half',
            });
            const response = await app.fetch(request);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (req.method === 'HEAD' || !response.body) return res.end();
            for await (const chunk of response.body) res.write(chunk);
            res.end();
        } catch {
            if (!res.headersSent) res.writeHead(500);
            res.end();
        }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
    });
}
