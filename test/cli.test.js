import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
let recPath; // shared between the run and play tests (same file => sequential)
let recDir;

test('vertex run: policy-driven headless run records a replay + frames', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vertex-cli-'));
  recPath = join(dir, 'rec.json');
  recDir = dir;
  const { stdout } = await run('node', ['bin/vertex.js', 'run', 'examples/drift/drift.js',
    '--seed', '5', '--steps', '120',
    '--policy', 'examples/drift/policy.js',
    '--svg', join(dir, 'frame.svg'), '--png', join(dir, 'frame.png'),
    '--record', recPath], { cwd: ROOT });
  assert.match(stdout, /frame 120/);
  assert.match(stdout, /SCORE/);
  assert.match(stdout, /wrote .*frame\.svg, .*frame\.png, .*rec\.json/);
  assert.ok(readFileSync(join(dir, 'frame.svg'), 'utf8').startsWith('<svg'));
  assert.ok(readFileSync(join(dir, 'frame.png')).length > 500);

  const doc = JSON.parse(readFileSync(recPath, 'utf8'));
  assert.equal(doc.vertex, 1);
  assert.equal(doc.seed, 5);
  assert.equal(doc.steps, 120);
  assert.equal(doc.scene, 'examples/drift/drift.js');
  assert.ok(Array.isArray(doc.inputs) && doc.inputs.length > 0);
});

test('vertex play: the recording reproduces the exact frame', async () => {
  const { stdout } = await run('node', ['bin/vertex.js', 'play', recPath, '--svg', join(recDir, 'replay.svg')], { cwd: ROOT });
  assert.match(stdout, /replay exact/);
  assert.match(stdout, /frame 120/);
  assert.ok(readFileSync(join(recDir, 'replay.svg'), 'utf8').startsWith('<svg'));
});

test('vertex schema: prints the scene JSON Schema', async () => {
  const { stdout } = await run('node', ['bin/vertex.js', 'schema'], { cwd: ROOT });
  const schema = JSON.parse(stdout);
  assert.match(schema.$schema, /draft-07/);
});

test('vertex with no args prints usage; bad command exits 1', async () => {
  const { stdout } = await run('node', ['bin/vertex.js'], { cwd: ROOT });
  assert.match(stdout, /usage|vertex run/);
  await assert.rejects(
    () => run('node', ['bin/vertex.js', 'frobnicate'], { cwd: ROOT }),
    (e) => e.code === 1,
  );
});
