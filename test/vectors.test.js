import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePath, flatten, bounds, World, Game, toSVG, toPNG,
  collideOutline, outlinesOverlap, pointInPoly, textPath, textShape, textWidth, animate, procedural,
} from '../src/index.js';
import { segmentsIntersect } from '../src/collision.js';

test('arcs are truly flattened (half circle reaches its apex)', () => {
  const b = bounds(flatten(parsePath('M-10 0 A10 10 0 0 1 10 0')));
  assert.ok(b.minY < -9.9, `apex at ${b.minY}`);
  assert.ok(Math.abs(b.maxX - 10) < 1e-6);
});

test('segment intersection: crossing, touching, parallel, disjoint', () => {
  assert.ok(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0]));
  assert.ok(segmentsIntersect([0, 0], [10, 0], [10, 0], [10, 5]));
  assert.ok(segmentsIntersect([0, 0], [10, 0], [5, 0], [15, 0]));
  assert.ok(!segmentsIntersect([0, 0], [10, 0], [0, 1], [10, 1]));
  assert.ok(!segmentsIntersect([0, 0], [1, 1], [5, 5], [6, 7]));
});

test('pointInPoly', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(pointInPoly([5, 5], sq));
  assert.ok(!pointInPoly([15, 5], sq));
});

test('outline collision is exact where circles lie', () => {
  // Two thin diagonal bars whose bounding circles overlap but outlines do not.
  const w = new World({
    shapes: { bar: { d: 'M-20 -2 L20 -2 L20 2 L-20 2 Z' } },
    entities: [
      { id: 'a', shape: 'bar', x: 0, y: 0, tags: ['a'] },
      { id: 'b', shape: 'bar', x: 0, y: 10, tags: ['b'] },
      { id: 'c', shape: 'bar', x: 0, y: 3, rot: Math.PI / 2, tags: ['b'] },
    ],
  });
  assert.ok(!outlinesOverlap(w, w.get('a'), w.get('b')));
  assert.ok(outlinesOverlap(w, w.get('a'), w.get('c')));
  const g = new Game(w).use(collideOutline([['a', 'b']]));
  const hits = g.step(1).filter((e) => e.type === 'hit').map((e) => e.b);
  assert.deepEqual(hits, ['c']);
});

test('containment counts as overlap', () => {
  const w = new World({
    shapes: { big: { d: 'M-50 -50 L50 -50 L50 50 L-50 50 Z' }, dot: { d: 'M-1 -1 L1 -1 L1 1 Z' } },
    entities: [{ id: 'big', shape: 'big' }, { id: 'dot', shape: 'dot', x: 5, y: 5 }],
  });
  assert.ok(outlinesOverlap(w, w.get('big'), w.get('dot')));
});

test('inline entity geometry renders and collides', () => {
  const w = new World({ entities: [{ id: 'x', d: 'M-5 -5 L5 -5 L5 5 L-5 5 Z', fill: '#f00', x: 20, y: 20 }] });
  assert.ok(Math.abs(w.radius(w.get('x')) - 5 * Math.SQRT2) < 1e-9);
  assert.match(toSVG(w), /M-5 -5 L5 -5/);
});

test('vector text: every glyph is a path, centered layout, width', () => {
  const t = textPath('SCORE 10', 12);
  assert.ok(t.parts.length > 8);
  assert.equal(t.width, textWidth('SCORE 10', 12));
  const s = textShape('HI', 12);
  const b = bounds(s.parts.flatMap((p) => flatten(parsePath(p.d))));
  assert.ok(Math.abs(b.minX + b.maxX) <= 12 / 6 * 1.01, 'centered on origin (within one glyph unit)');
});

test('morph interpolates between shapes with stable endpoints', () => {
  const a = procedural.polygonShape(4, 10).d, b = procedural.starShape(5, 5, 12).d;
  assert.equal(animate.morph(a, b, 0), a);
  assert.equal(animate.morph(a, b, 1), b);
  const mid = animate.morph(a, b, 0.5);
  assert.equal(flatten(parsePath(mid))[0].length, 64 + 1); // 64 samples + closing point
});

test('morphAnim + keyframes systems drive entities', () => {
  const g = new Game({
    entities: [
      { id: 'm', d: 'M0 0 L1 0 L1 1 Z', data: { morph: { a: procedural.polygonShape(3, 10).d, b: procedural.polygonShape(8, 10).d, speed: 1 } } },
      { id: 'k', d: 'M0 0 L1 0', data: { keys: [{ t: 0, x: 0 }, { t: 1, x: 100 }] } },
    ],
  }, { fps: 10 }).use(animate.morphAnim).use(animate.keyframes);
  g.step(5);
  assert.ok(Math.abs(g.world.get('k').x - 50) < 1e-9);
  assert.match(g.world.get('m').d, /^M/);
});

test('procedural shapes are deterministic and valid paths', () => {
  assert.equal(procedural.blobShape(3).d, procedural.blobShape(3).d);
  assert.notEqual(procedural.blobShape(3).d, procedural.blobShape(4).d);
  for (const s of [procedural.ringShape(), procedural.arrowShape(), procedural.starShape()]) {
    assert.ok(flatten(parsePath(s.d)).length >= 1);
  }
});

test('gradients and clips serialize to SVG and rasterize', () => {
  const w = new World({
    width: 40, height: 40,
    shapes: { orb: { d: 'M-10 0 A10 10 0 1 1 10 0 A10 10 0 1 1 -10 0 Z', clip: 'M-10 -10 L10 -10 L10 0 L-10 0 Z',
      fill: { type: 'radial', cx: 0, cy: 0, r: 10, stops: [[0, '#fff'], [1, '#00f']] } } },
    entities: [{ shape: 'orb', x: 20, y: 20 }],
  });
  const svg = toSVG(w);
  assert.match(svg, /radialGradient/);
  assert.match(svg, /clipPath/);
  const png = toPNG(w, { width: 40 });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
});
