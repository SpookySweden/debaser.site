/**
 * A minimal CDP client, hand-rolled because this is a scratch script and a WebSocket library would be a new
 * dependency for a diagnostic. `node:http` fetches the target list and `node:crypto` does the handshake; frames
 * are then written and read directly.
 */
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

function getJson(port, route) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: route }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`bad JSON from ${route}: ${body.slice(0, 200)}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('timeout')));
  });
}

/** One WebSocket, framed by hand. Only what CDP needs: a text frame out, a text frame in, and a ping/pong. */
class Socket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiters = new Map();
    this.nextId = 1;
    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  static connect(wsUrl) {
    const { hostname, port, pathname } = new URL(wsUrl);

    return new Promise((resolve, reject) => {
      const socket = net.connect(Number(port), hostname, () => {
        const key = crypto.randomBytes(16).toString('base64');
        socket.write(
          `GET ${pathname} HTTP/1.1\r\n` +
            `Host: ${hostname}:${port}\r\n` +
            'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });

      let handshake = '';
      const onHandshake = (chunk) => {
        handshake += chunk.toString('latin1');
        const end = handshake.indexOf('\r\n\r\n');
        if (end === -1) return;
        socket.off('data', onHandshake);
        if (!handshake.startsWith('HTTP/1.1 101')) {
          reject(new Error(`handshake failed: ${handshake.split('\r\n')[0]}`));
          return;
        }
        const rest = Buffer.from(handshake.slice(end + 4), 'latin1');
        const client = new Socket(socket);
        if (rest.length > 0) {
          client.buffer = rest;
          client.drain();
        }
        resolve(client);
      };

      socket.on('data', onHandshake);
      socket.on('error', reject);
    });
  }

  /** Pull whole frames off the buffer. Server frames are unmasked, so the payload is a straight slice. */
  drain() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const opcode = this.buffer[0] & 0x0f;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);

      if (opcode === 0x8) return; // close
      if (opcode === 0x9) {
        this.write(0x0a, payload); // ping -> pong
        continue;
      }
      if (opcode !== 0x1) continue; // only text carries CDP

      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch {
        continue;
      }
      const waiter = this.waiters.get(message.id);
      if (waiter) {
        this.waiters.delete(message.id);
        waiter(message);
        continue;
      }
      // A CDP *event* rather than a response: no id, and only of interest to whoever set `onEvent`.
      if (typeof this.onEvent === 'function') this.onEvent(message);
    }
  }

  write(opcode, payload) {
    const mask = crypto.randomBytes(4);
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length < 65_536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    header[0] = 0x80 | opcode;
    const masked = Buffer.from(payload);
    for (let index = 0; index < masked.length; index += 1) masked[index] ^= mask[index % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const body = Buffer.from(JSON.stringify({ id, method, params }), 'utf8');

    return new Promise((resolve, reject) => {
      this.waiters.set(id, (message) => {
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      this.write(0x1, body);
      setTimeout(() => {
        if (this.waiters.delete(id)) reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  close() {
    try {
      this.socket.destroy();
    } catch {
      /* already gone */
    }
  }
}

module.exports = { getJson, Socket };
