// Node host for a GameServer: static files over HTTP (so the browser player loads from the same
// origin) plus WebSocket clients on /ws, and a drift-free fixed-rate simulation loop.
//
//   import { serve } from 'vertex-engine/server'
//   const { url, server, stop } = await serve({ cartridge, port: 8080, root: '.' })

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { acceptWebSockets } from './ws.js';
import { GameServer } from './server.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css' };

export async function serve({ cartridge, port = 8080, host = '0.0.0.0', root = null, seed = Date.now() >>> 0, fps = 60, log = console.log } = {}) {
  const game = new GameServer(cartridge, { seed, fps });
  const base = root ? resolve(root) : null;
  const http = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ title: cartridge.title, players: game.clients.size, entities: game.game.world.entities.length, tick: game.tick, ...game.stats }));
      return;
    }
    if (!base) { res.writeHead(404).end(); return; }
    const file = normalize(join(base, path === '/' ? '/play.html' : path));
    if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  acceptWebSockets(http, (conn) => game.connect(conn), { path: '/ws' });
  await new Promise((r) => http.listen(port, host, r));
  const actual = http.address().port;
  // fixed-step loop with catch-up (bounded), independent of timer jitter
  const dt = 1000 / fps;
  let next = performance.now(), running = true;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    let n = 0;
    while (now >= next && n < 5) { game.step(); next += dt; n++; }
    if (now - next > 250) next = now; // way behind (debugger, sleep): skip ahead, never spiral
    setTimeout(loop, Math.max(0, next - performance.now()));
  };
  loop();
  const url = `http://localhost:${actual}`;
  log?.(`vertex: serving "${cartridge.title ?? 'game'}" at ${url}  (ws: ${url.replace('http', 'ws')}/ws)`);
  return { url, port: actual, server: game, http, stop: () => new Promise((r) => { running = false; for (const c of game.clients.values()) c.conn.close?.(); http.close(() => r()); }) };
}
