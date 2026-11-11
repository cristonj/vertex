import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { World } from '../src/world.js';
import { toPNG, parseColor } from '../src/png.js';
import { createGame } from '../examples/drift/drift.js';

/** Decode a single-IDAT PNG into { width, height, raw } for pixel assertions. */
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.toString('ascii', 37, 41), 'IDAT');
  return { width, height, raw: inflateSync(png.subarray(41, 41 + idatLen)) };
}

function pixel(d, x, y) {
  const i = y * (1 + d.width * 3) + 1 + x * 3;
  return [d.raw[i], d.raw[i + 1], d.raw[i + 2]];
}

test('toPNG emits a valid, deterministic PNG of the right dimensions', () => {
  const g = createGame({ seed: 1 });
  g.step(3);
  const png = toPNG(g.world);
  assert.ok(png.length > 500, `png was only ${png.length} bytes`);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 600);
  const d = decode(png);
  assert.equal(d.raw.length, 600 * (1 + 800 * 3));
  assert.deepEqual(toPNG(g.world), png);
});

test('toPNG rasterizes geometry where it should be', () => {
  const doc = {
    width: 100, height: 100, background: '#000000',
    shapes: { sq: { d: 'M10 10 L30 10 L30 30 L10 30 Z', fill: '#ff0000' } },
    entities: [{ id: 's', shape: 'sq' }],
  };
  const d = decode(toPNG(new World(doc)));
  assert.deepEqual(pixel(d, 15, 15), [255, 0, 0]); // inside the square
  assert.deepEqual(pixel(d, 5, 5), [0, 0, 0]);     // outside, background
  assert.deepEqual(pixel(d, 35, 35), [0, 0, 0]);
});

test('toPNG renders strokes and scales to any resolution', () => {
  const doc = {
    width: 100, height: 100, background: '#101010',
    shapes: { line: { d: 'M20 50 L80 50', stroke: '#00ff00', width: 4 } },
    entities: [{ id: 'l', shape: 'line' }],
  };
  const d = decode(toPNG(new World(doc), { width: 50, height: 50 }));
  assert.equal(d.width, 50);
  assert.deepEqual(pixel(d, 25, 25), [0, 255, 0]); // mid-line, 2x supersampled
  assert.deepEqual(pixel(d, 5, 5), [16, 16, 16]);  // background
});

test('parseColor handles the formats art actually uses', () => {
  assert.deepEqual(parseColor('#7df9ff'), [125, 249, 255]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('cyan'), [0, 255, 255]);
  assert.deepEqual(parseColor('rgb(10 20 30)'), [10, 20, 30]);
  assert.equal(parseColor('none'), null);
  assert.equal(parseColor('not-a-color'), null);
});
