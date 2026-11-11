import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, flatten, bounds, World, Game, systems } from '../src/index.js';
import { createGame } from '../examples/drift/drift.js';

test('parsePath handles relative, implicit lineto, H/V, Z', () => {
  const c = parsePath('m10 10 5 0 v5 h-5 z');
  assert.deepEqual(c, [['M', 10, 10], ['L', 15, 10], ['L', 15, 15], ['L', 10, 15], ['Z']]);
});

test('parsePath reflects S control points', () => {
  const c = parsePath('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
  assert.deepEqual(c[2], ['C', 10, -10, 20, -10, 20, 0]);
});

test('bounds from flattened curves', () => {
  const b = bounds(flatten(parsePath('M-10 0 L10 0 L0 5 Z')));
  assert.equal(b.minX, -10); assert.equal(b.maxX, 10); assert.equal(b.radius, 10);
});

test('world round-trips through JSON', () => {
  const w = new World({ shapes: { dot: { d: 'M0 0 L1 1' } }, entities: [{ id: 'a', shape: 'dot', x: 3 }] });
  const w2 = new World(JSON.parse(JSON.stringify(w)));
  assert.equal(w2.get('a').x, 3);
  assert.ok(w2.shapes.dot);
});

test('motion + collide emit hit events', () => {
  const g = new Game({
    shapes: { c: { d: 'M-5 0 L5 0' } },
    entities: [{ id: 'a', shape: 'c', x: 0, vx: 60, tags: ['a'] }, { id: 'b', shape: 'c', x: 30, tags: ['b'] }],
  }).use(systems.motion).use(systems.collide([['a', 'b']]));
  const evs = g.step(30);
  assert.ok(evs.some((e) => e.type === 'hit' && e.a === 'a' && e.b === 'b'));
});

test('headless runs are deterministic for a seed', () => {
  const run = () => { const g = createGame({ seed: 7 }); g.press('fire'); g.press('left'); g.step(300); return g.toSVG(); };
  assert.equal(run(), run());
});

test('toSVG output is small', () => {
  const g = createGame({ seed: 1 }); g.step(10);
  const svg = g.toSVG();
  assert.match(svg, /^<svg/);
  assert.ok(svg.length < 4000, `frame was ${svg.length} bytes`);
});
