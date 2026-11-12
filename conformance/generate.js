// Regenerates conformance/cases.json from the JS reference implementation.
// Each case: a cartridge, a seed, a scripted input log, and frame digests at checkpoints.
// Any Vertex implementation is conformant ("core" level) if it reproduces every digest.
// Run: node conformance/generate.js
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCartridge, digest, applyInput } from '../src/node.js';

const CHECK = [1, 2, 10, 60, 299, 600, 1200];

// Deterministic scripted inputs: press/release patterns over a cartridge's actions.
function script(actions, seed, frames, pointer, size) {
  const log = [];
  let s = seed * 2654435761 >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const held = new Set();
  for (let f = 0; f < frames; f++) {
    if (pointer && rnd() < 0.05) log.push([f, 'm', Math.floor(rnd() * size[0]), Math.floor(rnd() * size[1])]);
    if (rnd() < 0.03) log.push([f, 'a', rnd() < 0.5 ? 'x' : 'y', Math.round((rnd() * 2 - 1) * 20) / 20]);
    if (rnd() < 0.06) {
      const a = actions[Math.floor(rnd() * actions.length)];
      if (held.has(a)) { held.delete(a); log.push([f, 'r', a]); } else { held.add(a); log.push([f, 'p', a]); }
    }
  }
  return log;
}

// level "core" cases must match bit-for-bit in every implementation; "extended" cases use
// implementation-tolerant math (trig/pow) and are expected, not required, to match.
const cartridges = [
  ['conformance/cartridges/torture.json', 'core'],
  ['examples/starfall/starfall.json', 'core'],
  ['conformance/cartridges/physics.json', 'core'],
  ['conformance/cartridges/streaming.json', 'core'],
  ['examples/ascent/ascent.json', 'extended'],
];
const cases = [];
for (const [path, level] of cartridges) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const actions = [...new Set(Object.values(doc.keys ?? {}))];
  for (const seed of [1, 42, 9001]) {
    const inputs = actions.length ? script(actions, seed, 1200, actions.includes('pointer'), [doc.width ?? 800, doc.height ?? 600]) : [];
    const g = loadCartridge(doc, { seed });
    const digests = [];
    let i = 0;
    for (let f = 0; f < 1200; f++) {
      while (i < inputs.length && inputs[i][0] === f) {
        applyInput(g, inputs[i++]);
      }
      g.step(1);
      if (CHECK.includes(g.world.frame)) digests.push([g.world.frame, digest(g)]);
    }
    cases.push({ cartridge: path, level, seed, fps: 60, inputs, digests });
  }
}
writeFileSync('conformance/cases.json', JSON.stringify({ vertex: 1, cases }, null, 1));
console.log(`wrote ${cases.length} cases, ${cases.reduce((n, c) => n + c.digests.length, 0)} digests`);
