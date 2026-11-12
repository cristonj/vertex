// Minimal, zero-dependency WebSocket (RFC 6455) for Node: a server that upgrades node:http
// requests, and a small client for Node versions without a global WebSocket. Text frames only
// (JSON), fragmented messages, ping/pong, close, and a frame size limit. Browsers use their
// native WebSocket against the same server.

import { createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20; // 1 MiB per message: inputs are tiny, snapshots are chunked by interest

/** A WebSocket connection over a raw socket. Emits 'message' (string), 'close'. */
export class Connection extends EventEmitter {
  constructor(socket, { client = false } = {}) {
    super();
    this.socket = socket; this.client = client; this.open = true;
    this.buf = Buffer.alloc(0); this.parts = [];
    socket.setNoDelay?.(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME) { this.close(1009); return; }
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = this.buf.subarray(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        this.parts.push(payload);
        if (fin) { const msg = Buffer.concat(this.parts).toString('utf8'); this.parts = []; this.emit('message', msg); }
      }
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length, mask = this.client;
    const head = Buffer.alloc(2 + (len < 126 ? 0 : len < 65536 ? 2 : 8) + (mask ? 4 : 0));
    head[0] = 0x80 | op;
    let off = 2;
    if (len < 126) head[1] = len;
    else if (len < 65536) { head[1] = 126; head.writeUInt16BE(len, 2); off = 4; }
    else { head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); off = 10; }
    if (mask) {
      head[1] |= 0x80;
      const m = randomBytes(4); m.copy(head, off);
      const p = Buffer.from(payload);
      for (let i = 0; i < p.length; i++) p[i] ^= m[i & 3];
      payload = p;
    }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(text) { this.frame(0x1, Buffer.from(text, 'utf8')); }
  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.frame(0x8, p);
    this.open = false;
    this.socket.end();
    this.closed();
  }
  closed() { if (this._done) return; this._done = true; this.open = false; this.emit('close'); }
  get bufferedAmount() { return this.socket.writableLength ?? 0; }
}

/** Attach WebSocket upgrades to an http.Server. `onConnection(conn, req)` per client. */
export function acceptWebSockets(server, onConnection, { path = null } = {}) {
  server.on('upgrade', (req, socket) => {
    if (path && new URL(req.url, 'http://x').pathname !== path) { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    onConnection(new Connection(socket), req);
  });
}

/** Node client: resolves to a Connection-compatible object ({ send, close, on('message') }). */
export function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = randomBytes(16).toString('base64');
    const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (res, socket, head) => {
      const want = createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== want) { socket.destroy(); reject(new Error('bad websocket handshake')); return; }
      const c = new Connection(socket, { client: true });
      if (head?.length) c.onData(head);
      resolve(c);
    });
    req.on('error', reject);
    req.on('response', (res) => reject(new Error(`websocket upgrade refused: HTTP ${res.statusCode}`)));
    req.end();
  });
}
