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
 *   node scripts/drive-see-own-frame.cjs --mutant keepoff   the extension handing out a page's words while OWN WEB's switch is off (must FAIL)
 *   node scripts/drive-see-own-frame.cjs --mutant boxes     the words read without leaving out boxes and editable parts (must FAIL)
 *   node scripts/drive-see-own-frame.cjs --mutant nevertool the four tools acting on a never-list page the frame moved itself to (must FAIL)
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
/** Every word here ending in -SECRET, and the one-time code, must never leave the page; `plain` is another site's page framed inside it. */
const LETTER = [
  '<title>Letter</title><meta name="description" content="A letter kept"><p id=cookie>letter</p><h2 id=head>Dear reader</h2><p id=pick>pick these words</p>',
  '<form><input id=typed value="TYPED-SECRET"><input type=password id=pass value="PASSWORD-SECRET"><input type=hidden value="HIDDEN-SECRET"><input autocomplete="one-time-code" value="246810">',
  '<textarea id=area>AREA-SECRET</textarea><select><option>OPTION-SECRET</option></select></form><div id=edit contenteditable>EDIT-SECRET</div>',
  '<p style="display:none">UNDRAWN-SECRET</p><p style="position:absolute;left:-9999px">OFFPAGE-SECRET</p><p style="position:absolute;width:1px;height:1px;overflow:hidden">TINY-SECRET</p><p hidden>HIDDENATTR-SECRET</p>',
  '<script>var kept = "SCRIPT-SECRET"</script><p><a id=ad href="/second">an advert</a></p><p><a id=film href="https://www.youtube.com/watch?v=abcdefghijk">a film</a></p>',
  '<img src="https://www.thirdtrial.test/pixel.png" width=1 height=1><iframe src="https://www.pairtrial.test/plain"></iframe>',
].join('');
const SECRETS = ['SECRET', '246810', 'plain'];

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
    // `/open`: a page on the never-list that lets itself be framed (the browser shows it; the extension must still read nothing of it).
    if (host === 'accounts.google.com') return answer.writeHead(200, request.url === '/open' ? html : guarded).end('<title>Sign in</title><p id=signin>sign in</p><p id=open>never read</p><a href="https://www.youtube.com/watch?v=abcdefghijk">a film</a>');
    if (request.url === '/signin') return answer.writeHead(200, { ...html, 'set-cookie': ['session=1; SameSite=None; Secure; Path=/', 'lax=1; SameSite=Lax; Secure; Path=/'] }).end('in');
    if (request.url === '/leave') return answer.writeHead(200, guarded).end('<script>try { top.location.href = "https://www.shoptrial.test/escaped"; } catch (error) {} try { document.title = String(parent.document.title); } catch (error) { document.title = error.name; }</script><p id=left>leaving');
    // A page that lets itself be framed, and frames another inside itself.
    if (request.url.startsWith('/nest?to=')) return answer.writeHead(200, html).end(`<title>Nest</title><p id=cookie>nest</p><iframe id=in src="${decodeURIComponent(request.url.slice(9)).replace(/"/g, '')}"></iframe>`);
    if (request.url === '/plain') return answer.writeHead(200, html).end('<title>Plain</title><p id=cookie>plain</p>');
    // A signed-in page with everything on it that OWN WEB must never keep, and something for each of the four tools (0.8.2).
    if (request.url === '/letter') return answer.writeHead(200, guarded).end(LETTER);
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
      if (file === 'worker.js' && MUTANT === 'keepoff') {
        const refuses = "if (!(await keeping())) return { why: 'off' };";
        assert.ok(text.includes(refuses), 'the mutant finds what it changes');
        text = text.replace(refuses, '');
      }
      if (file === 'worker.js' && MUTANT === 'nevertool') {
        const guards = "if (typeof at?.result !== 'string' || neverFramed(at.result)) return null;";
        assert.ok(text.includes(guards), 'the mutant finds what it changes');
        text = text.replace(guards, '');
      }
      if (file === 'worker.js' && MUTANT === 'boxes') {
        assert.ok(/const NEVER = '[^']+';/.test(text), 'the mutant finds what it changes');
        text = text.replace(/const NEVER = '[^']+';/, "const NEVER = 'script,style';");
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
    /** Anything a debaser.site page may say to the extension, from `from` (BROWSER's page unless another is given). */
    const say = (message, from = page) => from.evaluate(([extensionId, said]) => new Promise((done) => chrome.runtime.sendMessage(extensionId, said, (answer) => done(chrome.runtime.lastError ? null : (answer ?? null)))), [id, message]);
    return { context, id, page, frameOf, inner, within, text, drawn, told, hold, has, say };
  };

  // ---- Sites added by name, as it has been since 0.7 ----
  console.log('\nADDED BY NAME (shoptrial.test, pairtrial.test)');
  const named = await browserWith('named', NAMED);
  try {
    const { context, page, frameOf, inner, within, text, drawn, told, hold, has, say } = named;
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

    // OWN WEB keeps the pages OWN EYE shows (0.8.2; Luke, 2026-11-27: "Keep every page"). The switch is the extension's own, off for
    // everybody; while it is off the extension hands out no words, whatever debaser.site's page asks (the coordinator, 2026-11-28).
    const LETTER_AT = 'https://www.shoptrial.test/letter';
    await frameOf(LETTER_AT);
    await page.waitForTimeout(700);
    ok((await drawn()) === 'letter' && told.some((each) => each.see === 'at' && each.href === LETTER_AT), 'a signed-in page with boxes on it is shown, and told');
    await inner().locator('#typed').fill('TYPED-LIVE-SECRET');
    await inner().locator('#pass').fill('PASSWORD-LIVE-SECRET');
    await inner().locator('#area').fill('AREA-LIVE-SECRET');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    ok(JSON.stringify(await say({ see: 'keep' })) === JSON.stringify({ see: 'keep', on: false }), "OWN WEB's switch for OWN EYE's pages is off until the reader turns it on");
    const refused = await say({ see: 'words', address: LETTER_AT });
    ok(refused !== null && refused.words === undefined && refused.why === 'off', `with the switch off, BROWSER's page asks for the page's words and gets nothing (${JSON.stringify(refused).slice(0, 80)})`);
    await say({ see: 'keep', on: true });
    ok((await say({ see: 'keep' })).on === false && (await say({ see: 'words', address: LETTER_AT })).words === undefined, "debaser.site's page can't switch it on");
    // The reader's own two presses, on the extension's own SITES page, with the plain words between them.
    const sites = await context.newPage();
    await sites.goto(`chrome-extension://${named.id}/machine.html#sites`);
    await sites.locator('#keep button').click();
    ok((await sites.locator('#keep span').innerText()).startsWith('THE WORDS OF EVERY PAGE OWN EYE SHOWS HERE, SIGNED IN, YOUR MAIL INCLUDED, ARE STORED ON') && (await say({ see: 'keep' })).on === false, 'the first press shows what is stored, in plain words, and turns nothing on');
    await sites.locator('#keep button', { hasText: 'YES, KEEP THEM' }).click();
    await sites.locator('#keep button', { hasText: 'STOP KEEPING' }).waitFor({ timeout: 5000 });
    ok((await say({ see: 'keep' })).on === true, 'the second press turns it on');
    await sites.close();
    await page.bringToFront();
    const given = await say({ see: 'words', address: LETTER_AT });
    const read = JSON.stringify(given?.words ?? null);
    ok(given?.words?.href === LETTER_AT && given.words.title === 'Letter' && given.words.description === 'A letter kept' && read.includes('Dear reader') && read.includes('pick these words') && read.includes('an advert'), `switched on, the words a reader can see are handed to BROWSER's page (${read.slice(0, 120)})`);
    ok(given.words.paragraphs.some((each) => each.heading && each.words === 'Dear reader'), 'a heading comes as a heading');
    ok(SECRETS.every((each) => !read.includes(each)), `never what is in a box (typed, password, hidden, one-time code, text area, editable part), never what is not drawn, never a frame inside the page: ${SECRETS.filter((each) => read.includes(each)).join(' ') || 'none of it'}`);
    ok((await say({ see: 'words', address: 'https://www.shoptrial.test/second' })).words === undefined, 'only for the page BROWSER already knows it is showing: another address gets nothing');

    // Four of BROWSER's tools on a page OWN EYE shows (Luke, 2026-11-28: "MEDIA,SEARCH THIS,WATCHERS,ERASE"), each done by the extension.
    const tool = async (name, more = {}, from = page) => (await say({ see: 'tool', tool: name, ...more }, from))?.found ?? null;
    const media = await tool('media');
    ok(Array.isArray(media) && media.some((each) => each.address === 'https://www.youtube.com/watch?v=abcdefghijk' && each.title === 'a film'), `MEDIA: the videos the page names, by address and title (${JSON.stringify(media).slice(0, 100)})`);
    const watchers = await tool('watchers');
    ok(Array.isArray(watchers) && watchers.some((each) => each.host === 'www.thirdtrial.test') && watchers.every((each) => !each.host.endsWith('shoptrial.test')), `WATCHERS: the outside hosts the page spoke to, never its own (${JSON.stringify(watchers).slice(0, 100)})`);
    ok((await tool('selection')) === '', 'SEARCH THIS: nothing selected is nothing');
    const pick = (id) => inner().evaluate((which) => {
      // As a press on plain words does: whatever box was typed in last lets go.
      document.activeElement?.blur();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById(which));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }, id);
    await pick('pick');
    ok((await tool('selection')) === 'pick these words', 'the words selected on the page are told when the key is pressed');
    await pick('edit');
    ok((await tool('selection')) === '', 'words selected inside an editable part are not');
    await inner().locator('#typed').selectText();
    ok((await tool('selection')) === '', 'nor what is typed in a box, selected');
    await inner().evaluate(() => {
      document.activeElement?.blur();
      getSelection().removeAllRanges();
    });
    ok((await tool('erase', { on: true, erased: [] })) === true, 'ERASE is switched on in the page');
    await inner().locator('#ad').click();
    await page.waitForTimeout(700);
    ok(told.some((each) => each.see === 'erased' && each.selector === '#ad' && each.href === LETTER_AT) && (await drawn()) === 'letter' && !told.some((each) => each.see === 'at' && each.href === 'https://www.shoptrial.test/second' && told.indexOf(each) > told.findIndex((one) => one.see === 'at' && one.href === LETTER_AT)), "a press on a part tells BROWSER which part, and is not followed (the link doesn't open)");
    await tool('erase', { on: false, erased: ['#ad', 'p{display:block} body'] });
    ok(!(await inner().locator('#ad').isVisible()) && (await inner().locator('#pick').isVisible()), "the part on BROWSER's list is gone from the page; what isn't a part's name is dropped");
    await tool('erase', { on: false, erased: [] });
    ok(await inner().locator('#ad').isVisible(), 'BRING BACK puts it back');
    await inner().locator('#film').hover();
    ok((await inner().locator('[data-debaser-see-pointed]').count()) === 0, 'and with ERASE off nothing is pointed at');

    // Switched OFF from BROWSER ([ STOP KEEPING ]): at once.
    ok((await say({ see: 'keep', off: true })).on === false && (await say({ see: 'words', address: LETTER_AT })).words === undefined, '[ STOP KEEPING ] on the site switches it off, and no words are handed out again');
    // On again for the rest (the refusals below are then not the switch's doing), set from the extension's own page.
    const setting = await context.newPage();
    await setting.goto(`chrome-extension://${named.id}/machine.html#sites`);
    await setting.evaluate(() => chrome.storage.local.set({ keep: true }));
    await setting.close();
    await page.bringToFront();
    ok((await say({ see: 'keep' })).on === true && (await say({ see: 'words', address: LETTER_AT })).words !== undefined, 'switched on again, the words are there again');

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
    ok((await say({ see: 'words', address: 'https://accounts.google.com/' })).words === undefined && (await tool('media')) === null && (await tool('selection')) === null, 'and it has no words to keep and no tool to answer, with OWN WEB switched on');
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
    const asksLeave = await say({ see: 'words', address: 'https://www.shoptrial.test/leave' }, other);
    ok(asksLeave.words === undefined && asksLeave.why === 'not-browser' && (await tool('media', {}, other)) === null && (await tool('erase', { on: true, erased: ['#left'] }, other)) === null, "a debaser.site page that isn't BROWSER holding its tab gets no page's words and no tool, switched on or not");
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
    const { context, page, frameOf, inner, within, text, drawn, told, hold, has, say } = every;
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

    // OWN WEB and the four tools with every site allowed: a site never added by name is read the same way, and the never-list never is, even
    // when the framed page moves itself to one that lets itself be framed.
    const tool = async (name, more = {}) => (await say({ see: 'tool', tool: name, ...more }))?.found ?? null;
    ok((await say({ see: 'words', address: 'https://www.shoptrial.test/nest?to=' + encodeURIComponent('https://www.pairtrial.test/') })).why === 'off', 'in this second browser OWN WEB is off, as in every browser until it is switched on there');
    const setting = await context.newPage();
    await setting.goto(`chrome-extension://${every.id}/machine.html#sites`);
    await setting.evaluate(() => chrome.storage.local.set({ keep: true }));
    await setting.close();
    await page.bringToFront();
    const LETTER_ELSEWHERE = 'https://www.othertrial.test/letter';
    await frameOf(LETTER_ELSEWHERE);
    await page.waitForTimeout(700);
    const elsewhere = JSON.stringify((await say({ see: 'words', address: LETTER_ELSEWHERE })).words ?? null);
    ok(elsewhere.includes('Dear reader') && SECRETS.every((each) => !elsewhere.includes(each)) && (await tool('media')).length === 1, 'switched on, a page of a site allowed by EVERY SITE alone is read the same way: its words, nothing in a box');
    await inner().evaluate(() => {
      location.href = 'https://accounts.google.com/open';
    });
    await page.waitForTimeout(1200);
    const neverRead = await say({ see: 'words', address: 'https://accounts.google.com/open' });
    ok((await text(inner(), '#open')) === 'never read' && neverRead.words === undefined && neverRead.why === 'never' && (await say({ see: 'words', address: LETTER_ELSEWHERE })).words === undefined, 'the framed page moves itself to a page on the never-list (sign-ins, banks, payments) that lets itself be framed: none of its words are handed out, whichever address is asked for');
    ok((await tool('media')) === null && (await tool('watchers')) === null && (await tool('selection')) === null && (await tool('erase', { on: true, erased: [] })) === null, 'and no tool acts on it');

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
