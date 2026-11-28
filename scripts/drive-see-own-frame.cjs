/*
 * OWN EYE inside BROWSER's own tab (Luke, 2026-11-27: "not open in a new tab but inside a 'new tab' inside of debasers browser module"), with real
 * cookies on pretend https sites: the extension as it is, but for debaser.site being a pretend site this script serves, and the pretend sites
 * already let (a browser's own "allow" box can't be pressed by a script). Signs in to nothing real.
 *
 * Twice over: with two sites added BY NAME, and then with EVERY SITE allowed as well (Luke, 2026-11-27: "One optional key (Recommended)";
 * decision 67: a site's script-safety rules are switched off only for a site added by name).
 *
 *   node scripts/drive-see-own-frame.cjs
 *   node scripts/drive-see-own-frame.cjs --mutant nest      the fix taken out: a page shown here may be framed by anybody (must FAIL)
 *   node scripts/drive-see-own-frame.cjs --mutant scripts   EVERY SITE replacing any policy, script-safety rules or not (must FAIL)
 *   node scripts/drive-see-own-frame.cjs --mutant anyframe  the extension's lines speaking from any frame inside the site's page (must FAIL)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { findChrome } = require('./browser.cjs');

let passed = 0;
const ok = (value, what) => {
  assert.ok(value, what);
  passed += 1;
  console.log(`  ok  ${what}`);
};
const SANDBOX = /OWN_FRAME_SANDBOX = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'app/components/seeing/SeeingOwnFrame.tsx'), 'utf8'))[1];
const MUTANT = process.argv.includes('--mutant') ? process.argv[process.argv.indexOf('--mutant') + 1] : null;
// shoptrial and pairtrial are added by name; othertrial and thirdtrial never are.
const FAMILIES = ['shoptrial.test', 'pairtrial.test', 'othertrial.test', 'thirdtrial.test', 'machinesite.test'];
const NAMED = ['https://shoptrial.test/*', 'https://*.shoptrial.test/*', 'https://pairtrial.test/*', 'https://*.pairtrial.test/*'];
const WRITES = "<p id=kept>as sent</p><script>document.getElementById('kept').textContent = 'script ran'</script>";

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'see-own-frame-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=pretend', '-addext', `subjectAltName=${FAMILIES.map((each) => `DNS:*.${each}`).join(',')},DNS:accounts.google.com`], { stdio: 'ignore' });
  const asked = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (request, answer) => {
    const host = request.headers.host.split(':')[0];
    asked.push(`${host}${request.url}`);
    const html = { 'content-type': 'text/html' };
    // Refused both ways, its policy only about framing.
    const guarded = { ...html, 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };
    const shop = `<title>Shop ${request.url}</title><p id=cookie>${request.headers.cookie ?? 'signed out'}</p><a id=next href="/second">second</a><a id=inside href="/inside" onclick="history.pushState(null, '', '/inside'); document.title = 'Shop inside'; return false">inside</a>`;
    if (host === 'www.machinesite.test') return answer.writeHead(200, html).end('<title>BROWSER</title><p>the pretend BROWSER page');
    if (host === 'accounts.google.com') return answer.writeHead(200, guarded).end('<title>Sign in</title><p id=signin>sign in');
    if (request.url === '/signin') return answer.writeHead(200, { ...html, 'set-cookie': ['session=1; SameSite=None; Secure; Path=/', 'lax=1; SameSite=Lax; Secure; Path=/'] }).end('in');
    if (request.url === '/leave') return answer.writeHead(200, guarded).end('<script>try { top.location.href = "https://www.shoptrial.test/escaped"; } catch (error) {} try { document.title = String(parent.document.title); } catch (error) { document.title = error.name; }</script><p id=left>leaving');
    // A page that lets itself be framed, and frames another inside itself.
    if (request.url.startsWith('/nest?to=')) return answer.writeHead(200, html).end(`<title>Nest</title><p id=cookie>nest</p><iframe id=in src="${decodeURIComponent(request.url.slice(9)).replace(/"/g, '')}"></iframe>`);
    if (request.url === '/plain') return answer.writeHead(200, html).end('<title>Plain</title><p id=cookie>plain</p>');
    // Kind 1: refused by X-Frame-Options alone, with a strict policy of its own that says nothing of framing.
    if (request.url === '/xfo-csp') return answer.writeHead(200, { ...html, 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'" }).end(`<title>Kind one</title><p id=cookie>kind one</p>${WRITES}`);
    // Kind 3: one policy holding both its no-framing line and its script-safety rules.
    if (request.url === '/mixed') return answer.writeHead(200, { ...html, 'content-security-policy': "frame-ancestors 'none'; script-src 'none'" }).end(`<title>Kind three</title><p id=cookie>kind three</p>${WRITES}`);
    // The same in two policies, one line each.
    if (request.url === '/two') return answer.writeHead(200, { ...html, 'content-security-policy': ["frame-ancestors 'none'", "script-src 'none'"] }).end(`<title>Two policies</title><p id=cookie>two policies</p>${WRITES}`);
    return answer.writeHead(200, guarded).end(shop);
  });
  await new Promise((done) => server.listen(443, '127.0.0.1', done));

  /** The browser with the extension in it, holding the leaves `origins`; what a reader's own "allow" press would give. */
  const browserWith = async (name, origins) => {
    const extension = path.join(dir, `extension-${name}`);
    fs.cpSync(path.join(__dirname, '..', 'extension'), extension, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions = origins;
    manifest.externally_connectable.matches = ['https://www.machinesite.test/*'];
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
    for (const file of ['sites.js', 'frame.js', 'act.js', 'worker.js']) {
      let text = fs.readFileSync(path.join(extension, file), 'utf8').replaceAll('https://debaser.site', 'https://www.machinesite.test');
      if (file === 'sites.js' && MUTANT === 'nest') {
        assert.ok(text.includes('export const framedBy = (id, sites = []) =>'), 'the mutant finds what it changes');
        text = text.replace('export const framedBy = (id, sites = []) =>', "export const framedBy = () => 'frame-ancestors *';\nconst framedByAsBuilt = (id, sites = []) =>");
      }
      if (file === 'frame.js' && MUTANT === 'anyframe') {
        const asks = "if (location.ancestorOrigins[0] !== 'https://www.machinesite.test') begin();";
        assert.ok(text.includes(asks), 'the mutant finds what it changes');
        text = text.replace(asks, 'if (true) begin();');
      }
      if (file === 'sites.js' && MUTANT === 'scripts') {
        assert.ok(/export const PROTECTS = \[[^\]]+\];/.test(text), 'the mutant finds what it changes');
        text = text.replace(/export const PROTECTS = \[[^\]]+\];/, "export const PROTECTS = ['*a-rule-no-policy-holds*'];");
      }
      fs.writeFileSync(path.join(extension, file), text);
    }
    const context = await chromium.launchPersistentContext(path.join(dir, `profile-${name}`), {
      executablePath: findChrome(),
      headless: false,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
      args: ['--headless=new', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--host-resolver-rules=${[...FAMILIES.map((each) => `MAP *.${each} 127.0.0.1`), 'MAP accounts.google.com 127.0.0.1'].join(', ')}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--ignore-certificate-errors'],
      ignoreDefaultArgs: ['--disable-extensions'],
    });
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker', { timeout: 20000 });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log('  ..  page error:', error.message.slice(0, 160)));
    const frameOf = (src) =>
      page.evaluate(
        ([where, sandbox]) =>
          new Promise((done) => {
            // As SeeingOwnFrame does: the extension's lines in a framed page ask whether theirs is the frame made for OWN EYE, and the page
            // says yes to that one frame alone.
            if (!window.answering) {
              window.answering = true;
              addEventListener('message', (event) => {
                const own = document.querySelector('iframe[data-own]')?.contentWindow;
                if (own && event.source === own && event.data?.see === 'own-eye?') own.postMessage({ see: 'own-eye' }, '*');
              });
            }
            document.querySelector('iframe[data-own]')?.remove();
            const frame = document.createElement('iframe');
            frame.setAttribute('data-own', '');
            frame.setAttribute('sandbox', sandbox);
            frame.src = where;
            frame.onload = () => setTimeout(done, 400);
            document.body.append(frame);
          }),
        [src, SANDBOX],
      );
    const inner = () => page.frames().find((each) => each.parentFrame() === page.mainFrame() && each.name() !== 'embed');
    const within = () => page.frames().find((each) => each.parentFrame() === inner());
    const text = async (frame, what = '#cookie') => (await frame?.locator(what).innerText({ timeout: 1500 }).catch(() => null)) ?? null;
    const drawn = () => text(inner());
    const told = [];
    /** BROWSER's page holds itself open to the extension, as SeeingMachine does. */
    const hold = async () => {
      await page.exposeFunction('heard', (message) => told.push(message)).catch(() => undefined);
      await page.evaluate((extensionId) => {
        window.held = chrome.runtime.connect(extensionId, { name: 'browser' });
        window.held.onMessage.addListener((message) => window.heard(message));
      }, id);
      await page.waitForTimeout(800);
    };
    /** What the site's page is told when it asks about one page. */
    const has = (address) => page.evaluate(([extensionId, about]) => new Promise((done) => chrome.runtime.sendMessage(extensionId, { see: 'has', address: about }, done)), [id, address]);
    return { context, id, page, frameOf, inner, within, text, drawn, told, hold, has };
  };

  // ---- Sites added by name, as it has been since 0.7 ----
  console.log('\nADDED BY NAME (shoptrial.test, pairtrial.test)');
  const named = await browserWith('named', NAMED);
  try {
    const { context, page, frameOf, inner, within, text, drawn, told, hold, has } = named;
    // Signed in on the shop, in its own tab, as a reader would be.
    await page.goto('https://www.shoptrial.test/signin');
    await page.goto('https://www.shoptrial.test/');
    ok((await page.locator('#cookie').innerText()).includes('session=1'), 'signed in to the pretend shop in an ordinary tab');

    await page.goto('https://www.machinesite.test/');
    await frameOf('https://www.shoptrial.test/');
    ok((await drawn()) === null, 'with no BROWSER page held open to the extension, the shop keeps its no-framing rule');

    await hold();
    await frameOf('https://www.shoptrial.test/');
    const cookie = await drawn();
    ok(cookie !== null, "held open, an added site is shown in BROWSER's tab");
    ok(cookie.includes('session=1') && !cookie.includes('lax=1'), `signed in where the site's sign-in is meant to work inside another site; a Lax cookie stays home (${cookie})`);
    await page.waitForTimeout(500);
    ok(told.some((each) => each.see === 'at' && each.href === 'https://www.shoptrial.test/'), 'and the extension tells BROWSER where it is');
    await inner().locator('#next').click();
    await page.waitForTimeout(1200);
    ok(told.some((each) => each.see === 'at' && each.href === 'https://www.shoptrial.test/second') && (await drawn()) !== null, 'a link followed inside it is followed, and told');
    // The morning's gap G1 (Luke, 2026-11-27: "shorts will play but clicking a video will return a white page"): YouTube changes its address
    // inside one page when a video is clicked, with no new page loaded. That is told too, so BROWSER can put the player there.
    await inner().locator('#inside').click();
    await page.waitForTimeout(1600);
    ok(asked.filter((each) => each === 'www.shoptrial.test/inside').length === 0, 'an address changed inside the page loads no new page');
    ok(told.some((each) => each.see === 'at' && each.href === 'https://www.shoptrial.test/inside' && each.title === 'Shop inside'), 'and is told to BROWSER all the same, with its title');

    // A lens asked for by BROWSER's page, worn on the framed page by the extension, and again on the next page: still signed in.
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: 'lowfi' }));
    await page.waitForTimeout(1000);
    ok((await inner().evaluate(() => document.getElementById('debaser-see') !== null)) && (await drawn()).includes('session=1'), 'a lens is put on the page framed in BROWSER, while it stays signed in');
    await inner().locator('#next').click();
    await page.waitForTimeout(1500);
    ok((await inner().evaluate(() => document.getElementById('debaser-see') !== null)) && (await drawn()).includes('session=1'), 'and worn again on the next page it goes to');
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: 'standard' }));
    await page.waitForTimeout(800);
    ok((await inner().evaluate(() => document.getElementById('debaser-see') === null)), 'STANDARD takes it off');
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: '<script>' }));
    ok(true, 'and what is not a lens is nothing');

    // What the rule does to a page's own headers (2026-11-28, decision 67), for a site added by name.
    await frameOf('https://www.shoptrial.test/xfo-csp');
    ok((await drawn()) === 'kind one' && (await text(inner(), '#kept')) === 'as sent', "a page refused by X-Frame-Options alone is shown with its own policy kept whole: its script-safety rules still hold");
    await frameOf('https://www.shoptrial.test/mixed');
    ok((await drawn()) === 'kind three' && (await text(inner(), '#kept')) === 'script ran', 'a page whose one policy mixes framing with script rules is shown for a site added by name, with those rules off (what ADD says it costs)');
    await frameOf('https://www.shoptrial.test/two');
    ok((await drawn()) === 'two policies', 'the same in two policies is shown too, for a site added by name');
    // Who may frame a page shown here: BROWSER's page, the machine's, and the sites added by name; nobody else.
    await frameOf('https://www.shoptrial.test/nest?to=' + encodeURIComponent('https://www.pairtrial.test/'));
    ok((await drawn()) === 'nest' && (await text(within())) === 'signed out', 'one added site inside another is shown, as before');
    await frameOf('https://www.othertrial.test/nest?to=' + encodeURIComponent('https://www.shoptrial.test/'));
    ok((await drawn()) === 'nest' && (await text(within())) === null, "an added site inside a page that was never added keeps its no-framing rule: a stranger's page can't put it inside itself here");
    await frameOf('https://www.othertrial.test/');
    ok((await drawn()) === null, 'a site that was never added is not shown');
    ok(JSON.stringify(await has('https://www.shoptrial.test/a')) === JSON.stringify({ on: true, site: 'shoptrial.test', named: true }) && JSON.stringify(await has('https://www.othertrial.test/a')) === JSON.stringify({ on: false, site: 'othertrial.test', named: false }), "BROWSER's page is told yes or no for the one page it asks of, and whether that site is on the list by name");

    await frameOf('https://accounts.google.com/');
    ok((await inner()?.locator('#signin').count().catch(() => 0)) === 0, 'a sign-in page is never shown inside it (D1)');
    await frameOf('https://www.shoptrial.test/leave');
    await page.waitForTimeout(800);
    ok(page.url() === 'https://www.machinesite.test/' && !asked.includes('www.shoptrial.test/escaped'), "the framed site can't move BROWSER's page");
    ok((await inner().title()) === 'SecurityError', "nor read it");

    // Another page, not held open: refused as before.
    const other = await context.newPage();
    await other.goto('https://www.machinesite.test/');
    await other.evaluate((sandbox) => new Promise((done) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', sandbox);
      frame.src = 'https://www.shoptrial.test/';
      frame.onload = () => setTimeout(done, 400);
      document.body.append(frame);
    }), SANDBOX);
    const otherFrame = other.frames().find((each) => each.parentFrame() === other.mainFrame());
    ok((await otherFrame?.locator('#cookie').count().catch(() => 0)) === 0, 'another tab of the same site, not held open, is refused as it always was');
    await other.close();

    await page.evaluate(() => window.held.disconnect());
    await page.waitForTimeout(800);
    await frameOf('https://www.shoptrial.test/');
    ok((await drawn()) === null, 'and the leave goes when BROWSER lets go');
  } finally {
    await named.context.close();
  }

  // ---- EVERY SITE allowed as well (the press on the SITES page), the two sites still added by name ----
  console.log('\nEVERY SITE ALLOWED (shoptrial.test and pairtrial.test still by name)');
  const every = await browserWith('every', ['https://*/*', 'http://*/*', ...NAMED]);
  try {
    const { context, page, frameOf, inner, within, text, drawn, told, hold, has } = every;
    await page.goto('https://www.machinesite.test/');
    await frameOf('https://www.othertrial.test/');
    ok((await drawn()) === null, 'with no BROWSER page held open, every site keeps its no-framing rule, EVERY SITE or not');
    await hold();

    // The few lines that run on every page (frame.js): silent in an ordinary tab and in anybody else's frame.
    const worker = () => context.serviceWorkers()[0];
    await worker().evaluate(() => {
      self.frameTold = [];
      chrome.runtime.onMessage.addListener((message) => void (message?.see === 'frame' && self.frameTold.push(message.href)));
    });
    const ordinary = await context.newPage();
    await ordinary.goto('https://www.othertrial.test/nest?to=' + encodeURIComponent('https://www.thirdtrial.test/plain'));
    await ordinary.waitForTimeout(1500);
    ok((await worker().evaluate(() => self.frameTold.length)) === 0, "in an ordinary tab, and in a frame inside an ordinary tab's page, the lines the extension runs on every page say nothing to anybody");
    await ordinary.close();

    await frameOf('https://www.othertrial.test/');
    ok((await drawn()) === 'signed out', 'a site that was never added is shown in BROWSER once every site is allowed (its policy was only about framing)');
    await page.waitForTimeout(700);
    ok((await worker().evaluate(() => self.frameTold.join(' '))) === 'https://www.othertrial.test/' && told.some((each) => each.see === 'at' && each.href === 'https://www.othertrial.test/'), "directly inside BROWSER's page they say where the page is, and that is told to BROWSER");

    // Only the one frame BROWSER made for OWN EYE (the coordinator, 2026-11-28): any other frame directly inside the same page (the floating
    // player, a video in a post) asks, hears nothing back, and says nothing: not followed, not told to BROWSER, no lens.
    await page.evaluate(() => new Promise((done) => {
      const embed = document.createElement('iframe');
      embed.name = 'embed';
      embed.src = 'https://www.thirdtrial.test/plain';
      embed.onload = () => setTimeout(done, 1600);
      document.body.append(embed);
    }));
    const embed = page.frames().find((each) => each.name() === 'embed');
    ok((await text(embed)) === 'plain', "another site's page embedded in the same page, outside the frame BROWSER made, is drawn as any embed is");
    ok(!(await worker().evaluate(() => self.frameTold.join(' '))).includes('thirdtrial') && !told.some((each) => String(each.href).includes('thirdtrial')), 'and the lines the extension runs in it say nothing: its address is told to nobody');
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: 'lowfi' }));
    await page.waitForTimeout(1200);
    ok((await embed.evaluate(() => document.getElementById('debaser-see') === null)) && (await inner().evaluate(() => document.getElementById('debaser-see') !== null)), "a lens goes on BROWSER's own frame and never on the embed");
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: 'standard' }));
    await page.evaluate(() => document.querySelector('iframe[name=embed]').remove());
    await page.waitForTimeout(600);

    // The three kinds (decision 67): EVERY SITE never switches a page's script-safety rules off.
    await frameOf('https://www.othertrial.test/xfo-csp');
    ok((await drawn()) === 'kind one' && (await text(inner(), '#kept')) === 'as sent', "refused by X-Frame-Options alone: shown, its own policy kept whole (its script-safety rules still hold)");
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: 'lowfi' }));
    await page.waitForTimeout(1200);
    ok(await inner().evaluate(() => document.getElementById('debaser-see') !== null), 'and a lens is still put on a page that kept its policy');
    await page.evaluate(() => window.held.postMessage({ see: 'lens', lens: 'standard' }));
    await frameOf('https://www.othertrial.test/mixed');
    ok((await drawn()) === null, "a policy that mixes framing with script-safety rules is left whole: the page does not show under EVERY SITE alone");
    await frameOf('https://www.othertrial.test/two');
    ok((await drawn()) === null, 'nor when the two are in separate policies');
    await frameOf('https://www.shoptrial.test/mixed');
    ok((await drawn()) === 'kind three' && (await text(inner(), '#kept')) === 'script ran', 'the same page on a site added by name is shown, those rules off: adding by name is what does that');

    // A page shown here can't put a third site inside itself with that site's protection gone.
    await frameOf('https://www.othertrial.test/nest?to=' + encodeURIComponent('https://www.thirdtrial.test/'));
    ok((await drawn()) === 'nest' && (await text(within())) === null, 'a refusing site nested inside a page shown here stays refused (shown directly, it would be)');
    await frameOf('https://www.othertrial.test/nest?to=' + encodeURIComponent('https://www.shoptrial.test/'));
    ok((await drawn()) === 'nest' && (await text(within())) === null, 'so does a site added by name, inside a page that was not');
    await frameOf('https://www.shoptrial.test/nest?to=' + encodeURIComponent('https://www.thirdtrial.test/'));
    ok((await drawn()) === 'nest' && (await text(within())) === null, 'and a site that was never added, inside one that was');
    await frameOf('https://www.thirdtrial.test/');
    ok((await drawn()) === 'signed out', 'that same site, directly in BROWSER, is shown');
    await frameOf('https://www.shoptrial.test/nest?to=' + encodeURIComponent('https://www.pairtrial.test/'));
    ok((await text(within())) === 'signed out', 'one site added by name inside another still is, as before');

    ok(JSON.stringify(await has('https://www.othertrial.test/a')) === JSON.stringify({ on: true, site: 'othertrial.test', named: false }) && JSON.stringify(await has('https://www.shoptrial.test/a')) === JSON.stringify({ on: true, site: 'shoptrial.test', named: true }), "BROWSER's page is told the page may be shown, and whether its site is on the list by name");
    await frameOf('https://accounts.google.com/');
    ok((await inner()?.locator('#signin').count().catch(() => 0)) === 0, 'a sign-in page is never shown inside it, every site allowed or not (D1)');
    await frameOf('https://www.othertrial.test/leave');
    await page.waitForTimeout(800);
    ok(page.url() === 'https://www.machinesite.test/' && !asked.includes('www.shoptrial.test/escaped'), "and a page shown this way can't move BROWSER's page either");

    await page.evaluate(() => window.held.disconnect());
    await page.waitForTimeout(800);
    await frameOf('https://www.othertrial.test/');
    ok((await drawn()) === null, 'and the leave goes when BROWSER lets go');
  } finally {
    await every.context.close();
  }
  console.log(`\n${passed} passed`);
  server.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
