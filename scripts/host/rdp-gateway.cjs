#!/usr/bin/env node
/*
 * The Remote Desktop gateway (SPEC-screens.md; Luke, 2026-11-21: control his server, which has no keyboard or mouse,
 * from REMOTE, "without the need for downloads" on the server). Copied to G:\DEBASER-HOST and kept running there.
 *
 *   browser (the room's REMOTE view, guacamole-common-js)
 *     <-- websocket, through the tunnel: debaser.site/api/screens/rdp-socket?pass=... -->
 *   this program, on 127.0.0.1:8479
 *     <-- the Guacamole protocol, on 127.0.0.1:4822 -->
 *   guacd (Apache Guacamole's translator, in Docker on this PC, container "debaser-guacd")
 *     <-- Windows Remote Desktop, on the home network -->
 *   the server (nothing installed on it: Remote Desktop is part of Windows)
 *
 * Who may connect: only a browser holding a pass the site's own server made for the owner (POST /api/screens/rdp):
 * signed with the secret the two share (SCREENS_RDP_SECRET), good for 60 seconds, once; only while the server remote
 * is switched on (its own switch, off at first: rdp-switch.json beside rdp.env, set by the site through POST /switch,
 * signed with the same secret); and, for anything that came through Cloudflare, only with Cloudflare Access's signed
 * token (the extra lock, below). The server's address and
 * Windows sign-in are read from G:\DEBASER-HOST\rdp.env, which Luke fills in himself; they never reach the browser,
 * and nothing here prints them. A plain look at /health says whether the gateway is up and has a server to reach.
 *
 * No packages: a small websocket server by hand (RFC 6455) and node's own crypto and net.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const HOST_FOLDER = process.env.DEBASER_HOST_FOLDER || 'G:\\DEBASER-HOST';
const SETTINGS = process.env.DEBASER_RDP_SETTINGS || path.join(HOST_FOLDER, 'rdp.env');
const PORT = Number(process.env.DEBASER_RDP_GATEWAY_PORT || 8479);
const GUACD = { host: '127.0.0.1', port: Number(process.env.DEBASER_GUACD_PORT || 4822) };
const PATH = '/api/screens/rdp-socket';
const MAX_MESSAGE = 4 * 1024 * 1024;
const PASS_SECONDS = 60;
/** The page Cloudflare Access guards for unlocking: opened once in a small window, it sets Access's cookie. */
const DOOR = '/api/screens/rdp-door';
/** The server remote's own on/off (Luke, 2026-11-21: "a toggle since it is a separate thing to our tech"). Off until switched on. */
const SWITCH = process.env.DEBASER_RDP_SWITCH || path.join(path.dirname(SETTINGS), 'rdp-switch.json');

function switchedOn() {
  try {
    return JSON.parse(fs.readFileSync(SWITCH, 'utf8')).on === true;
  } catch {
    return false;
  }
}

/* --- the extra lock: Cloudflare Access (one-time email code), checked here too -------------------------------------
 * Luke chose the server remote WITH an extra lock: Cloudflare Access in front of its route, on top of the site's own
 * sign-in. Cloudflare stops anyone without Access's cookie before they reach this PC; this gateway checks Access's
 * signed token on every request that came through Cloudflare as well, so a route left unguarded by mistake still opens
 * nothing. A request that did not come through Cloudflare can only have come from this PC itself.
 * RDP_ACCESS_TEAM (the Zero Trust team name) and RDP_ACCESS_AUD (the application's audience tag) in rdp.env. */

const viaCloudflare = (request) => Boolean(request.headers['cf-connecting-ip'] || request.headers['cf-ray']);

function accessSettings(config) {
  const team = (config.RDP_ACCESS_TEAM || '').trim().toLowerCase();
  const aud = (config.RDP_ACCESS_AUD || '').trim();
  return /^[a-z0-9-]{1,63}$/.test(team) && /^[A-Za-z0-9]{16,128}$/.test(aud) ? { team, aud } : null;
}

let certs = { team: '', keys: null, at: 0 };
async function accessKeys(team) {
  if (certs.team === team && certs.keys && Date.now() - certs.at < 60 * 60 * 1000) return certs.keys;
  const response = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  certs = { team, keys: Array.isArray(body.keys) ? body.keys : [], at: Date.now() };
  return certs.keys;
}

function accessToken(request) {
  const header = request.headers['cf-access-jwt-assertion'];
  if (typeof header === 'string' && header.length > 0) return header;
  const cookie = String(request.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('CF_Authorization='));
  return cookie ? cookie.slice('CF_Authorization='.length) : '';
}

/** Whether a token is Access's own: signed by the team's key, for this application, from that team, not expired. */
async function accessIsGood(token, lock, now = Date.now(), keysFor = accessKeys) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3 || lock === null) return false;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256') return false;
    const jwk = (await keysFor(lock.team)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) return false;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return auds.includes(lock.aud) && claims.iss === `https://${lock.team}.cloudflareaccess.com` && typeof claims.exp === 'number' && claims.exp * 1000 > now;
  } catch {
    return false;
  }
}

/** Why a request may not open the server, or null when it may. */
async function notLetIn(request, config) {
  if (!switchedOn()) return 'THE SERVER REMOTE IS SWITCHED OFF: SWITCH IT ON UNDER [ REMOTE ]';
  if (!viaCloudflare(request)) return null;
  const lock = accessSettings(config);
  if (lock === null) return 'THE EXTRA LOCK (CLOUDFLARE ACCESS) IS NOT SET UP YET, SO THE SERVER IS NOT OPENED OVER THE INTERNET';
  return (await accessIsGood(accessToken(request), lock)) ? null : 'NOT UNLOCKED: PRESS [ UNLOCK WITH AN EMAIL CODE ] FIRST';
}

/** The settings file as name -> value. Read on every connection, so an edit needs no restart. Never printed. */
function settings() {
  const out = {};
  try {
    for (const line of fs.readFileSync(SETTINGS, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=');
      if (at > 0 && !line.trimStart().startsWith('#')) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  } catch {
    /* no file yet */
  }
  return out;
}

const used = new Map();

/** Whether a pass is one the site made: signed with the shared secret, not expired, not used before. */
function passIsGood(pass, secret, now = Date.now()) {
  if (!secret || typeof pass !== 'string') return null;
  const [body, signature] = pass.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now || claims.exp * 1000 > now + PASS_SECONDS * 2000) return null;
  if (typeof claims.nonce !== 'string' || used.has(claims.nonce)) return null;
  for (const [nonce, at] of used) if (at < now - PASS_SECONDS * 2000) used.delete(nonce);
  used.set(claims.nonce, now);
  const size = (n, low, high, fallback) => (Number.isInteger(n) && n >= low && n <= high ? n : fallback);
  return { width: size(claims.width, 320, 7680, 1920), height: size(claims.height, 240, 4320, 1080), dpi: size(claims.dpi, 48, 384, 96) };
}

/* --- the Guacamole protocol: instructions are LENGTH.VALUE,LENGTH.VALUE,...; ------------------------------------- */

function instruction(...elements) {
  return elements.map((e) => `${[...String(e)].length}.${e}`).join(',') + ';';
}

/** Splits text into whole instructions; returns them and whatever is left over (an instruction not yet complete). */
function whole(text) {
  const done = [];
  let start = 0;
  let at = 0;
  for (;;) {
    const dot = text.indexOf('.', at);
    if (dot < 0) break;
    const length = Number(text.slice(at, dot));
    if (!Number.isInteger(length) || length < 0) throw new Error('not the Guacamole protocol');
    // LENGTH counts characters (code points), not bytes.
    let end = dot + 1;
    for (let n = 0; n < length; n += 1) {
      if (end >= text.length) return { done, rest: text.slice(start) };
      const code = text.codePointAt(end);
      end += code > 0xffff ? 2 : 1;
    }
    if (end >= text.length) break;
    const after = text[end];
    if (after === ',') {
      at = end + 1;
    } else if (after === ';') {
      done.push(text.slice(start, end + 1));
      start = end + 1;
      at = start;
    } else {
      throw new Error('not the Guacamole protocol');
    }
  }
  return { done, rest: text.slice(start) };
}

function elements(one) {
  const out = [];
  let at = 0;
  while (at < one.length) {
    const dot = one.indexOf('.', at);
    const length = Number(one.slice(at, dot));
    let end = dot + 1;
    for (let n = 0; n < length; n += 1) end += one.codePointAt(end) > 0xffff ? 2 : 1;
    out.push(one.slice(dot + 1, end));
    at = end + 1;
  }
  return out;
}

/* --- a websocket by hand ---------------------------------------------------------------------------------------- */

function sendFrame(socket, opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  if (!socket.destroyed) socket.write(Buffer.concat([header, data]));
}

/** Reads client frames (masked, as browsers send them) and hands each whole text message on. */
function readFrames(socket, onText, onClose) {
  let buffer = Buffer.alloc(0);
  let pieces = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        at = 10;
      }
      if (!masked || length > MAX_MESSAGE) return onClose('a frame this gateway does not take');
      if (buffer.length < at + 4 + length) return;
      const mask = buffer.subarray(at, at + 4);
      const data = Buffer.from(buffer.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < data.length; i += 1) data[i] ^= mask[i % 4];
      buffer = buffer.subarray(at + 4 + length);
      if (opcode === 0x8) return onClose('the browser closed it');
      if (opcode === 0x9) {
        sendFrame(socket, 0xa, data);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        pieces.push(data);
        if (fin) {
          const text = Buffer.concat(pieces).toString('utf8');
          pieces = [];
          onText(text);
        }
      }
    }
  });
}

/* --- one connection --------------------------------------------------------------------------------------------- */

function connectionFor(socket, size) {
  const config = settings();
  const log = (line) => console.log(`${new Date().toISOString()} ${line}`);
  if (!config.RDP_HOST) {
    sendFrame(socket, 0x1, instruction('error', 'THE SERVER IS NOT SET UP: ITS ADDRESS IS MISSING FROM rdp.env ON THE PC', '519'));
    socket.end();
    return;
  }
  const guacd = net.connect(GUACD);
  let rest = '';
  let joined = false;
  const close = (why) => {
    if (!guacd.destroyed) guacd.destroy();
    if (!socket.destroyed) {
      sendFrame(socket, 0x8, Buffer.alloc(0));
      socket.end();
    }
    if (why) log(`closed: ${why}`);
  };
  guacd.on('connect', () => guacd.write(instruction('select', 'rdp')));
  guacd.on('error', () => {
    sendFrame(socket, 0x1, instruction('error', 'THE PC\'S REMOTE DESKTOP TRANSLATOR (guacd) IS NOT RUNNING', '519'));
    close('guacd could not be reached');
  });
  guacd.on('close', () => close('guacd ended the connection'));
  guacd.setEncoding('utf8');
  guacd.on('data', (text) => {
    let found;
    try {
      found = whole(rest + text);
    } catch (error) {
      return close(error.message);
    }
    rest = found.rest;
    // The handshake (guacd's "args" and "ready") stays between this gateway and guacd, as Guacamole's own server does
    // it; the browser is told the connection's name in the tunnel's own message, then gets everything after.
    const onward = [];
    for (const one of found.done) {
      if (joined) {
        onward.push(one);
        continue;
      }
      const [opcode, ...args] = elements(one);
      {
        if (opcode === 'args') {
          // guacd names the settings it wants, in order; each is answered from the settings file or left empty.
          const values = {
            hostname: config.RDP_HOST,
            port: config.RDP_PORT || '3389',
            username: config.RDP_USER || '',
            password: config.RDP_PASSWORD || '',
            domain: config.RDP_DOMAIN || '',
            security: config.RDP_SECURITY || 'any',
            'ignore-cert': config.RDP_IGNORE_CERT || 'true',
            'resize-method': 'display-update',
            'enable-wallpaper': 'false',
            'enable-font-smoothing': 'true',
            'disable-audio': config.RDP_SOUND === 'on' ? 'false' : 'true',
            'server-layout': config.RDP_KEYBOARD || '',
            'color-depth': '24',
          };
          guacd.write(instruction('size', size.width, size.height, size.dpi));
          guacd.write(instruction('audio', 'audio/L16'));
          guacd.write(instruction('video'));
          guacd.write(instruction('image', 'image/png', 'image/jpeg', 'image/webp'));
          guacd.write(instruction('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone));
          guacd.write(instruction('connect', ...args.map((name) => (name.startsWith('VERSION_') ? name : values[name] ?? ''))));
        } else if (opcode === 'ready') {
          joined = true;
          onward.push(instruction('', args[0] || 'debaser'));
          log(`connected to the server's Remote Desktop (${size.width}x${size.height})`);
        } else if (opcode === 'error') {
          onward.push(one);
        }
      }
    }
    if (onward.length > 0) sendFrame(socket, 0x1, onward.join(''));
  });
  readFrames(
    socket,
    (text) => {
      let found;
      try {
        found = whole(text);
      } catch (error) {
        return close(error.message);
      }
      for (const one of found.done) {
        // The tunnel's own messages (an empty opcode) stay here: a ping is answered, nothing else is passed on.
        if (one.startsWith('0.,')) {
          const [, kind, ...rest2] = elements(one);
          if (kind === 'ping') sendFrame(socket, 0x1, instruction('', 'ping', ...rest2));
          continue;
        }
        if (joined && !guacd.destroyed) guacd.write(one);
      }
    },
    close,
  );
  socket.on('close', () => close(''));
  socket.on('error', () => close('the browser\'s connection failed'));
}

const UNLOCKED_PAGE = `<!doctype html><meta charset="utf-8"><title>UNLOCKED</title>
<body style="background:#000;color:#ffd400;font:14px monospace;padding:16px">UNLOCKED. THIS WINDOW CLOSES ITSELF; THE ROOM CONNECTS TO THE SERVER.
<script>try{window.opener&&window.opener.postMessage('debaser-rdp-unlocked',location.origin)}catch(e){}setTimeout(function(){window.close()},800)</script>`;

function answer(response, status, body, type = 'application/json') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(type === 'application/json' ? JSON.stringify(body) : body);
}

/** Whether a site-server request to switch the remote carries the shared secret's signature, made in the last minute. */
function switchIsSigned(request, on, secret, now = Date.now()) {
  const at = Number(request.headers['x-debaser-at']);
  const signature = String(request.headers['x-debaser-sign'] || '');
  if (!secret || !Number.isFinite(at) || Math.abs(now - at) > PASS_SECONDS * 1000) return false;
  const expected = crypto.createHmac('sha256', secret).update(`switch:${on ? 1 : 0}:${at}`).digest('base64url');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Whether a setup request carries the shared secret's signature over its exact body, made in the last minute. */
function setupIsSigned(request, body, secret, now = Date.now()) {
  const at = Number(request.headers['x-debaser-at']);
  const signature = String(request.headers['x-debaser-sign'] || '');
  if (!secret || !Number.isFinite(at) || Math.abs(now - at) > PASS_SECONDS * 1000) return false;
  const digest = crypto.createHash('sha256').update(body).digest('base64url');
  const expected = crypto.createHmac('sha256', secret).update(`setup:${at}:${digest}`).digest('base64url');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** The lines a setup may change: { RDP_HOST, RDP_USER, RDP_PASSWORD }, each only when given; null when any is not plain. */
function setupLines(body) {
  let asked;
  try {
    asked = JSON.parse(body);
  } catch {
    return null;
  }
  const out = {};
  for (const [field, name, most] of [['host', 'RDP_HOST', 253], ['user', 'RDP_USER', 256], ['password', 'RDP_PASSWORD', 256]]) {
    const value = asked[field];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > most || /[\r\n\0]/.test(value)) return null;
    if (field === 'host' && !/^[A-Za-z0-9.:\-\[\]]+$/.test(value)) return null;
    out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A settings file with one line set; every other line kept as it was. */
function withSetting(text, name, value) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (at >= 0) lines[at] = `${name}=${value}`;
  else {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    lines.push(`${name}=${value}`);
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://gateway');
  const config = settings();
  if (url.pathname === '/health' && !viaCloudflare(request)) {
    return answer(response, 200, { ok: true, serverSet: Boolean(config.RDP_HOST), passesSet: Boolean(config.SCREENS_RDP_SECRET), on: switchedOn(), locked: accessSettings(config) !== null });
  }
  if (url.pathname === '/switch' && request.method === 'POST' && !viaCloudflare(request)) {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 200) request.destroy();
    });
    request.on('end', () => {
      let on;
      try {
        on = JSON.parse(body).on === true;
      } catch {
        return answer(response, 400, { error: 'not a switch' });
      }
      if (!switchIsSigned(request, on, config.SCREENS_RDP_SECRET)) return answer(response, 403, { error: 'Not available.' });
      fs.writeFileSync(SWITCH, JSON.stringify({ on, at: new Date().toISOString() }) + '\n');
      console.log(`${new Date().toISOString()} the server remote switched ${on ? 'ON' : 'OFF'}`);
      return answer(response, 200, { on });
    });
    return;
  }
  if (url.pathname === '/setup' && request.method === 'POST' && !viaCloudflare(request)) {
    // The server's sign-in, typed by Luke into the room's SERVER SIGN-IN form and passed on by the site's server,
    // signed with the shared secret. Written into rdp.env; never logged, never answered back.
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2000) request.destroy();
    });
    request.on('end', () => {
      if (!setupIsSigned(request, body, config.SCREENS_RDP_SECRET)) return answer(response, 403, { error: 'Not available.' });
      const lines = setupLines(body);
      if (lines === null) return answer(response, 400, { error: 'Those cannot be saved.' });
      let text = '';
      try {
        text = fs.readFileSync(SETTINGS, 'utf8');
      } catch {
        /* made below */
      }
      for (const [name, value] of Object.entries(lines)) text = withSetting(text, name, value);
      fs.writeFileSync(SETTINGS, text);
      console.log(`${new Date().toISOString()} the server's sign-in was saved (${Object.keys(lines).join(', ').toLowerCase()})`);
      return answer(response, 200, { serverSet: Boolean(settings().RDP_HOST) });
    });
    return;
  }
  if (url.pathname === DOOR && request.method === 'GET') {
    // Reached through Cloudflare only after Access has let the browser in; checked again here all the same.
    void (async () => {
      const lock = accessSettings(config);
      const open = !viaCloudflare(request) || (lock !== null && (await accessIsGood(accessToken(request), lock)));
      if (url.searchParams.get('check') === '1') return answer(response, open ? 200 : 403, { unlocked: open });
      return open ? answer(response, 200, UNLOCKED_PAGE, 'text/html; charset=utf-8') : answer(response, 403, 'NOT UNLOCKED', 'text/plain');
    })();
    return;
  }
  response.writeHead(404);
  response.end();
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url, 'http://gateway');
  const refuse = (why) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    console.log(`${new Date().toISOString()} refused: ${why}`);
  };
  if (url.pathname !== PATH) return refuse('another address');
  const size = passIsGood(url.searchParams.get('pass'), settings().SCREENS_RDP_SECRET);
  if (!size) return refuse('no good pass');
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') return refuse('not a websocket');
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  const asked = String(request.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (asked.includes('guacamole') ? 'Sec-WebSocket-Protocol: guacamole\r\n' : '') +
      '\r\n',
  );
  socket.setNoDelay(true);
  // The switch and the extra lock are said in words the room can show, over the socket just opened.
  void notLetIn(request, settings()).then((why) => {
    if (why === null) return connectionFor(socket, size);
    sendFrame(socket, 0x1, instruction('error', why, '512'));
    socket.end();
    console.log(`${new Date().toISOString()} refused: ${why.toLowerCase()}`);
  });
});

module.exports = { passIsGood, whole, elements, instruction, accessIsGood, switchIsSigned, setupIsSigned, setupLines, withSetting, notLetIn, viaCloudflare };

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`${new Date().toISOString()} the Remote Desktop gateway listens on 127.0.0.1:${PORT}`));
}
