import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../examples/drift/drift.js';
import policy from '../examples/drift/policy.js';
import { Recorder, applyRecording, verifyReplay, digest } from '../src/replay.js';

test('a recording replays to the exact same frame', () => {
  const g1 = createGame({ seed: 42 });
  const rec = new Recorder(g1);
  for (let i = 0; i < 240; i++) { policy(g1); g1.step(1); }
  const doc = rec.toJSON({ scene: 'examples/drift/drift.js' });

  assert.equal(doc.vertex, 1);
  assert.equal(doc.seed, 42);
  assert.equal(doc.steps, 240);
  assert.ok(JSON.stringify(doc).length < 40000, 'a recording should be tiny');

  const g2 = createGame({ seed: doc.seed, fps: doc.fps });
  applyRecording(g2, doc);
  verifyReplay(g2, doc);
  assert.equal(digest(g2), digest(g1));
  assert.equal(g2.world.state.score, g1.world.state.score);
  assert.equal(g2.world.state.lives, g1.world.state.lives);
});

test('recordings capture press and release edges, sparsely', () => {
  const g = createGame({ seed: 1 });
  const rec = new Recorder(g);
  g.press('thrust');
  g.step(10);
  g.release('thrust');
  g.step(5);
  g.step(5); // two frames with no input change
  const doc = rec.toJSON();
  assert.deepEqual(doc.inputs, [
    [0, 'p', 'thrust'],
    [10, 'r', 'thrust'],
  ]);
});

test('verifyReplay throws on a corrupted recording', () => {
  const g = createGame({ seed: 3 });
  const rec = new Recorder(g);
  g.press('left');
  g.step(30);
  const doc = rec.toJSON();
  doc.digest = '0000000000000000';
  const g2 = createGame({ seed: doc.seed, fps: doc.fps });
  applyRecording(g2, doc);
  assert.throws(() => verifyReplay(g2, doc), /Replay mismatch/);
});

test('digest is a short stable hash', () => {
  const g = createGame({ seed: 2 });
  g.step(5);
  assert.match(digest(g), /^[0-9a-f]{16}$/);
  const g2 = createGame({ seed: 2 });
  g2.step(5);
  assert.equal(digest(g), digest(g2));
});
