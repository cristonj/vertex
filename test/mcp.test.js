import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../mcp/server.js';

const server = createServer();

const call = async (method, params) => {
  const out = await server.handle({ jsonrpc: '2.0', id: 1, method, params });
  return out.result;
};

test('initialize handshake and tools/list', async () => {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.equal(init.serverInfo.name, 'vertex');

  const { tools } = await call('tools/list');
  assert.ok(tools.length >= 7);
  for (const t of tools) {
    assert.ok(t.name && t.description && t.inputSchema, `tool ${t.name} is underspecified`);
  }
});

test('notifications produce no response', async () => {
  const out = await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(out, null);
});

test('load -> step -> observe -> view -> screenshot -> edit -> reset', async () => {
  const load = await call('tools/call', {
    name: 'load',
    arguments: {
      scene: {
        width: 200, height: 100, background: '#000000',
        shapes: { b: { d: 'M-2 -2 L2 -2 L2 2 L-2 2 Z', fill: '#ffffff' } },
        entities: [{ id: 'b1', shape: 'b', x: 50, y: 50, vx: 10, tags: ['box'] }],
      },
      use: ['motion'],
      seed: 7,
    },
  });
  const { session, snapshot } = JSON.parse(load.content[0].text);
  assert.equal(snapshot.entities[0].id, 'b1');

  const step = await call('tools/call', { name: 'step', arguments: { session, steps: 60, tap: ['fire'] } });
  assert.match(step.content[0].text, /frame 60/);

  const obs = await call('tools/call', { name: 'observe', arguments: { session } });
  const after = JSON.parse(obs.content[0].text);
  assert.equal(after.entities[0].x, 60); // 10 u/s * 1s

  const view = await call('tools/call', { name: 'view', arguments: { session } });
  assert.match(view.content[0].text, /^<svg/);

  const shot = await call('tools/call', { name: 'screenshot', arguments: { session, width: 100, height: 50 } });
  assert.equal(shot.content[0].type, 'image');
  assert.equal(shot.content[0].mimeType, 'image/png');
  const png = Buffer.from(shot.content[0].data, 'base64');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const edit = await call('tools/call', {
    name: 'edit',
    arguments: {
      session,
      ops: [
        { op: 'spawn', entity: { id: 'b2', shape: 'b', x: 0, y: 0, tags: ['box'] } },
        { op: 'set', tag: 'box', fields: { vy: 5 } },
        { op: 'state', set: { score: 10 } },
      ],
    },
  });
  assert.match(edit.content[0].text, /applied 3 op/);
  const obs2 = JSON.parse((await call('tools/call', { name: 'observe', arguments: { session } })).content[0].text);
  assert.equal(obs2.entities.length, 2);
  assert.equal(obs2.state.score, 10);

  const reset = await call('tools/call', { name: 'reset', arguments: { session } });
  const fresh = JSON.parse(reset.content[0].text).snapshot;
  assert.equal(fresh.entities.length, 1);
  assert.equal(fresh.entities[0].x, 50); // back to the initial scene, same seed
});

test('unknown session and unknown method are clean errors', async () => {
  const bad = await call('tools/call', { name: 'step', arguments: { session: 'nope' } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /unknown session/);

  const out = await server.handle({ jsonrpc: '2.0', id: 2, method: 'bogus/method' });
  assert.equal(out.error.code, -32601);
});

test('MCP drives a cartridge by path, including physics, scenes and the pointer', async () => {
  const tool = async (name, args) => (await call('tools/call', { name, arguments: args })).content[0].text;
  const loaded = JSON.parse(await tool('load', { path: 'examples/ascent/ascent.json', seed: 2 }));
  const session = loaded.session;
  await tool('step', { session, steps: 2 });                      // start rule -> level1
  const before = JSON.parse(await tool('observe', { session })).entities.find((e) => e.id === 'player');
  const out = await tool('step', { session, steps: 30, press: ['right'], pointer: { x: 10, y: 20 } });
  assert.match(out, /"scene":"level1"/);
  const after = JSON.parse(await tool('observe', { session })).entities.find((e) => e.id === 'player');
  assert.ok(after.x > before.x + 20, 'player ran right under physics');
  const svg = await tool('view', { session });
  assert.match(svg, /data-id="sign"/, 'text entity rendered');
});
