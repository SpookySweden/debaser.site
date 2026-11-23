/*
 * BROWSER's attack list, once for real (SPEC-seeing-machine.md, Risk 1 and "How each phase is proved"): on SERVER, with the real way out,
 * every service in the house asked for in every way the offline list (Temp/check-see-attack.cjs) has. Every one must be refused, and every
 * socket this process opens is written down: not one may be to an address that isn't public.
 *
 *   node scripts/see-attack-live.cjs          (compiles what it needs into Temp/see-live-out first)
 *
 * It sends nothing to any service here: that is the point. Outside, it asks 1.1.1.2 and 1.1.1.1, example.com, and two public sites that
 * send people on to an address of the asker's choosing.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const diagnostics = require('node:diagnostics_channel');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'app/lib/seeing/server/way-out.ts', 'app/lib/seeing/server/sign-ins.ts', '--rootDir', 'app', '--outDir', 'Temp/see-live-out', '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop', '--strictNullChecks'], { cwd: ROOT, stdio: 'inherit' });
const { wayOut } = require(path.join(ROOT, 'Temp/see-live-out/lib/seeing/server/way-out.js'));
const { safeFetchAnySite } = require(path.join(ROOT, 'Temp/see-live-out/lib/web/safe-fetch.js'));
const { isPublicAddress } = require(path.join(ROOT, 'Temp/see-live-out/lib/web/public-address.js'));

const sockets = [];
diagnostics.subscribe('net.client.socket', ({ socket }) => {
  socket.once('connectionAttempt', (ip, port) => sockets.push({ ip, port }));
  socket.once('connect', () => sockets.push({ ip: socket.remoteAddress, port: socket.remotePort, connected: true }));
});

const way = wayOut({});
const ask = (address) => safeFetchAnySite(address, { way, accept: '*/*', maxBytes: 1_000_000, timeoutMs: 15_000, maxRedirects: 5, types: /./ });

/** What answers on this machine or beside it (the audit's list), and the ports each is at. */
const PORTS = { site: 3000, database: 8000, 'torrent page': 8080, jellyfin: 8096, 'jellyfin bridge': 8098, 'shadow proxy': 8787, engine: 8478, 'remote desktop gateway': 8479, 'remote desktop': 3389, sonarr: 8989, radarr: 7878, prowlarr: 9696, postgres: 5432, ssh: 22, 'windows files': 445 };

(async () => {
  const home = await way.homeAddress();
  assert.ok(home !== null && isPublicAddress(home), "the house's own address is known");
  const own = Object.values(os.networkInterfaces()).flat().map((each) => each.address.split('%')[0]);
  const hosts = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0', '127.1', '2130706433', '0x7f000001', '[::ffff:127.0.0.1]', os.hostname(), `${os.hostname()}.local`, 'debaser-server', home, ...own.map((each) => (each.includes(':') ? `[${each}]` : each)), '192.168.0.1', '192.168.0.154', '172.17.0.1', '100.100.100.100'];
  // Public names that lead home: whoever owns them may point them anywhere.
  const names = ['localtest.me', '127.0.0.1.nip.io', '192.168.0.154.nip.io', '192-168-0-154.sslip.io', '100.64.0.1.nip.io', '10.0.0.1.sslip.io', `${home}.nip.io`];
  let refused = 0;
  const why = new Map();
  const refuse = async (address) => {
    try {
      const answer = await ask(address);
      assert.fail(`${address} WAS FETCHED: ${answer.status} ${answer.url}`);
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error;
      refused += 1;
      why.set(error.message, (why.get(error.message) ?? 0) + 1);
    }
  };
  for (const host of [...new Set([...hosts, ...names])]) {
    for (const port of [80, 443, ...Object.values(PORTS)]) await refuse(`http://${host}:${port}/`);
    await refuse(`https://${host}/`);
    await refuse(`http://user:pass@${host}/`);
  }
  for (const host of ['debaser.site', 'www.debaser.site', 'api.debaser.site', 'screens.debaser.site', 'debaser-site.vercel.app']) await refuse(`https://${host}/`);
  // Sites that send people on to wherever the address says: the first hop is public, the second must not be followed.
  let sent = 0;
  const redirector = async (address, to) => {
    try {
      const answer = await ask(address);
      // It didn't send anybody on (it is busy, or turned us away): no proof either way. It must not be anywhere but itself.
      assert.equal(new URL(answer.url).host, new URL(address).host, `${to} WAS FETCHED by way of ${address}`);
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error;
      if (/NOT A PUBLIC ADDRESS|PORTS/.test(error.message)) sent += 1;
    }
  };
  for (const to of ['http://127.0.0.1:8080/', 'http://192.168.0.154:8000/', 'http://localhost:3000/', `http://${home}/`, 'https://api.debaser.site/', 'http://192.168.0.154.nip.io/']) {
    for (const site of ['https://httpbin.org/redirect-to', 'https://nghttp2.org/httpbin/redirect-to', 'https://postman-echo.com/redirect-to', 'https://httpbingo.org/redirect-to']) await redirector(`${site}?url=${encodeURIComponent(to)}`, to);
  }
  assert.ok(sent > 0, 'at least one site really sent us at the house, and was not followed');
  await refuse('http://malware.testcategory.com/');

  const good = await ask('https://example.com/');
  assert.equal(good.status, 200, 'and an ordinary page is fetched');

  const inside = sockets.filter((each) => !isPublicAddress(String(each.ip), [home]));
  assert.deepEqual(inside, [], 'not one socket to anywhere in the house');
  assert.ok(sockets.some((each) => each.connected), 'the sockets were being watched');
  console.log(`${refused} ways in refused, ${sent} redirects into the house not followed; ${sockets.filter((each) => each.connected).length} sockets opened, every one to a public address that isn't this house.`);
  for (const [reason, count] of why) console.log(`  ${String(count).padStart(5)}  ${reason}`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
