// The vertex CLI: run a scene headless, replay recordings, print the scene schema, serve MCP.
// Zero dependencies (node:util parseArgs). Examples:
//   vertex run examples/drift/drift.js --seed 42 --steps 300 --policy examples/drift/policy.js --svg frame.svg
//   vertex play examples/drift/drift-run.json --png frame.png
//   vertex schema
//   vertex mcp
import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { loadSceneModule, createFrom } from './load.js';
import { Recorder, applyRecording, verifyReplay, digest } from './replay.js';
import { toPNG } from './node.js';
import { divergence } from './timeline.js';
import { runMCPServer } from '../mcp/server.js';

const OPTIONS = {
  seed: { type: 'string', short: 's' },
  fps: { type: 'string' },
  steps: { type: 'string', short: 'n' },
  policy: { type: 'string' },
  svg: { type: 'string' },
  png: { type: 'string' },
  record: { type: 'string' },
  json: { type: 'boolean' },
  at: { type: 'string' },
  width: { type: 'string' },
};

const USAGE = `vertex — the vector-native, agent-first game engine

  vertex run <scene.js> [--seed N] [--steps N] [--fps N] [--policy policy.js]
            [--svg out.svg] [--png out.png] [--record rec.json] [--json]
      Run a scene headless. A policy module (default export: policy(game)) drives
      the inputs, exactly like a human pressing keys. --record writes the whole
      run as a tiny JSON replay file.

  vertex play <recording.json> [--svg out.svg] [--png out.png] [--json]
      Replay a recording exactly and verify it reproduces the recorded frame.
      Exit code 1 if the replay does not match (a bug report that always reproduces).

  vertex play <recording.json> --at <frame> [--svg f.svg] [--png f.png] [--width W]
      Scrub: render any frame of a recording (time is data — every frame is recoverable).

  vertex diff <a.json> <b.json>
      Replay two recordings of the same scene side by side and report the first frame
      where their worlds differ (compare two strategies, or bisect a desync).

  vertex schema
      Print the JSON Schema for scene documents (schema/scene.schema.json).

  vertex mcp
      Serve the Vertex MCP server on stdio (tools: load, step, observe, view,
      screenshot, edit, reset) for Claude Desktop and other MCP clients.`;

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'run') await cmdRun(rest);
    else if (cmd === 'play') await cmdPlay(rest);
    else if (cmd === 'diff') await cmdDiff(rest);
    else if (cmd === 'schema') cmdSchema(rest);
    else if (cmd === 'mcp') runMCPServer();
    else {
      if (cmd) console.error(`Unknown command: ${cmd}`);
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
    }
  } catch (e) {
    console.error(`vertex: ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdRun(args) {
  const { positionals, values } = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  const scenePath = positionals[0];
  if (!scenePath) throw new Error('usage: vertex run <scene.js> [options]');
  const opts = { seed: num(values.seed) ?? 1 };
  if (values.fps) opts.fps = num(values.fps);

  const mod = await loadSceneModule(scenePath);
  const game = createFrom(mod, opts);
  const recorder = values.record ? new Recorder(game) : null;

  let policy = null;
  if (values.policy) {
    const m = await loadSceneModule(values.policy);
    policy = m.default ?? m.policy ?? null;
    if (typeof policy !== 'function') throw new Error(`policy module must export a function`);
  }

  const steps = num(values.steps) ?? 600;
  let over = false;
  for (let i = 0; i < steps && !over; i++) {
    if (policy) policy(game);
    over = game.step(1).some((e) => e.type === 'gameover');
  }

  const files = [];
  if (values.svg) { writeFileSync(values.svg, game.toSVG()); files.push(values.svg); }
  if (values.png) { writeFileSync(values.png, toPNG(game.world)); files.push(values.png); }
  if (recorder) {
    const doc = recorder.toJSON({ scene: rel(scenePath) });
    writeFileSync(values.record, JSON.stringify(doc));
    files.push(values.record);
  }
  report(game, files, values.json, over, recorder);
}

async function cmdPlay(args) {
  const { positionals, values } = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  const recPath = positionals[0];
  if (!recPath) throw new Error('usage: vertex play <recording.json> [options]');
  const rec = JSON.parse(readFileSync(recPath, 'utf8'));
  if (rec.vertex !== 1) throw new Error(`unsupported recording version: ${rec.vertex}`);

  const mod = await loadSceneModule(findScene(rec.scene, recPath));
  const game = createFrom(mod, { seed: rec.seed, fps: rec.fps });
  const at = num(values.at);
  if (at !== undefined && (at < 0 || at > rec.steps)) throw new Error(`--at must be within 0..${rec.steps}`);
  applyRecording(game, at !== undefined ? { ...rec, steps: at } : rec);

  let exact = true;
  if (at === undefined) {
    try { verifyReplay(game, rec); } catch (e) { exact = false; console.error(`vertex: ${e.message}`); }
  }

  const files = [];
  const width = num(values.width);
  if (values.svg) { writeFileSync(values.svg, game.toSVG()); files.push(values.svg); }
  if (values.png) { writeFileSync(values.png, toPNG(game.world, width ? { width, height: Math.round(width * game.world.height / game.world.width) } : {})); files.push(values.png); }
  report(game, files, values.json, false, null);
  if (at !== undefined) console.log(`scrubbed to frame ${at} of ${rec.steps}`);
  else console.log(`replay ${exact ? 'exact' : 'MISMATCH'} (${rec.steps} steps from seed ${rec.seed})`);
  if (!exact) process.exitCode = 1;
}

async function cmdDiff(args) {
  const { positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  const [pa, pb] = positionals;
  if (!pa || !pb) throw new Error('usage: vertex diff <a.json> <b.json>');
  const a = JSON.parse(readFileSync(pa, 'utf8')), b = JSON.parse(readFileSync(pb, 'utf8'));
  const mod = await loadSceneModule(findScene(a.scene, pa));
  const f = divergence((o) => createFrom(mod, o), a, b);
  if (f === null) console.log(`identical for all ${Math.min(a.steps, b.steps)} shared frames`);
  else console.log(`diverge at frame ${f}`);
}

function cmdSchema(args) {
  const { values } = parseArgs({ args, options: { out: { type: 'string' } } });
  const schema = readFileSync(new URL('../schema/scene.schema.json', import.meta.url), 'utf8');
  if (values.out) { writeFileSync(values.out, schema); console.log(`wrote ${values.out}`); }
  else console.log(schema);
}

function report(game, files, asJSON, over, recorder) {
  if (asJSON) console.log(JSON.stringify(game.snapshot(), null, 2));
  const hud = game.world.state.hud ? ` | ${game.world.state.hud}` : '';
  const dig = recorder ? recorder.toJSON().digest : digest(game);
  console.log(`frame ${game.world.frame}${over ? ' | gameover' : ''}${hud} | digest ${dig}` +
    (files.length ? ` | wrote ${files.join(', ')}` : ''));
}

function rel(p) {
  return relative(process.cwd(), resolve(p)).replace(/\\/g, '/') || p;
}

/** A recording names its scene relative to the cwd at record time; also try the recording's own folder. */
function findScene(scene, recPath) {
  if (!scene) throw new Error('recording has no "scene" field');
  for (const c of [resolve(scene), resolve(dirname(recPath), scene)]) {
    if (existsSync(c)) return c;
  }
  throw new Error(`scene module not found for recording: ${scene}`);
}

function num(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${v}"`);
  return n;
}
