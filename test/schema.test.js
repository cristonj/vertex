import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkScene, assertValidScene } from '../src/validate.js';
import { scene } from '../examples/drift/drift.js';

test('the drift example scene validates', () => {
  assert.equal(assertValidScene(scene), true);
});

test('a bare minimal scene validates', () => {
  assertValidScene({ shapes: { dot: { d: 'M0 0 L1 1' } }, entities: [{ id: 'a', shape: 'dot', x: 3 }] });
});

test('bad scenes fail with precise, fixable paths', () => {
  const errs = checkScene({
    width: 'wide',
    shapes: { a: {}, bad: { parts: [] } },
    entities: [{ shape: 'a', x: 'nope' }, { shape: 'ghost', tags: [1], data: [] }],
  });
  const paths = errs.map((e) => e.path);
  assert.ok(paths.includes('width'));
  assert.ok(paths.includes('shapes.a.d'));
  assert.ok(paths.includes('shapes.bad.parts'));
  assert.ok(paths.includes('entities[0].x'));
  assert.ok(paths.includes('entities[1].shape')); // unknown shape reference
  assert.ok(paths.includes('entities[1].tags'));
  assert.ok(paths.includes('entities[1].data'));
});

test('assertValidScene throws an error an agent can fix', () => {
  assert.throws(() => assertValidScene({ shapes: { a: { d: 5 } } }), /shapes\.a\.d/);
});

test('the shipped JSON Schema describes the drift scene', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/scene.schema.json', import.meta.url), 'utf8'));
  assert.match(schema.$schema, /draft-07/);
  assert.equal(schema.properties.shapes.additionalProperties.$ref, '#/definitions/shape');
  const shape = schema.definitions.shape;
  assert.ok(shape.anyOf.some((r) => r.required?.includes('d')));
  assert.ok(schema.definitions.entity.properties.tags.items.type === 'string');
});
