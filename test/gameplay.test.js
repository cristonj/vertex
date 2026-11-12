import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Game, World, systems, physics, contact, raycast, pointQuery, nearest, particles, loadCartridge, compileRules,
  toSVG, Recorder, applyRecording, verifyReplay, Timeline, digest,
} from '../src/index.js';

const box = (w, h) => `M${-w / 2} ${-h / 2} H${w / 2} V${h / 2} H${-w / 2} Z`;

test('contact(): box/box, circle/circle, circle/box normals point from A to B', () => {
  const B = (x0, y0, x1, y1) => ({ circle: false, x0, y0, x1, y1 });
  const C = (x, y, r) => ({ circle: true, r, x0: x - r, y0: y - r, x1: x + r, y1: y + r });
  assert.deepEqual(contact(B(0, 0, 10, 10), B(8, 0, 18, 10)), { nx: 1, ny: 0, depth: 2 });
  assert.deepEqual(contact(B(0, 8, 10, 18), B(0, 0, 10, 10)), { nx: 0, ny: -1, depth: 2 });
  assert.equal(contact(B(0, 0, 10, 10), B(10, 0, 20, 10)), null);
  const cc = contact(C(0, 0, 5), C(8, 0, 5));
  assert.deepEqual([cc.nx, cc.ny, cc.depth], [1, 0, 2]);
  const cb = contact(C(5, -3, 5), B(0, 0, 10, 10));
  assert.deepEqual([cb.nx, cb.ny, cb.depth], [0, 1, 2]);
});

test('physics: a body falls, lands on a static floor, and reports ground', () => {
  const g = new Game({
    physics: { gravity: [0, 1000] },
    shapes: { p: { d: box(10, 10) }, floor: { d: box(200, 10) } },
    entities: [{ id: 'p', shape: 'p', x: 100, y: 0, body: {} }, { id: 'f', shape: 'floor', x: 100, y: 100, body: { static: true } }],
  }).use(systems.motion).use(physics);
  g.step(120);
  const p = g.world.get('p');
  assert.ok(Math.abs(p.y - 90) < 0.5, `rests on floor, y=${p.y}`);
  assert.ok(p.body.ground);
  assert.ok(Math.abs(p.vy) < 1e-6);
  assert.equal(g.world.get('f').y, 100, 'static bodies never move');
});

test('physics: restitution bounces, sensors only report, mass splits correction', () => {
  const g = new Game({
    physics: { gravity: [0, 0] },
    shapes: { b: { d: box(10, 10) } },
    entities: [
      { id: 'a', shape: 'b', x: 0, y: 0, vx: 100, body: { restitution: 1 } },
      { id: 'b', shape: 'b', x: 20, y: 0, body: { restitution: 1 } },
      { id: 's', shape: 'b', x: 80, y: 0, body: { sensor: true } },
    ],
  }).use(systems.motion).use(physics);
  const evs = g.step(90);
  const a = g.world.get('a'), b = g.world.get('b');
  assert.ok(Math.abs(a.vx) < 1e-9 && Math.abs(b.vx - 100) < 1e-9, 'equal masses swap velocity elastically');
  assert.ok(evs.some((e) => e.type === 'contact' && e.a === 'b' && e.b === 's'), 'sensor reports');
  assert.ok(b.x > 100, 'sensor does not block');
});

test('physics is deterministic and replays exactly', () => {
  const doc = JSON.parse(readFileSync(new URL('../examples/ascent/ascent.json', import.meta.url), 'utf8'));
  const run = () => {
    const g = loadCartridge(doc, { seed: 4 });
    const rec = new Recorder(g);
    g.press('right');
    for (let f = 0; f < 300; f++) { if (f % 40 === 0) g.press('jump'); if (f % 40 === 20) g.release('jump'); g.step(1); }
    return rec.toJSON();
  };
  const a = run(), b = run();
  assert.equal(a.digest, b.digest);
  assert.ok(verifyReplay(applyRecording(loadCartridge(doc, { seed: 4 }), a), a));
});

test('Ascent: scripted play completes level 1 via physics, contacts, timers and scenes', () => {
  const doc = JSON.parse(readFileSync(new URL('../examples/ascent/ascent.json', import.meta.url), 'utf8'));
  const g = loadCartridge(doc, { seed: 1 });
  let hold = 0;
  const scenes = [];
  for (let f = 0; f < 900 && g.world.state.level < 2; f++) {
    const p = g.world.get('player'), goal = g.world.get('goal');
    if (!p) { for (const e of g.step(1)) if (e.type === 'scene') scenes.push(e.name); continue; }
    if (goal && goal.x > p.x + 4) g.press('right'); else g.release('right');
    const ahead = raycast(g.world, p.x + 14, p.y, 0, 1, { max: 40, tag: 'solid' });
    const wall = raycast(g.world, p.x, p.y, 1, 0, { max: 30, tag: 'solid' });
    if (p.body.ground && !g.input.has('jump') && (!ahead || wall)) { g.press('jump'); hold = 22; } else if (--hold <= 0) g.release('jump');
    for (const e of g.step(1)) if (e.type === 'scene') scenes.push(e.name);
  }
  assert.deepEqual(scenes, ['level1', 'level2']);
  assert.equal(g.world.state.level, 2);
  assert.ok(g.world.get('sign'), 'scene entities replaced');
});

test('raycast, pointQuery, nearest', () => {
  const w = new World({
    shapes: { sq: { d: box(10, 10) } },
    entities: [{ id: 'near', shape: 'sq', x: 50, y: 0, tags: ['t'] }, { id: 'far', shape: 'sq', x: 100, y: 0, tags: ['t'] }],
  });
  const hit = raycast(w, 0, 0, 1, 0);
  assert.equal(hit.entity.id, 'near');
  assert.ok(Math.abs(hit.x - 45) < 1e-9 && Math.abs(hit.distance - 45) < 1e-9);
  assert.equal(raycast(w, 0, 0, 1, 0, { max: 30 }), null);
  assert.equal(raycast(w, 0, 0, 0, 1), null);
  assert.deepEqual(pointQuery(w, 101, 2).map((e) => e.id), ['far']);
  assert.deepEqual(pointQuery(w, 75, 0), []);
  assert.equal(nearest(w, 90, 0, 't').id, 'far');
});

test('text entities render as vector glyph paths and have bounds', () => {
  const w = new World({ entities: [{ id: 'title', text: 'HI', size: 12, x: 50, y: 50 }] });
  const svg = toSVG(w);
  assert.match(svg, /<path data-id="title" d="M[^"]+" fill="none" stroke="#fff" stroke-width="1.5"/);
  assert.ok(w.radius(w.get('title')) > 5);
});

test('timers fire in order, survive save/load, and are cleared by scene changes', () => {
  const g = new Game({ state: { log: '' } }, { fps: 10 }).use(compileRules([
    { on: 'start', do: "after(0.3, 'b'); after(0.1, 'a', {n: 1})" },
    { on: 'a', do: "state.log += 'a' + str(event.n) + ','" },
    { on: 'b', do: "state.log += 'b'" },
  ]));
  g.step(2);
  const saved = JSON.parse(JSON.stringify(g.saveState()));
  g.step(5);
  assert.equal(g.world.state.log, 'a1,b');
  g.loadState(saved); g.step(5);
  assert.equal(g.world.state.log, 'a1,b');
});

test('scenes: goto swaps entities at end of step, merges state, emits scene', () => {
  const g = new Game({
    entities: [{ id: 'old' }], state: { keep: 1 },
    scenes: { two: { entities: [{ id: 'new' }], state: { level: 2 } } },
  }).use(compileRules([{ when: 'frame == 0', do: "goto('two'); state.sameStep = alive('old')" }]));
  const evs = g.step(1);
  assert.equal(g.world.state.sameStep, true);
  assert.deepEqual(g.world.entities.map((e) => e.id), ['new']);
  assert.deepEqual([g.world.state.keep, g.world.state.level, g.world.state.scene], [1, 2, 'two']);
  assert.ok(evs.some((e) => e.type === 'scene' && e.name === 'two'));
  assert.throws(() => g.goto('nope'), /unknown scene/);
});

test('pointer input is recorded and replayed; rules can read it', () => {
  const doc = { state: {}, rules: [{ when: "held('pointer')", do: 'state.x = pointer.x; state.y = pointer.y' }] };
  const g = loadCartridge(doc);
  const rec = new Recorder(g);
  g.point(10, 20); g.press('pointer'); g.step(3); g.point(30, 40); g.step(2);
  const doc2 = rec.toJSON();
  assert.ok(doc2.inputs.some((i) => i[1] === 'm'));
  const g2 = applyRecording(loadCartridge(doc), doc2);
  assert.deepEqual([g2.world.state.x, g2.world.state.y], [30, 40]);
  assert.ok(verifyReplay(g2, doc2));
  const t = new Timeline((o) => loadCartridge(doc, o));
  t.point(5, 6); t.press('pointer'); t.step(2); t.point(7, 8); t.step(2); t.seek(1); t.seek(4);
  assert.equal(t.game.world.state.x, 7);
});

test('particles: rate and burst spawn deterministic, expiring entities', () => {
  const make = () => new Game({
    shapes: { s: { d: 'M-1 0 L1 0' } },
    entities: [{ id: 'em', x: 50, y: 50, emitter: { shape: 's', rate: 20, burst: 5, life: [0.2, 0.4], speed: [10, 20], max: 100 } }],
  }).use(particles).use(systems.motion).use(systems.lifetime);
  const g = make();
  g.step(1);
  assert.equal(g.world.query('particle').length, 5);
  g.step(60);
  const n = g.world.query('particle').length;
  assert.ok(n > 2 && n < 12, `steady state ${n}`);
  const h = make(); h.step(61);
  assert.equal(digest(g), digest(h));
});

test('contact rules bind a/b by tag regardless of pair order', () => {
  const g = new Game({ state: { got: '' } });
  g.world.spawn({ id: 'coin', tags: ['coin'] }); g.world.spawn({ id: 'hero', tags: ['hero'] });
  g.use((game) => game.emit('contact', { a: 'coin', b: 'hero', nx: 1, ny: 0 }));
  g.use(compileRules([{ on: 'contact', tags: ['hero', 'coin'], do: 'state.got = a.id + ">" + b.id' }]));
  g.step(1);
  assert.equal(g.world.state.got, 'hero>coin');
});
