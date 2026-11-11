// A minimal agent policy for Drift — the same actions a human has: left/right/thrust/fire.
// Used by agent-play.js and by the CLI:  vertex run examples/drift/drift.js --policy examples/drift/policy.js
export default function policy(game) {
  const w = game.world;
  const ship = w.get('ship');
  if (!ship) return;
  game.press('fire');
  const rocks = w.query('rock');
  if (!rocks.length) return;
  const r = rocks.reduce((a, b) => (d2(a, ship) < d2(b, ship) ? a : b));
  const want = Math.atan2(r.y - ship.y, r.x - ship.x);
  const diff = Math.atan2(Math.sin(want - ship.rot), Math.cos(want - ship.rot));
  game.release('left');
  game.release('right');
  if (diff < -0.05) game.press('left');
  else if (diff > 0.05) game.press('right');
}

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
