// Headless agent play — and proof that time is data.
// The policy plays Drift; the whole run is recorded as a tiny JSON replay, which is then
// replayed on a fresh instance and verified to reproduce the exact same final frame.
// Run: node examples/drift/agent-play.js
import { writeFileSync } from 'node:fs';
import { createGame } from './drift.js';
import policy from './policy.js';
import { Recorder, applyRecording, verifyReplay, digest } from '../../src/index.js';

const game = createGame({ seed: 42 });
const rec = new Recorder(game);
for (let i = 0; i < 600; i++) {
  policy(game);
  if (game.step(1).some((e) => e.type === 'gameover')) break;
}

const svg = game.toSVG();
writeFileSync(new URL('./last-frame.svg', import.meta.url), svg);

const doc = rec.toJSON({ scene: 'examples/drift/drift.js' });
writeFileSync(new URL('./drift-run.json', import.meta.url), JSON.stringify(doc));

// Prove the claim: replay the recording on a fresh game and compare frames.
const replayed = createGame({ seed: doc.seed, fps: doc.fps });
applyRecording(replayed, doc);
verifyReplay(replayed, doc);

console.log(
  `${game.world.state.hud} | frames ${doc.steps} | replay exact (digest ${digest(game)})` +
  ` | svg ${svg.length}B | input log ${JSON.stringify(doc.inputs).length}B`,
);
