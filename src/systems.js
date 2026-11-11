// Built-in systems. Each is a plain function (game, dt) => void — easy for agents to write more.

/** Integrate velocity + angular velocity. Optional per-entity `drag` (0..1 per second). */
export function motion(game, dt) {
  for (const e of game.world.entities) {
    if (e.drag) { const k = Math.pow(1 - e.drag, dt); e.vx *= k; e.vy *= k; }
    e.x += e.vx * dt; e.y += e.vy * dt; e.rot += e.vr * dt;
  }
}

/** Entities tagged "wrap" wrap around the screen edges. */
export function wrap(game) {
  const { width: W, height: H } = game.world;
  for (const e of game.world.query('wrap')) {
    if (e.x < 0) e.x += W; else if (e.x >= W) e.x -= W;
    if (e.y < 0) e.y += H; else if (e.y >= H) e.y -= H;
  }
}

/** Entities with data.ttl (seconds) despawn when it runs out. */
export function lifetime(game, dt) {
  for (const e of [...game.world.entities]) {
    if (e.data.ttl === undefined) continue;
    e.data.ttl -= dt;
    if (e.data.ttl <= 0) game.world.despawn(e);
  }
}

/**
 * Circle-vs-circle collision between tag pairs, using the cached vector bounds.
 * Emits { type: "hit", a, b } events. Usage: collide([["bullet","rock"],["ship","rock"]])
 */
export function collide(pairs) {
  return (game) => {
    const w = game.world;
    for (const [ta, tb] of pairs) {
      for (const a of w.query(ta)) for (const b of w.query(tb)) {
        if (a === b) continue;
        const rr = w.radius(a) + w.radius(b);
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < rr * rr) game.emit('hit', { a: a.id, b: b.id, tags: [ta, tb] });
      }
    }
  };
}
