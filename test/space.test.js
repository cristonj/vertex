import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, Game, box, sphere, cylinder, plane, extrude, meshOf, projectSpace, projectPoint, toSVG, loadCartridge, Recorder, applyRecording, verifyReplay, collide3d } from '../src/index.js';

const scene = (entities, camera = { x: 0, y: 0, z: -100 }) => new World({
  width: 200, height: 200,
  space: { camera: { fov: 90, ...camera } },
  shapes: { cube: { mesh: box(20, 20, 20), fill: '#88ccff' } },
  entities,
});

test('mesh builders produce closed, indexed meshes', () => {
  for (const m of [box(), sphere(5, 4, 6), cylinder(), plane(10, 10, 2, 2), extrude('M0 0 L10 0 L10 10 L0 10 Z', 4)]) {
    assert.ok(m.v.length >= 4 && m.f.length >= 1);
    for (const f of m.f) for (const i of f) assert.ok(i >= 0 && i < m.v.length);
  }
  assert.equal(box().f.length, 6);
  assert.equal(extrude('M0 0 L10 0 L10 10 L0 10 Z', 4).f.length, 6); // 4 walls + 2 caps
});

test('a cube seen head-on shows exactly its front face, centered', () => {
  const faces = projectSpace(scene([{ id: 'c', shape: 'cube', x: 0, y: 0, z: 0 }]));
  assert.equal(faces.length, 1, 'back faces culled');
  // front face at z = -10, distance 90, fov 90 -> focal = 100; half-size 10 -> 10*100/90 ≈ 11.1 px
  const xs = faces[0].pts.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) - (100 - 1000 / 90)) < 1e-9);
  assert.ok(Math.abs(Math.max(...xs) - (100 + 1000 / 90)) < 1e-9);
});

test('a cube seen from a corner shows three faces, sorted back to front', () => {
  const faces = projectSpace(scene([{ id: 'c', shape: 'cube', x: 0, y: 0, z: 0, rx: 0.5, ry: 0.7 }]));
  assert.equal(faces.length, 3);
  for (let i = 1; i < faces.length; i++) assert.ok(faces[i - 1].depth >= faces[i].depth);
});

test('entities behind the camera are culled; faces crossing the near plane are clipped', () => {
  assert.equal(projectSpace(scene([{ id: 'b', shape: 'cube', x: 0, y: 0, z: -200 }])).length, 0);
  const near = projectSpace(scene([{ id: 'n', shape: 'cube', x: 0, y: 0, z: -88 }], { x: -30, y: 0, z: -100, near: 15 }));
  assert.ok(near.length >= 1, 'clipped faces still render');
});

test('shading: faces turned away from the light are darker', () => {
  const w = scene([{ id: 'c', shape: 'cube', x: 0, y: 0, z: 0, rx: 0.5, ry: 0.7 }]);
  w.space.light = [0, 1, 0]; w.space.ambient = 0.2;
  const lum = (f) => f.rgb.reduce((a, b) => a + b, 0);
  const faces = projectSpace(w);
  assert.ok(Math.max(...faces.map(lum)) > Math.min(...faces.map(lum)) * 1.2);
});

test('concave faces are ear-clipped into valid triangles', () => {
  const m = meshOf({ src: { extrude: { d: 'M0 0 L10 0 L10 10 L5 4 L0 10 Z', depth: 2 } } });
  const capTris = m.tris[m.tris.length - 1];
  assert.equal(capTris.length, (5 - 2) * 3);
});

test('3D renders into the canonical SVG frame and is deterministic', () => {
  const w = scene([{ id: 'c', shape: 'cube', x: 0, y: 0, z: 0, rx: 0.5, ry: 0.7 }]);
  const svg = toSVG(w);
  assert.equal((svg.match(/data-id="c\.\d"/g) ?? []).length, 3);
  assert.ok(!svg.includes('href="#cube"'), 'no empty <use> for 3D entities');
  assert.equal(svg, toSVG(scene([{ id: 'c', shape: 'cube', x: 0, y: 0, z: 0, rx: 0.5, ry: 0.7 }])));
});

test('projectPoint matches face projection and rejects points behind the camera', () => {
  const w = scene([]);
  assert.deepEqual(projectPoint(w, 0, 0, 0).slice(0, 2), [100, 100]);
  assert.equal(projectPoint(w, 0, 0, -150), null);
});

test('collide3d uses real 3D distance', () => {
  const g = new Game({ shapes: { cube: { mesh: box(10, 10, 10) } }, entities: [
    { id: 'a', shape: 'cube', x: 0, y: 0, z: 0, tags: ['a'] },
    { id: 'near', shape: 'cube', x: 0, y: 0, z: 9, tags: ['b'] },
    { id: 'far', shape: 'cube', x: 0, y: 0, z: 40, tags: ['b'] },
  ] }).use(collide3d([['a', 'b']]));
  assert.deepEqual(g.step(1).map((e) => e.b), ['near']);
});

test('Skyline (3D cartridge) drives, collects and replays exactly', () => {
  const doc = JSON.parse(readFileSync(new URL('../examples/skyline/skyline.json', import.meta.url), 'utf8'));
  const g = loadCartridge(doc, { seed: 3 });
  const rec = new Recorder(g);
  g.press('go'); g.step(90); g.press('left'); g.step(60); g.release('left'); g.step(30);
  const p = g.world.get('player');
  assert.ok(p.z > 100 && Number.isFinite(p.x), `drove forward: ${p.x}, ${p.z}`);
  assert.ok(projectSpace(g.world).length > 20);
  const r = rec.toJSON();
  assert.ok(verifyReplay(applyRecording(loadCartridge(doc, { seed: 3 }), r), r));
});
