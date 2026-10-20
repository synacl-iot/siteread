// Scanner/exploit request paths: what a vulnerability scanner asks for and a real reader never
// does. An IP that asks for one of these is a scanner, whatever User-Agent it wears; that is the
// "444 rule" (nginx answers these with 444, "close, send nothing") the verifier falls back on
// when a vendor publishes no IP list (createVerifier's `isKnownScannerIp`).
//
// Ported from the edge classifier Synacl Labs runs on synacl.com (2026-10), keeping only the
// host-blind, product-agnostic rules; that site's own carve-outs are gone. A site with a real
// path that matches (a /install.sh, a Decap CMS /admin/config.yml) passes `allow`.
//
// Classify on the REQUEST PATH ONLY, never the User-Agent: a scanner whose UA was literally
// "http://<site>/wp-admin/install.php?step=1" made the raw-line version flag itself. Feed it the
// raw request target (nginx's $request_uri: path + query, NOT url-decoded), so the rules below
// see exactly what the edge saw.

export const SCANNER_PATH_RE = new RegExp(
    '(\\/\\.(?!well-known))' +                                        // /.env /.git … but not /.well-known
    '|(\\.(php[0-9]?|phtml|phps|asp|aspx|jsp|jspx|cgi|env|sql|bak|old|backup|swp|ini|sh)(\\?|$))' + // dead tech ext
    '|(^\\/+(wp-|xmlrpc|phpmyadmin|boaform|cgi-bin|HNAP1|SDK\\/webLanguage|' +
    'apply\\.cgi|tmUnblock\\.cgi|GponForm|\\.git|\\.env|actuator(\\/|$)|_ignition|solr\\/|autodiscover))' +
    // Words that are also ordinary slugs (/mysql-vs-postgres, /backup-strategies, /shell-tips) need
    // a segment end after them; the scanner forms (/mysql/, /backup.zip, /shell?cd+/tmp) still match.
    // (The original matched these as bare prefixes: its site had no such pages.) `/vendor/` is not
    // here at all: static sites serve /vendor/*.js, and the scanner hits below it end in .php or a
    // dotfile, which the rules above already catch.
    '|(^\\/+(wordpress|pma|mysql|shell|backups?)(?=[/?.]|$))' +
    // WP-artifact probes bury these deep in the path (//wp-includes/…/license.txt/…) with a leading
    // // to dodge the ^/-anchored rule; these tokens never appear in a legit URL: match anywhere.
    '|(wp-includes|wp-admin|wp-content|wp-login|wlwmanifest|xmlrpc)' +
    // Percent-encoded dot: /%2eenv, /$(pwd)/%2egit/config, /private/smtp%2ejson. Every rule above
    // wants a LITERAL '.', and the raw request target is not url-decoded, so these passed as
    // ordinary traffic until this rule. Path only: [^?]* stops at the first '?' so an encoded
    // query value can't false-positive.
    '|(^[^?]*%2e)' +
    // Secret/config-file scanners: framework and cloud artifacts no site serves on purpose.
    // docker-compose only as a YAML FILE, so a /docker-compose-tutorial/ post is not a probe (the
    // ClaudeBot incident's /…/examples/docker-compose.yml still is).
    '|(appsettings\\.|aws-exports\\.|composer\\.(json|lock)|/_profiler|/phpinfo|launchSettings|' +
    'serviceAccountKey|service-account-credentials|api-keys\\.json|docker-compose(\\.[\\w-]+)?\\.ya?ml|' +
    'config\\.ya?ml|aws\\.ya?ml)' +
    // Dockerfile and credentials.* only as FILES: a route that merely ends in /credentials is a
    // normal API path on plenty of apps.
    '|(/Dockerfile(\\.[a-z]+)?(\\?|$))|(/credentials\\.[a-z]+(\\?|$))',
    'i',
);

/**
 * True when a raw request target (path + query, not url-decoded) is a scanner probe.
 * `allow` (a RegExp tested against the same string) exempts a site's own legit paths.
 */
export function isScannerPath(path, { allow } = {}) {
    if (typeof path !== 'string' || !path) return false;
    if (!SCANNER_PATH_RE.test(path)) return false;
    // search() ignores a /g regex's lastIndex, so a shared global `allow` can't flip-flop.
    if (allow instanceof RegExp && path.search(allow) !== -1) return false;
    return true;
}
