/*
 * The extension's trial day (SPEC-seeing-machine.md, D1 and phase 2b): which way of showing a site in the reader's own browser keeps them
 * signed in. A throwaway extension, made here and forgotten, in a throwaway profile; nobody is signed in to anything.
 *
 *   node scripts/see-extension-trial.cjs               the cookie question, on local pretend sites
 *   node scripts/see-extension-trial.cjs --real        the spec's test list as well: does each show in a frame with its no-framing header lifted
 *
 * Three ways:
 *   (a) framed in a page of the site's (as BROWSER's own tab would), the extension lifting the no-framing header for that frame only
 *   (b) in an ordinary tab, with the lens put on that tab
 *   (c) framed in a page of the extension's own, which has leave for that site
 */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

const REAL = process.argv.includes('--real');
const OUT = path.join('Temp', 'browse', 'see-extension');
fs.mkdirSync(OUT, { recursive: true });
const SITES = { wikipedia: 'https://en.wikipedia.org/wiki/Main_Page', bbc: 'https://www.bbc.co.uk/news', guardian: 'https://www.theguardian.com/uk', hackernews: 'https://news.ycombinator.com/', github: 'https://github.com/', archive: 'https://archive.org/details/texts', oldreddit: 'https://old.reddit.com/', oneapp: 'https://excalidraw.com/', paywall: 'https://www.ft.com/', youtube: 'https://www.youtube.com/', x: 'https://x.com/NASA', instagram: 'https://www.instagram.com/nasa/' };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-extension-'));
  const extension = path.join(dir, 'extension');
  fs.mkdirSync(extension);
  const HOSTS = ['http://www.shoptrial.test/*', ...Object.values(SITES).map((each) => `${new URL(each).origin}/*`)];
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'trial', version: '1', permissions: ['declarativeNetRequestWithHostAccess', 'scripting'], host_permissions: HOSTS, background: { service_worker: 'worker.js' } }));
  fs.writeFileSync(
    path.join(extension, 'worker.js'),
    `const rule = (id, from) => ({ id, priority: 1, condition: { initiatorDomains: [from], resourceTypes: ['sub_frame'], requestDomains: ${JSON.stringify([...new Set(HOSTS.map((each) => new URL(each.replace('/*', '/')).hostname))])} }, action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }, { header: 'content-security-policy', operation: 'remove' }] } });
chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1, 2], addRules: [rule(1, 'www.machinetrial.test'), rule(2, chrome.runtime.id)] });
self.lens = (tab) => chrome.scripting.executeScript({ target: { tabId: tab }, func: () => { document.documentElement.setAttribute('data-lens', 'on'); return document.body.innerText.slice(0, 40); } });`,
  );
  fs.writeFileSync(path.join(extension, 'machine.html'), '<!doctype html><title>machine</title><body style="margin:0"><iframe id="f" style="border:0;width:100vw;height:100vh"></iframe><script src="machine.js"></script>');
  fs.writeFileSync(path.join(extension, 'machine.js'), 'document.getElementById("f").src = new URLSearchParams(location.search).get("see");');

  const asked = [];
  const server = http.createServer((request, answer) => {
    const host = request.headers.host.split(':')[0];
    asked.push({ host, url: request.url, cookie: request.headers.cookie ?? '' });
    if (host === 'www.machinetrial.test') return answer.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>machine</title><body style="margin:0"><iframe style="border:0;width:100vw;height:100vh" src="${decodeURIComponent(request.url.slice(2))}"></iframe>`);
    if (request.url === '/signin') return answer.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['strict=1; SameSite=Strict; Path=/', 'lax=1; SameSite=Lax; Path=/', 'plain=1; Path=/'] }).end('<p>signed in');
    return answer.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }).end(`<p>SHOP: ${request.headers.cookie ?? 'signed out'}</p><script>document.title = 'js ' + document.cookie + ' store ' + (function(){try{return localStorage.length}catch(e){return e.name}})()</script>`);
  });
  await new Promise((done) => server.listen(80, '127.0.0.1', done)).catch(() => undefined);

  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), { executablePath: findChrome(), headless: false, viewport: { width: 1280, height: 800 }, args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--host-resolver-rules=MAP *.shoptrial.test 127.0.0.1, MAP *.machinetrial.test 127.0.0.1', '--disable-features=DisableLoadExtensionCommandLineSwitch'], ignoreDefaultArgs: ['--disable-extensions'] });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  if (worker === null) {
    console.log('The extension did not load in this browser by command line: nothing measured.');
    await context.close();
    server.close();
    process.exit(2);
  }
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto('http://www.shoptrial.test/signin');
  const last = () => asked.filter((each) => each.host === 'www.shoptrial.test').at(-1).cookie || 'none';
  const shown = async () => {
    await page.waitForTimeout(1200);
    const frame = page.frames().find((each) => each.url().startsWith('http://www.shoptrial.test'));
    return frame === undefined ? 'not shown' : (await frame.evaluate(() => `${document.body.innerText.trim()} | ${document.title}`).catch((error) => error.message)).replace(/\s+/g, ' ');
  };
  await page.goto('http://www.shoptrial.test/');
  console.log('(b) an ordinary tab:        ', await page.evaluate(() => document.body.innerText.trim()), '| sent', last());
  const tab = await worker.evaluate(() => chrome.tabs.query({ active: true }).then((all) => all[0].id));
  const lens = await worker.evaluate((each) => self.lens(each).then((got) => got[0].result), tab).catch((error) => error.message);
  console.log('    the lens put on it:     ', lens, '|', await page.evaluate(() => document.documentElement.getAttribute('data-lens')));
  await page.goto(`http://www.machinetrial.test/?${encodeURIComponent('http://www.shoptrial.test/a')}`);
  console.log('(a) framed in our site:     ', await shown(), '| sent', last());
  await page.goto(`chrome-extension://${id}/machine.html?see=${encodeURIComponent('http://www.shoptrial.test/c')}`);
  console.log("(c) framed in the extension:", await shown(), '| sent', last());

  if (REAL) {
    for (const [name, address] of Object.entries(SITES)) {
      const line = [];
      for (const [way, where] of [['b', address], ['c', `chrome-extension://${id}/machine.html?see=${encodeURIComponent(address)}`], ['a', `http://www.machinetrial.test/?${encodeURIComponent(address)}`]]) {
        try {
          await page.goto(where, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await page.waitForTimeout(5000);
          const frame = way === 'b' ? page.mainFrame() : page.frames().find((each) => each !== page.mainFrame() && each.parentFrame() === page.mainFrame());
          const words = frame === undefined ? 0 : await frame.evaluate(() => (document.body?.innerText ?? '').split(/\s+/).filter(Boolean).length).catch(() => -1);
          line.push(`${way}: ${words} words${way !== 'b' && page.url() !== where ? ' (BROKE OUT)' : ''}`);
          await page.screenshot({ path: path.join(OUT, `${name}-${way}.png`) });
        } catch (error) {
          line.push(`${way}: ${error.message.split('\n')[0].slice(0, 60)}`);
        }
      }
      const cookies = await context.cookies(address);
      const none = cookies.filter((each) => each.sameSite === 'None').length;
      console.log(`${name}: ${line.join(' | ')} | cookies ${cookies.length}, of them sent to a frame in another site: ${none}`);
    }
  }
  await context.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})();
