import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isScannerPath } from '../src/index.js';

test('scanner probes are flagged', () => {
    for (const p of [
        '/wp-login.php',
        '/%2eenv',                                   // percent-encoded dot
        '/$(pwd)/%2egit/config',
        '/private/smtp%2ejson',
        '/.env', '/.git/config', '/.aws/credentials', '/api/.env',
        '/xmlrpc.php', '//wp-includes/js/tinymce/license.txt',
        '/wordpress/wp-admin/setup-config.php',
        '/index.php?s=/Index/think', '/admin.asp', '/login.jsp', '/test.cgi', '/db.sql', '/site.bak',
        '/phpmyadmin/', '/pma/', '/mysql/admin/', '/cgi-bin/luci', '/boaform/admin/formLogin',
        '/HNAP1', '/GponForm/diag_Form', '/actuator/env', '/_ignition/execute-solution',
        '/solr/admin/info/system', '/autodiscover/autodiscover.xml',
        '/shell?cd+/tmp', '/backup.zip', '/backups/', '/backup',
        '/appsettings.json', '/aws-exports.js', '/composer.json', '/_profiler/phpinfo', '/phpinfo',
        '/serviceAccountKey.json', '/api-keys.json', '/config.yml', '/aws.yaml',
        '/protocol//blob/master/examples/docker-compose.yml',   // the ClaudeBot README-link path
        '/docker-compose.prod.yaml',
        '/Dockerfile', '/app/Dockerfile.dev', '/credentials.json', '/config/credentials.yml?x=1',
    ]) {
        assert.equal(isScannerPath(p), true, p);
    }
});

test('key, archive, log, leftover, credential, build-config, internals and WordPress probes are flagged', () => {
    for (const p of [
        // keys and keystores
        '/config/master.key', '/id_rsa', '/id_ed25519.pub', '/server.key', '/ssl/localhost.key', '/key.pem',
        '/cert.p12', '/release.keystore', '/putty.ppk',
        // whole-site archives at the root, and SQL dumps anywhere
        '/site.zip', '/www.tar.gz', '/public_html.zip', '/htdocs.rar', '/backup-2025.sql.gz', '/db_backup.zip',
        '/backup_site.7z', '/wwwroot.tgz', '/dump.sql.gz', '/exports/users.sql.gz', '/site.zip?download=1',
        // logs
        '/storage/logs/laravel.log', '/storage/logs/laravel-2024.log', '/logs/error.log', '/debug.log',
        // editor and deploy leftovers
        '/config.php.save', '/config.php~', '/index.php.orig', '/wp-config.php.swo', '/settings.php.copy',
        '/phpunit.xml.dist', '/env~',
        // cloud credential files
        '/secrets.json', '/key.json', '/sa.json', '/keyfile.json', '/config/secrets.json',
        '/service-account.json', '/app/service_account_prod.json', '/firebase-adminsdk.json',
        '/google-credentials.json', '/google-services.json', '/application_default_credentials.json',
        '/gcp-key.json', '/private-key.json', '/client_secret.json',
        // build and infrastructure config
        '/terraform.tfstate', '/prod.tfvars', '/serverless.yml', '/config/secrets.yml', '/kubernetes/secrets.yaml',
        '/netlify.toml', '/vercel.json', '/turbo.json', '/pnpm-workspace.yaml', '/sentry.properties',
        '/Dockerrun.aws.json',
        // server internals
        '/_debugbar/open', '/@fs/proc/self/environ', '/proc/self/cmdline',
        '/var/run/secrets/kubernetes.io/serviceaccount/token', '/..;/etc/passwd', '/etc/passwd%00',
        // WordPress under a prefix
        '/blog/wp-json/batch/v1', '/news/wp-json/', '/wp/', '/wp/wp-json/',
    ]) {
        assert.equal(isScannerPath(p), true, p);
    }
});

test('real downloads, framework fetches, API routes and slugs near those probes are not flagged', () => {
    for (const p of [
        // downloads and search-engine fetches
        '/sitemap.xml.gz', '/sitemap-posts.xml.gz', '/press-kit.zip', '/downloads/app.zip', '/latest.zip',
        '/releases/v1.2.0/source.tar.gz', '/fonts/inter.woff2',
        // Nuxt fetches this on every client-side navigation
        '/_payload.json', '/blog/hello-world/_payload.json',
        // an app's own JSON routes
        '/api/projects/42/key.json', '/api/v1/secrets.json', '/users/7/sa.json', '/v1/topics.json',
        // slugs and pages
        '/changelog', '/blog/', '/catalog.json', '/blog/ssh-keys', '/keynote-tips/', '/~jane/', '/~jane/notes',
        '/blog/etc/passwd-explained', '/docs/var/run/secrets-management', '/docs/terraform/', '/wpx', '/wp',
        '/blog/how-to-read-a-log-file/', '/guides/dist-folder/',
        // a probe word in the QUERY is not a probe
        '/search?q=/etc/passwd', '/search?q=error.log', '/download?file=site.zip', '/s?q=wp-json',
    ]) {
        assert.equal(isScannerPath(p), false, p);
    }
});

test('real pages are not flagged', () => {
    for (const p of [
        '/', '/blog/', '/guides/esp32-modbus/',
        '/.well-known/x', '/.well-known/security.txt', '/.well-known/acme-challenge/abc',
        '/env.js',                                   // a real file on plenty of sites
        '/assets/app.js', '/sitemap.xml', '/robots.txt', '/llms.txt', '/favicon.ico',
        '/help/actuators-onoff/',                    // /actuator is anchored to a segment
        '/mysql-vs-postgres/', '/backup-strategies', '/shell-scripting-tips', '/wordpress-vs-ghost',
        '/docker-compose-tutorial/', '/blog/docker-compose-for-beginners',
        '/vendor/bootstrap.min.js',                  // static sites serve /vendor/
        '/api/gateway/42/credentials', '/settings/credentials',   // a route, not a credentials FILE
        '/search?q=%2e%2e',                          // an encoded dot in the QUERY is not a probe
        '/configure', '/config', '/docs/configuration.html',
    ]) {
        assert.equal(isScannerPath(p), false, p);
    }
});

test('allow exempts a site\'s own legit paths, and only those', () => {
    const allow = /^\/(install\.sh|admin\/config\.yml)(\?|$)/;
    assert.equal(isScannerPath('/install.sh'), true);
    assert.equal(isScannerPath('/install.sh', { allow }), false);
    assert.equal(isScannerPath('/admin/config.yml', { allow }), false);
    assert.equal(isScannerPath('/wp-login.php', { allow }), true);
    // A /g regex shared across calls must not flip-flop on lastIndex.
    const g = /install\.sh/g;
    for (let i = 0; i < 3; i++) assert.equal(isScannerPath('/install.sh', { allow: g }), false);
});

test('non-strings are not scanner paths', () => {
    for (const p of [undefined, null, '', 42, {}]) assert.equal(isScannerPath(p), false);
});
