// Headless play: how an agent drives a Vertex game. Run: node examples/drift/agent-play.js
// Observes JSON snapshots, chooses actions, and writes the final frame as an SVG.
import { writeFileSync } from 'node:fs';
import { createDrift } from './drift.js';

const game = createDrift({ seed: 42 });
game.press('fire');

for (let t = 0; t < 600; t++) {
  const snap = game.snapshot();
  const ship = snap.entities.find((e) => e.id === 'ship');
  const rocks = snap.entities.filter((e) => e.tags.includes('rock'));
  if (ship && rocks.length) {
    // naive policy: rotate toward nearest rock and keep firing
    const r = rocks.reduce((a, b) => (Math.hypot(a.x - ship.x, a.y - ship.y) < Math.hypot(b.x - ship.x, b.y - ship.y) ? a : b));
    const want = Math.atan2(r.y - ship.y, r.x - ship.x);
    const diff = Math.atan2(Math.sin(want - ship.rot), Math.cos(want - ship.rot));
    game.release('left'); game.release('right');
    if (diff < -0.05) game.press('left'); else if (diff > 0.05) game.press('right');
  }
  for (const ev of game.step()) if (ev.type === 'gameover') t = Infinity;
}

const out = new URL('./last-frame.svg', import.meta.url);
writeFileSync(out, game.toSVG());
console.log(game.world.state.hud, `| frame ${game.world.frame} | wrote ${out.pathname}`);
