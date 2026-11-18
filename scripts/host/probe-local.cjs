// Stage 2 local proof: open pages of the PC-hosted dev site in headless Chrome/Edge and list what the browser asked the PC's
// Supabase (127.0.0.1:8000): REST/auth/storage statuses, realtime websockets, failed requests, console errors.
// node probe-local.cjs <base> <path...>   (run from the site checkout so playwright-core resolves)
const { chromium } = require('playwright-core');

(async () => {
  const [base, ...paths] = process.argv.slice(2);
  let browser;
  for (const channel of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* try the next */ }
  }
  if (!browser) throw new Error('no Chrome or Edge');
  for (const path of paths) {
    const page = await browser.newPage();
    const supa = new Map(); const failed = []; const errors = []; const sockets = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.port === '8000' || u.hostname === 'api.debaser.site') { const k = `${r.request().method()} ${u.pathname.split('/').slice(0, 4).join('/')} ${r.status()}`; supa.set(k, (supa.get(k) || 0) + 1); }
      if (u.hostname.endsWith('supabase.co')) failed.push('CLOUD CALL: ' + r.url().slice(0, 100));
    });
    page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('websocket', (ws) => { const s = { url: ws.url().replace(/apikey=[^&]+/, 'apikey=***').slice(0, 90), frames: 0, closed: false }; sockets.push(s); ws.on('framereceived', () => s.frames++); ws.on('close', () => { s.closed = true; }); });
    const res = await page.goto(base + path, { waitUntil: 'load', timeout: 180000 });
    await page.waitForTimeout(12000);
    console.log(`\n== ${path}: page ${res?.status()} | title: ${(await page.title()).slice(0, 60)}`);
    console.log('  calls to the PC\'s Supabase:'); for (const [k, n] of [...supa].sort()) console.log(`    ${k}  x${n}`);
    console.log('  live-update sockets:'); for (const s of sockets) console.log(`    ${s.url}  frames received ${s.frames}${s.closed ? ' (closed)' : ' (open)'}`);
    console.log(`  failed requests (${failed.length}):`); for (const f of failed.slice(0, 8)) console.log('    ' + f);
    console.log(`  console errors (${errors.length}):`); for (const e of errors.slice(0, 8)) console.log('    ' + e);
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });
