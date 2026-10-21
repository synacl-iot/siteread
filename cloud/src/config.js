// The service's secrets and settings from the environment, parsed once for every entry point
// (bin/serve.js and bin/job.js), so an aggregate run from cron names the same rows as the server.
//
//   SITEREAD_NAMED             {"<share id>": "<public label>"}: sites that chose to be named on the
//                              benchmark. The id is the only credential a share carries, so it is a
//                              secret: errors name an entry by its position, never by its id.
//   SITEREAD_OPERATOR_TOKEN    unlocks GET /v1/operator/status; unset, that route does not exist
//   SITEREAD_OPERATOR_ORIGIN   the one page origin allowed to call it from a browser

import { ID_RE } from '../../packages/verify/src/share.js';

export const MIN_TOKEN_CHARS = 32;
const LABEL_RE = /^[a-z0-9][a-z0-9.-]{0,62}$/i;

/** { named: Map(id → label), operatorToken, operatorOrigin }. Throws on a bad value. */
export function fromEnv(env = {}) {
    const named = new Map();
    if (env.SITEREAD_NAMED) {
        let obj;
        try { obj = JSON.parse(env.SITEREAD_NAMED); } catch { throw new Error('SITEREAD_NAMED is not JSON'); }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('SITEREAD_NAMED must be an object of id → label');
        Object.entries(obj).forEach(([id, label], i) => {
            if (!ID_RE.test(id)) throw new Error(`SITEREAD_NAMED entry ${i + 1}: the id is not 32 lowercase hex digits`);
            if (typeof label !== 'string' || !LABEL_RE.test(label)) throw new Error(`SITEREAD_NAMED entry ${i + 1}: the label must look like a hostname`);
            named.set(id, label);
        });
    }
    const operatorToken = env.SITEREAD_OPERATOR_TOKEN || null;
    if (operatorToken && operatorToken.length < MIN_TOKEN_CHARS) {
        throw new Error(`SITEREAD_OPERATOR_TOKEN must be at least ${MIN_TOKEN_CHARS} characters (openssl rand -hex 32)`);
    }
    let operatorOrigin = 'https://siteread.dev';
    if (env.SITEREAD_OPERATOR_ORIGIN) {
        try { operatorOrigin = new URL(env.SITEREAD_OPERATOR_ORIGIN).origin; } catch { throw new Error('SITEREAD_OPERATOR_ORIGIN is not a URL'); }
    }
    return { named, operatorToken, operatorOrigin };
}
