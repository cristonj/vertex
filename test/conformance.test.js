import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadCartridge, digest, toSVG, World } from '../src/index.js';

const suite = JSON.parse(readFileSync(new URL('../conformance/cases.json', import.meta.url), 'utf8'));

test('reference implementation reproduces every conformance digest', () => {
  let n = 0;
  for (const c of suite.cases) {
    const g = loadCartridge(JSON.parse(readFileSync(new URL(`../${c.cartridge}`, import.meta.url), 'utf8')), { seed: c.seed, fps: c.fps });
    const want = new Map(c.digests);
    const last = Math.max(...want.keys());
    let i = 0;
    for (let f = 0; f < last; f++) {
      while (i < c.inputs.length && c.inputs[i][0] === f) { const [, k, a] = c.inputs[i++]; if (k === 'p') g.press(a); else g.release(a); }
      g.step(1);
      if (want.has(g.world.frame)) { assert.equal(digest(g), want.get(g.world.frame), `${c.cartridge} seed ${c.seed} frame ${g.world.frame}`); n++; }
    }
  }
  assert.equal(n, suite.cases.reduce((s, c) => s + c.digests.length, 0));
});

const python = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);

test('second implementation (Python) is bit-identical on the conformance suite', { skip: !python && 'python not installed' }, () => {
  const r = spawnSync(python, ['py/vertex.py', 'conform'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, / 0 failed/);
});

test('SVG gradient ids are valid and deterministic', () => {
  const doc = { shapes: { o: { d: 'M0 0 L1 0 L1 1 Z', fill: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, '#000'], [1, '#fff']] } } }, entities: [{ shape: 'o', x: 5, y: 5 }] };
  const a = toSVG(new World(doc)), b = toSVG(new World(doc));
  assert.equal(a, b);
  assert.match(a, /<linearGradient id="g-o-0"/);
  assert.match(a, /fill="url\(#g-o-0\)"/);
});
