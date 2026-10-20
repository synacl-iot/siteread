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
