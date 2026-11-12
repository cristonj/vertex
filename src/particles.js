// Vector particles as data. Any entity can carry an emitter; particles are ordinary entities
// (so they render, collide, serialize and rewind like everything else).
//
// emitter: {
//   shape: "spark",            // or d: "M..." / text: "+1" with fill/stroke/width
//   rate: 30,                  // particles per second (0 = only bursts)
//   burst: 0,                  // emit this many once, on the next step, then reset to 0
//   life: [0.3, 0.8],          // seconds, random in range
//   speed: [40, 120],          // world units / second
//   angle: [0, 6.283],         // radians, world space (0 = +x); "spread" around the emitter's rot if relative: true
//   relative: false,
//   shrink: true,              // scale falls to 0 over the particle's life
//   gravity: 0,                // added to vy per second
//   drag: 0, tags: ["fx"], max: 500,
// }
// Uses the game RNG (deterministic) and sin/cos (implementation-tolerant, SPEC.md §8).

const pick = (game, r, dflt) => {
  if (r === undefined) return dflt;
  if (typeof r === 'number') return r;
  return r[0] + game.random() * (r[1] - r[0]);
};

export function particles(game, dt) {
  if (game.server) return; // cosmetic: network clients emit locally from the synced emitters
  const w = game.world;
  // age existing particles (shrink + gravity)
  for (const p of w.entities) {
    const pd = p.data?.particle;
    if (!pd) continue;
    if (pd.gravity) p.vy += pd.gravity * dt;
    if (pd.shrink && pd.life > 0) p.scale = pd.scale0 * Math.max(0, p.data.ttl / pd.life);
  }
  for (const e of [...w.entities]) {
    const em = e.emitter;
    if (!em) continue;
    em.acc = (em.acc ?? 0) + (em.rate ?? 0) * dt;
    let n = Math.floor(em.acc) + (em.burst ?? 0);
    em.acc -= Math.floor(em.acc);
    em.burst = 0;
    const live = em.max ? w.query(`fx:${e.id}`).length : 0;
    if (em.max) n = Math.min(n, Math.max(0, em.max - live));
    for (let i = 0; i < n; i++) {
      const life = pick(game, em.life, 0.5);
      const speed = pick(game, em.speed, 60);
      const angle = pick(game, em.angle, game.random() * Math.PI * 2) + (em.relative ? e.rot : 0);
      const scale = pick(game, em.scale, 1);
      w.spawn({
        shape: em.shape, d: em.d, text: em.text, fill: em.fill, stroke: em.stroke, width: em.width,
        x: e.x, y: e.y, rot: angle, scale, layer: em.layer ?? e.layer,
        vx: Math.cos(angle) * speed + (em.inherit ? e.vx : 0), vy: Math.sin(angle) * speed + (em.inherit ? e.vy : 0),
        drag: em.drag, vr: pick(game, em.spin, 0),
        tags: [...(em.tags ?? []), 'particle', `fx:${e.id}`],
        data: { ttl: life, particle: { life, scale0: scale, shrink: em.shrink !== false, gravity: em.gravity ?? 0 } },
      });
    }
  }
}
