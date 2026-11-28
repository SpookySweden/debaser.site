/*
 * Firefox, driven over its own remote protocol (Marionette: a length, a colon, a JSON message), for the drives that need a real Firefox:
 * playwright-core only drives a Firefox of its own making. This fetches no browser: the caller names a firefox.exe that is already there.
 * Nothing here touches cookies, partitioning or SameSite: those stay as Firefox ships them.
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiting = new Map();
    this.next = 1;
    this.hello = new Promise((done) => (this.gotHello = done));
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const colon = this.buffer.indexOf(58);
        if (colon === -1) return;
        const length = Number(this.buffer.subarray(0, colon).toString());
        if (this.buffer.length < colon + 1 + length) return;
        const message = JSON.parse(this.buffer.subarray(colon + 1, colon + 1 + length).toString());
        this.buffer = this.buffer.subarray(colon + 1 + length);
        if (!Array.isArray(message)) this.gotHello(message);
        else if (message[0] === 1) {
          const [, id, error, result] = message;
          const [done, fail] = this.waiting.get(id) ?? [];
          this.waiting.delete(id);
          if (error) fail?.(new Error(`${error.error}: ${error.message}`));
          else done?.(result);
        }
      }
    });
  }
  static async connect(port) {
    for (let tries = 0; tries < 120; tries += 1) {
      const socket = await new Promise((done) => {
        const made = net.connect(port, '127.0.0.1');
        made.once('connect', () => done(made));
        made.once('error', () => done(null));
      });
      if (socket !== null) {
        const client = new Marionette(socket);
        await client.hello;
        return client;
      }
      await sleep(500);
    }
    throw new Error('Firefox did not open its remote port');
  }
  send(name, params = {}) {
    const id = this.next++;
    const text = JSON.stringify([0, id, name, params]);
    return new Promise((done, fail) => {
      this.waiting.set(id, [done, fail]);
      this.socket.write(`${Buffer.byteLength(text)}:${text}`);
    });
  }
  /** A script that answers by calling its last argument; `chrome`: in the browser's own window, not the page. */
  async script(script, args = [], chrome = false) {
    if (chrome) await this.send('Marionette:SetContext', { value: 'chrome' });
    try {
      return (await this.send('WebDriver:ExecuteAsyncScript', { script, args, scriptTimeout: 20000 })).value;
    } finally {
      if (chrome) await this.send('Marionette:SetContext', { value: 'content' });
    }
  }
  /** In the page: the value a plain script returns. */
  async read(script, args = []) {
    return (await this.send('WebDriver:ExecuteScript', { script, args, scriptTimeout: 20000 })).value;
  }
  /** A press on an element a script finds, as a hand's (the browser counts it as one). */
  async press(script, args = []) {
    const found = await this.read(script, args);
    const id = found?.[ELEMENT];
    if (id === undefined) return false;
    await this.send('WebDriver:ElementClick', { id });
    return true;
  }
}

/**
 * A Firefox of the caller's, on a profile of its own in `dir`, headless. `prefs` are added to the few that keep a first run quiet; none of
 * them is about cookies. Its automation's own "recommended" settings are off, so the browser is as it ships.
 */
async function launchFirefox({ exe, dir, prefs = {} }) {
  if (typeof exe !== 'string' || !fs.existsSync(exe)) throw new Error('--exe <firefox.exe> is needed: this script fetches no browser');
  const profile = path.join(dir, 'firefox-profile');
  fs.mkdirSync(profile, { recursive: true });
  const port = 2828 + Math.floor(Math.random() * 500);
  const all = {
    'marionette.port': port,
    'remote.prefs.recommended': false,
    'network.proxy.type': 0,
    'browser.shell.checkDefaultBrowser': false,
    'browser.aboutwelcome.enabled': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'startup.homepage_welcome_url': '',
    'startup.homepage_welcome_url.additional': '',
    'datareporting.policy.dataSubmissionEnabled': false,
    'datareporting.healthreport.uploadEnabled': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'app.update.disabledForTesting': true,
    'browser.tabs.warnOnClose': false,
    'browser.sessionstore.resume_from_crash': false,
    ...prefs,
  };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(all).map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`).join('\n'));
  const child = spawn(exe, ['-marionette', '-headless', '-no-remote', '-new-instance', '-profile', profile, '-wait-for-browser'], { stdio: 'ignore' });
  const client = await Marionette.connect(port);
  await client.send('WebDriver:NewSession', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const version = await client.script("arguments[0](Services.appinfo.version)", [], true);
  return {
    client,
    version,
    close: async () => {
      await client.send('Marionette:Quit', { flags: ['eForceQuit'] }).catch(() => undefined);
      await sleep(1500);
      child.kill();
    },
  };
}

module.exports = { Marionette, launchFirefox, sleep };
