/*
 * THE COOKIE TRIAL (Luke, 2026-11-27: Firefox "straight from our site", after a trial). Before any Firefox port: does a site stay signed in when it
 * is framed in an extension's own page, and does the browser let the extension lift the site's no-framing rule there? One small trial extension, the
 * same files in every browser, and a pretend https shop this script serves. The shop sets its session cookie four ways in an ordinary tab (no
 * SameSite, Lax, None; Secure, Strict), answers every page with X-Frame-Options: DENY and frame-ancestors 'none', and writes down the cookies each
 * request brought: the table is the shop's own record, not what a driver thinks it saw. Signs in to nothing real.
 *
 *   node scripts/trial-own-eye-cookies.cjs --browser edge
 *   node scripts/trial-own-eye-cookies.cjs --browser chrome --exe <chrome.exe>
 *   node scripts/trial-own-eye-cookies.cjs --browser firefox --exe <firefox.exe>      (Total Cookie Protection as it ships: on)
 *   ... --json <file> writes the record beside the table.
 */
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchFirefox, sleep } = require('./marionette.cjs');

const arg = (name) => {
  const at = process.argv.indexOf('--' + name);
  return at === -1 ? null : process.argv[at + 1];
};
const BROWSER = arg('browser') ?? 'edge';
const SHOP = 'https://www.shoptrial.test';
const TOP = 'https://www.machinesite.test';
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
const COOKIES = ['plain', 'lax', 'none', 'strict'];
const GECKO_ID = 'trial@debaser.site';

/* The trial extension: a page of its own that frames the shop, and the worker's real rule (worker.js frameRule), in three shapes. */
const EXTENSION = {
  'manifest.json': JSON.stringify({
    manifest_version: 3,
    name: 'DEBASER COOKIE TRIAL',
    version: '0.0.1',
    permissions: ['declarativeNetRequestWithHostAccess'],
    host_permissions: ['https://shoptrial.test/*', 'https://*.shoptrial.test/*'],
    // Chromium reads the worker and Firefox the scripts: one manifest for both.
    background: { service_worker: 'worker.js', scripts: ['worker.js'] },
    browser_specific_settings: { gecko: { id: GECKO_ID, strict_min_version: '128.0' } },
  }),
  'worker.js': '// Nothing: the page sets the rule itself.\n',
  'trial.html': '<!doctype html><meta charset="utf-8"><title>trial</title><meta name="referrer" content="no-referrer"><pre id="out"></pre><script src="trial.js"></script>',
  'trial.js': `
const api = globalThis.browser ?? chrome;
const asked = new URLSearchParams(location.search);
const note = (words) => { document.getElementById('out').textContent += words + '\\n'; new Image().src = '${SHOP}/note?run=' + asked.get('run') + '&words=' + encodeURIComponent(words); };
(async () => {
  const tab = await api.tabs.getCurrent();
  const host = new URL(api.runtime.getURL('')).hostname;
  const shape = asked.get('rule');
  const condition = { tabIds: [tab.id], requestDomains: ['shoptrial.test'], excludedRequestDomains: ['accounts.shoptrial.test'], resourceTypes: ['sub_frame'] };
  if (shape === 'A') condition.initiatorDomains = [api.runtime.id, 'machinesite.test', 'shoptrial.test'];
  if (shape === 'B') condition.initiatorDomains = [host, 'machinesite.test', 'shoptrial.test'];
  try {
    const old = (await api.declarativeNetRequest.getSessionRules()).map((rule) => rule.id);
    await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: old, addRules: shape === 'off' ? [] : [{ id: 1, priority: 1, condition, action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation: 'remove' }] } }] });
    note('rule ' + shape + ': set');
  } catch (error) {
    note('rule ' + shape + ': REFUSED ' + error.message);
  }
  note('leave for the shop: ' + (await api.permissions.contains({ origins: ['https://*.shoptrial.test/*'] })) + ' · id ' + api.runtime.id + ' · host ' + host);
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', '${SANDBOX}');
  frame.referrerPolicy = 'no-referrer-when-downgrade';
  frame.src = asked.get('frame');
  document.body.append(frame);
})();
`,
};

/** A page of the shop: it says what it reads, asks itself for something, sets a cookie of its own, and follows a link once. */
const shopPage = (run, page, prefix) => `<!doctype html><title>Shop ${page}</title><p id="page">${page}</p><a id="next" href="${prefix}/second?run=${run}">second</a><script>
document.cookie = 'js_${run.replace(/[^a-z]/gi, '')}=1; path=/';
fetch('/report?run=${run}&page=${page}&read=' + encodeURIComponent(document.cookie)).then(() => { if ('${page}' === 'first') document.getElementById('next').click(); });
</script>`;

function serve(dir) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=pretend', '-addext', 'subjectAltName=DNS:*.shoptrial.test,DNS:*.machinesite.test'], { stdio: 'ignore' });
  const record = [];
  const handler = (request, answer) => {
    const host = (request.headers.host ?? '').split(':')[0];
    const url = new URL(request.url, 'https://' + host);
    const run = url.searchParams.get('run') ?? '';
    const sent = request.headers.cookie ?? '';
    if (host === 'www.machinesite.test') return answer.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>the pretend BROWSER page</title><iframe sandbox="${SANDBOX}" src="${url.searchParams.get('src') ?? 'about:blank'}"></iframe>`);
    if (url.pathname === '/signin') return answer.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['plain=1; Path=/', 'lax=1; SameSite=Lax; Path=/', 'none=1; SameSite=None; Secure; Path=/', 'strict=1; SameSite=Strict; Path=/'] }).end('<title>in</title>in');
    if (url.pathname === '/note') {
      record.push({ run, kind: 'note', words: url.searchParams.get('words') ?? '', sent });
      return answer.writeHead(204).end();
    }
    if (url.pathname === '/report') {
      record.push({ run, kind: 'ask:' + url.searchParams.get('page'), sent, read: url.searchParams.get('read') ?? '' });
      return answer.writeHead(204).end();
    }
    const open = url.pathname.startsWith('/open/');
    const page = url.pathname.endsWith('/second') ? 'second' : 'first';
    if (!/\/(?:first|second)$/.test(url.pathname)) return answer.writeHead(404).end();
    record.push({ run, kind: 'page:' + page, sent, fetchSite: request.headers['sec-fetch-site'] ?? '' });
    const headers = { 'content-type': 'text/html', 'cache-control': 'no-store', 'set-cookie': `set_${run.replace(/[^a-z]/gi, '')}_${page}=1; SameSite=Lax; Path=/` };
    if (!open) Object.assign(headers, { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
    return answer.writeHead(200, headers).end(shopPage(run, page, open ? '/open' : ''));
  };
  const options = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  const servers = ['127.0.0.1', '::1'].map((address) => https.createServer(options, handler).listen(443, address));
  return { record, close: () => servers.forEach((each) => each.close()) };
}

async function openChromium(dir, extension) {
  const { chromium } = require('playwright-core');
  const exe = arg('exe') ?? require('./browser.cjs').findChrome();
  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    executablePath: exe,
    headless: false,
    ignoreHTTPSErrors: true,
    args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP *.shoptrial.test 127.0.0.1, MAP *.machinesite.test 127.0.0.1', '--disable-features=DisableLoadExtensionCommandLineSwitch', '--ignore-certificate-errors'],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 20000 });
  const page = await context.newPage();
  return {
    version: context.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent)),
    own: `chrome-extension://${new URL(worker.url()).host}`,
    settings: { note: 'as it ships; third-party cookies not blocked unless the line below says so', userAgent: await page.evaluate(() => navigator.userAgent) },
    go: async (address) => {
      await page.goto('about:blank');
      await page.goto(address).catch((error) => console.log('  ..  ' + error.message.split('\n')[0]));
    },
    close: () => context.close(),
  };
}

async function openFirefox(dir, extension) {
  // Nothing here touches cookies, partitioning or SameSite: those stay as Firefox ships them, and are read back and printed below.
  const { client, close } = await launchFirefox({ exe: arg('exe'), dir, prefs: { 'network.dns.localDomains': 'www.shoptrial.test,www.machinesite.test' } });
  // A temporary add-on, as about:debugging loads one: a folder if Firefox takes it, else the same files zipped.
  let id;
  try {
    id = (await client.send('Addon:Install', { path: extension, temporary: true })).value;
  } catch {
    const xpi = path.join(dir, 'trial.xpi');
    execFileSync('tar', ['-a', '-c', '-f', xpi, '-C', extension, ...Object.keys(EXTENSION)]);
    id = (await client.send('Addon:Install', { path: xpi, temporary: true })).value;
  }
  const facts = await client.script(
    `const [id, done] = arguments;
     (async () => {
       const policy = WebExtensionPolicy.getByID(id);
       const pref = (name) => { try { return [Services.prefs.getPrefType(name) === 128 ? Services.prefs.getBoolPref(name) : Services.prefs.getPrefType(name) === 64 ? Services.prefs.getIntPref(name) : Services.prefs.getStringPref(name), Services.prefs.prefHasUserValue(name) ? 'changed' : 'as shipped']; } catch (error) { return ['?', String(error)]; } };
       const names = ['network.cookie.cookieBehavior', 'network.cookie.cookieBehavior.pbmode', 'browser.contentblocking.category', 'network.cookie.sameSite.laxByDefault', 'network.cookie.sameSite.noneRequiresSecure', 'network.cookie.sameSite.schemeful', 'privacy.partition.network_state', 'privacy.firstparty.isolate', 'network.cookie.cookieBehavior.optInPartitioning', 'privacy.partition.always_partition_third_party_non_cookie_storage'];
       done({ host: policy.mozExtensionHostname, version: Services.appinfo.version, origins: policy.extension.allowedOrigins?.patterns?.map((each) => each.pattern) ?? null, prefs: Object.fromEntries(names.map((name) => [name, pref(name)])) });
     })().catch((error) => done({ error: String(error) }));`,
    [id],
    true,
  );
  return {
    version: 'Firefox ' + facts.version,
    own: `moz-extension://${facts.host}`,
    settings: facts,
    go: async (address) => {
      await client.send('WebDriver:Navigate', { url: address }).catch((error) => console.log('  ..  ' + error.message.split('\n')[0]));
    },
    // The leave for the shop, given as the browser's own "allow" box gives it (a script can't press that box).
    allow: () =>
      client.script(
        `const [id, done] = arguments;
         (async () => {
           const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
           const policy = WebExtensionPolicy.getByID(id);
           await ExtensionPermissions.add(id, { permissions: [], origins: ['https://shoptrial.test/*', 'https://*.shoptrial.test/*'] }, policy.extension);
           done(true);
         })().catch((error) => done(String(error)));`,
        [id],
        true,
      ),
    close,
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-cookie-trial-'));
  const extension = path.join(dir, 'extension');
  fs.mkdirSync(extension);
  for (const [name, text] of Object.entries(EXTENSION)) fs.writeFileSync(path.join(extension, name), text);
  const shop = serve(dir);
  const browser = await (BROWSER === 'firefox' ? openFirefox(dir, extension) : openChromium(dir, extension));
  const settled = async (run, most = 9000) => {
    for (let waited = 0; waited < most; waited += 300) {
      if (shop.record.some((each) => each.run === run && each.kind === 'ask:second')) break;
      await sleep(300);
    }
    await sleep(500);
  };
  try {
    console.log(`${BROWSER}: ${browser.version} · the extension's own page is ${browser.own}`);
    await browser.go(`${SHOP}/signin`);
    await browser.go(`${SHOP}/first?run=tab`);
    await settled('tab');
    const own = (run, rule) => `${browser.own}/trial.html?run=${run}&rule=${rule}&frame=${encodeURIComponent(`${SHOP}/first?run=${run}`)}`;
    await browser.go(own('probe', 'off'));
    await settled('probe', 3000);
    const leave = shop.record.find((each) => each.run === 'probe' && each.words?.startsWith('leave for the shop'))?.words ?? '';
    if (leave.includes('false') && browser.allow) console.log('  ..  the leave for the shop was not given at install; given now, as the allow box would:', await browser.allow());
    for (const [run, rule] of [['extoff', 'off'], ['extB', 'B'], ['extA', 'A'], ['extC', 'C']]) {
      await browser.go(own(run, rule));
      await settled(run, rule === 'off' ? 3500 : 9000);
    }
    await browser.go(`${TOP}/?src=${encodeURIComponent(`${SHOP}/open/first?run=web`)}`);
    await settled('web');
    await browser.go(`${SHOP}/first?run=after`);
    await settled('after');
  } finally {
    await browser.close().catch(() => undefined);
    shop.close();
  }

  const names = (text) => COOKIES.map((each) => (new RegExp(`(?:^|; )${each}=1`).test(text) ? each : '-')).join(' ');
  const of = (run, kind) => shop.record.find((each) => each.run === run && each.kind === kind);
  const line = (run, kind, what) => {
    const found = of(run, kind);
    return `  ${what.padEnd(58)} ${found === undefined ? 'NEVER ASKED FOR' : names(found.sent)}${found?.fetchSite ? '   (' + found.fetchSite + ')' : ''}`;
  };
  const shown = (run) => (of(run, 'ask:first') === undefined ? 'NOT SHOWN' : 'SHOWN');
  console.log(`\nCookies the shop was sent (${COOKIES.join(' ')}), ${BROWSER} ${browser.version}`);
  console.log(line('tab', 'page:first', 'an ordinary tab'));
  for (const [run, words] of [['extoff', 'no rule'], ['extB', "rule B (its page's host as the asker)"], ['extA', 'rule A (runtime.id as the asker, as worker.js)'], ['extC', 'rule C (no asker named)']]) {
    console.log(`\n in the extension's own page, ${words}: ${shown(run)}`);
    for (const each of shop.record.filter((entry) => entry.run === run && entry.kind === 'note')) console.log(`    · ${each.words}`);
    console.log(line(run, 'page:first', '  (a) the first page framed'));
    console.log(line(run, 'page:second', '  (b) a link followed inside the frame'));
    console.log(line(run, 'ask:first', '  (c) what the framed page asks its own site for'));
    console.log(`  ${'  (d) what the framed page reads (document.cookie)'.padEnd(58)} ${of(run, 'ask:first') === undefined ? 'NOTHING RAN' : names(of(run, 'ask:first').read)}`);
  }
  console.log(`\n in an ordinary https page (the control; a shop page with no no-framing rule): ${shown('web')}`);
  console.log(line('web', 'page:first', '  (a) the first page framed'));
  console.log(line('web', 'page:second', '  (b) a link followed inside the frame'));
  console.log(line('web', 'ask:first', '  (c) what the framed page asks its own site for'));
  console.log(`  ${'  (d) what the framed page reads (document.cookie)'.padEnd(58)} ${of('web', 'ask:first') === undefined ? 'NOTHING RAN' : names(of('web', 'ask:first').read)}`);
  const after = of('after', 'page:first')?.sent ?? '';
  console.log(`\n cookies set inside the frames, there in an ordinary tab afterwards (not kept apart):`);
  for (const run of ['extB', 'extA', 'extC', 'web']) console.log(`  ${run.padEnd(8)} by the answer: ${new RegExp(`set_${run}_first=1`).test(after)}   by the page's script: ${new RegExp(`js_${run}=1`).test(after)}`);
  console.log('\n settings:', JSON.stringify(browser.settings, null, 1));
  const json = arg('json');
  if (json !== null) fs.writeFileSync(json, JSON.stringify({ browser: browser.version, settings: browser.settings, record: shop.record }, null, 1));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
