import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, Timeline, divergence, Lockstep, memoryTransport, held, digest, applyRecording, verifyReplay, systems } from '../src/index.js';
import { createGame } from '../examples/drift/drift.js';

const drive = (t, frames) => {
  for (let f = 0; f < frames; f++) {
    if (f % 40 === 0) t.press('fire');
    if (f % 40 === 20) t.release('fire');
    if (f === 30) t.press('left');
    if (f === 90) t.release('left');
    t.step(1);
  }
};

test('saveState/loadState resumes bit-identically', () => {
  const a = createGame({ seed: 5 });
  a.press('fire'); a.press('thrust'); a.step(100);
  const st = JSON.parse(JSON.stringify(a.saveState()));  // survives JSON
  a.step(100);
  const b = createGame({ seed: 999 });
  b.loadState(st);
  b.step(100);
  assert.equal(digest(b), digest(a));
});

test('timeline: seek backwards and forwards reproduces exact frames', () => {
  const t = new Timeline(createGame, { seed: 3, every: 30 });
  drive(t, 240);
  const at240 = digest(t.game);
  t.seek(100);
  const at100 = digest(t.game);
  t.seek(240);
  assert.equal(digest(t.game), at240);
  t.seek(100);
  assert.equal(digest(t.game), at100);
  t.rewind(100);
  assert.equal(t.frame, 0);
});

test('timeline without checkpoints (closure-state games) is still exact', () => {
  const t = new Timeline(createGame, { seed: 3, checkpoints: false });
  drive(t, 120);
  const end = digest(t.game);
  t.seek(10); t.seek(120);
  assert.equal(digest(t.game), end);
});

test('acting in the past truncates the future; branches diverge but share the past', () => {
  const t = new Timeline(createGame, { seed: 8, every: 20 });
  drive(t, 200);
  const original = t.toRecording();
  const b = t.branch(60);
  assert.equal(b.frame, 60);
  b.press('thrust');
  b.step(140);
  const alt = b.toRecording();
  const div = divergence(createGame, original, alt);
  assert.ok(div !== null && div > 60, `diverged at ${div}`);
  // the original timeline is untouched
  t.seek(200);
  assert.equal(t.toRecording().digest, original.digest);
  // and the branch's recording replays exactly through the standard replay path
  const g = applyRecording(createGame({ seed: alt.seed, fps: alt.fps }), alt);
  assert.ok(verifyReplay(g, alt));
});

test('lockstep: two peers exchanging only inputs compute identical worlds', () => {
  const make = () => new Game({
    shapes: { s: { d: 'M-5 0 L5 0' } },
    entities: [{ id: 'p1', shape: 's', x: 100, y: 100 }, { id: 'p2', shape: 's', x: 300, y: 100 }],
  }).use((g, dt) => {
    for (const p of ['p1', 'p2']) {
      const e = g.world.get(p);
      if (held(g, p, 'right')) e.x += 100 * dt;
      if (held(g, p, 'jump')) e.y -= 50 * dt * (1 + g.random());
    }
  }).use(systems.motion);
  const hub = memoryTransport();
  const A = new Lockstep(make(), { id: 'p1', peers: ['p1', 'p2'], transport: hub.connect() });
  const B = new Lockstep(make(), { id: 'p2', peers: ['p1', 'p2'], transport: hub.connect() });
  for (let t = 0; t < 300; t++) {
    if (t === 10) A.press('right');
    if (t === 50) B.press('jump');
    if (t === 120) A.release('right');
    A.commit(); B.commit();
    hub.flush();
    A.advance(); B.advance();
  }
  assert.ok(A.game.world.frame > 290);
  assert.equal(A.game.world.frame, B.game.world.frame);
  assert.equal(digest(A.game), digest(B.game));
  assert.ok(A.game.world.get('p1').x > 150, 'p1 input applied');
  assert.ok(B.game.world.get('p2').y < 100, 'p2 input applied');
});

test('lockstep stalls (never desyncs) when a peer is late', () => {
  const hub = memoryTransport();
  const A = new Lockstep(new Game({}), { id: 'a', peers: ['a', 'b'], transport: hub.connect(), delay: 2 });
  new Lockstep(new Game({}), { id: 'b', peers: ['a', 'b'], transport: hub.connect(), delay: 2 });
  for (let i = 0; i < 10; i++) { A.commit(); hub.flush(); A.advance(); }
  assert.equal(A.game.world.frame, 2); // only the pre-committed frames
});
