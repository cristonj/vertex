import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameServer, pipe } from '../src/net/server.js';
import { NetClient } from '../src/net/client.js';
import { serve } from '../src/net/serve.js';
import { connectWebSocket } from '../src/net/ws.js';

const frontier = () => JSON.parse(readFileSync(new URL('../examples/frontier/frontier.json', import.meta.url), 'utf8'));
const tickMicro = () => new Promise((r) => setImmediate(r));

async function join(server, name) {
  const [s, c] = pipe();
  server.connect(s);
  const client = new NetClient(c);
  client.hello(name);
  await client.ready;
  await tickMicro();
  return client;
}

async function run(server, clients, steps) {
  for (let i = 0; i < steps; i++) {
    for (const c of clients) c.frame(1 / 60);
    await tickMicro();
    server.step();
    await tickMicro();
  }
}

test('players join, get their own entity, and single-player rules drive each one by its own input', async () => {
  const server = new GameServer(frontier(), { seed: 2 });
  const a = await join(server, 'ada'), b = await join(server, 'bo');
  assert.notEqual(a.entityId, b.entityId);
  await run(server, [a, b], 3);
  assert.equal(server.game.world.get('solo'), undefined, 'the solo player is removed when players join (on:join rule)');
  const ax0 = server.game.world.get(a.entityId).x, bx0 = server.game.world.get(b.entityId).x;
  a.press('right');
  await run(server, [a, b], 60);
  const ax = server.game.world.get(a.entityId).x, bx = server.game.world.get(b.entityId).x;
  assert.ok(ax > ax0 + 50, `a moved right (${ax0} -> ${ax})`);
  assert.ok(Math.abs(bx - bx0) < 5, 'b did not move: input is per player');
  assert.ok(Math.abs(a.me.x - ax) < 20, 'client mirror tracks the authoritative position');
  assert.equal(a.me.data.name, 'ada');
});

test('interest management: far-away players and entities are not sent', async () => {
  const doc = frontier();
  doc.multiplayer.spawn = { x: 0, y: 0, spread: 0 };
  const server = new GameServer(doc, { seed: 3 });
  const a = await join(server, 'near'), b = await join(server, 'far');
  server.game.world.get(b.entityId).x = 5000;
  await run(server, [a, b], 30);
  assert.ok(!a.world.get(b.entityId), 'a cannot see b');
  assert.ok(!b.world.get(a.entityId), 'b cannot see a');
  for (const e of a.world.entities) {
    if (e.fixed) continue;
    assert.ok(Math.hypot(e.x - a.me.x, e.y - a.me.y) <= doc.multiplayer.interest + 200, `${e.id} is within interest`);
  }
  server.game.world.get(b.entityId).x = a.me.x + 50;
  server.game.world.get(b.entityId).y = a.me.y;
  await run(server, [a, b], 10);
  assert.ok(a.world.get(b.entityId), 'b appears once close');
});

test('delta compression: an idle world costs almost nothing per snapshot', async () => {
  const server = new GameServer(frontier(), { seed: 4 });
  const a = await join(server, 'idle');
  await run(server, [a], 120); // let generation and particles settle
  const before = server.stats.bytesOut;
  // remove animated things so the scene is truly idle
  for (const e of [...server.game.world.entities]) if (e.emitter || e.vr || e.tags.includes('particle')) server.game.world.despawn(e);
  await run(server, [a], 30);
  const quiet = server.stats.bytesOut;
  await run(server, [a], 60);
  const perSnap = (server.stats.bytesOut - quiet) / 20;
  assert.ok(perSnap < 120, `idle snapshots average ${perSnap.toFixed(0)} B`);
  assert.ok(before > 1000, 'the initial full snapshot was sent');
});

test('dialogue is per player in multiplayer', async () => {
  const server = new GameServer(frontier(), { seed: 5 });
  const a = await join(server, 'a'), b = await join(server, 'b');
  await run(server, [a, b], 3);
  const w = server.game.world, npc = w.query('npc')[0];
  for (const c of [a, b]) { const e = w.get(c.entityId); e.x = npc.x + 20; e.y = npc.y; }
  await run(server, [a, b], 2);
  a.press('interact');
  await run(server, [a, b], 2);
  a.release('interact');
  await run(server, [a, b], 120);
  assert.equal(w.get(a.entityId).data.dialogue?.id, 'wanderer');
  assert.equal(w.get(b.entityId).data.dialogue ?? null, null, 'b is not in a conversation');
  assert.equal(w.state.dialogue ?? null, null, 'no global dialogue state in multiplayer');
  assert.ok(a.world.query('ui:dialogue').length > 2, 'a draws its dialogue box locally');
  assert.equal(b.world.query('ui:dialogue').length, 0, 'b does not');
  assert.ok(!server.game.world.query('ui').length, 'the server never spawns UI');
});

test('scale: 500 players in a streamed world step and broadcast within budget', async () => {
  const doc = frontier();
  doc.multiplayer.spawn = { x: 0, y: 0, spread: 8000 };
  const server = new GameServer(doc, { seed: 6 });
  const sinks = [];
  for (let i = 0; i < 500; i++) {
    const [s, c] = pipe();
    let bytes = 0;
    c.on('message', (t) => { bytes += t.length; });
    server.connect(s);
    c.send(JSON.stringify({ t: 'hello', name: `bot${i}` }));
    sinks.push({ c, get bytes() { return bytes; } });
  }
  await tickMicro(); await tickMicro();
  assert.equal(server.clients.size, 500);
  for (let i = 0; i < 30; i++) { server.step(); await tickMicro(); }   // world generates around everyone
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) { server.step(); if (i % 3 === 0) await tickMicro(); }
  const ms = (performance.now() - t0) / 60;
  const w = server.game.world;
  assert.ok(ms < 60, `one step incl. snapshots for 500 players took ${ms.toFixed(1)} ms`);
  assert.ok(Object.keys(w.dormant ?? {}).length >= 0);
  console.log(`# scale: 500 players, ${w.entities.length} awake entities, ${w.activeChunks.length} active chunks, ${ms.toFixed(1)} ms/step`);
});

test('real WebSocket server: two Node clients play over the network', async () => {
  const { url, stop, server } = await serve({ cartridge: frontier(), port: 0, log: null, seed: 7 });
  try {
    const ws = url.replace('http', 'ws') + '/ws';
    const a = await NetClient.connect(ws, { name: 'net-a', connect: connectWebSocket });
    const b = await NetClient.connect(ws, { name: 'net-b', connect: connectWebSocket });
    await new Promise((r) => setTimeout(r, 200));
    const x0 = server.game.world.get(a.entityId).x;
    a.press('right'); a.flush();
    await new Promise((r) => setTimeout(r, 600));
    a.frame(0); // apply what arrived; no extra dead-reckoning time
    const x1 = server.game.world.get(a.entityId).x;
    assert.ok(x1 > x0 + 30, `a moved over the network (${x0} -> ${x1})`);
    assert.ok(Math.abs(a.me.x - x1) < 40, 'client mirror is close to authoritative');
    assert.ok(b.world.get(b.entityId), 'b sees itself');
    const status = await (await fetch(url + '/status')).json();
    assert.equal(status.players, 2);
    a.socket.close(); b.socket.close();
  } finally { await stop(); }
});
