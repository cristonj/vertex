// Deterministic 2D physics: gravity, solid bodies, contacts, platforming. Plain arithmetic
// only (+ - * / sqrt), so it is bit-identical across implementations (SPEC.md §8).
//
// An entity becomes a body by having `body`:
//   body: { static?: true, collider?: "box" | "circle", restitution?: 0, friction?: 0,
//           mass?: 1, gravity?: 1, sensor?: false }
// The collider comes from the entity's own vector bounds (box = axis-aligned bounds × scale,
// ignoring rotation; circle = bounding radius × scale). Scene-level settings:
//   physics: { gravity: [0, 900], iterations: 4, slop: 0.01 }
// The system reads velocities, resolves contacts after `motion` has moved things, and sets
// `body.ground` (standing on something), `body.wall` (-1/1 when touching a side) and emits
// `contact` events { a, b, nx, ny } (normal points from a to b). Sensors only emit events.
//
// Order in a cartridge: ["rules", "motion", "physics"]  (physics corrects what motion did).

import { entityGeom } from './world.js';

function collider(world, e) {
  const g = entityGeom(world, e), s = Math.abs(e.scale), b = e.body;
  if ((b.collider ?? 'box') === 'circle') {
    const r = (g.bounds?.radius ?? 0) * s;
    return { circle: true, r, x0: e.x - r, y0: e.y - r, x1: e.x + r, y1: e.y + r };
  }
  const bd = g.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { circle: false, x0: e.x + bd.minX * s, y0: e.y + bd.minY * s, x1: e.x + bd.maxX * s, y1: e.y + bd.maxY * s };
}

/** Contact between colliders A and B: { nx, ny, depth } with the normal from A to B, or null. */
export function contact(A, B) {
  if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0) return null;
  if (A.circle && B.circle) {
    const ax = (A.x0 + A.x1) / 2, ay = (A.y0 + A.y1) / 2, bx = (B.x0 + B.x1) / 2, by = (B.y0 + B.y1) / 2;
    const dx = bx - ax, dy = by - ay, d2 = dx * dx + dy * dy, rr = A.r + B.r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    return d > 0 ? { nx: dx / d, ny: dy / d, depth: rr - d } : { nx: 0, ny: 1, depth: rr };
  }
  if (A.circle || B.circle) {
    const flip = !!B.circle && !A.circle;
    const C = flip ? B : A, R = flip ? A : B;
    const cx = (C.x0 + C.x1) / 2, cy = (C.y0 + C.y1) / 2;
    const px = cx < R.x0 ? R.x0 : cx > R.x1 ? R.x1 : cx, py = cy < R.y0 ? R.y0 : cy > R.y1 ? R.y1 : cy;
    let dx = px - cx, dy = py - cy, d2 = dx * dx + dy * dy, nx, ny, depth;
    if (d2 > 0) {
      if (d2 >= C.r * C.r) return null;
      const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; depth = C.r - d;
    } else { // center inside the box: push out along the shallowest axis
      const l = cx - R.x0, r = R.x1 - cx, t = cy - R.y0, b = R.y1 - cy, m = Math.min(l, r, t, b);
      if (m === l) { nx = 1; ny = 0; } else if (m === r) { nx = -1; ny = 0; } else if (m === t) { nx = 0; ny = 1; } else { nx = 0; ny = -1; }
      depth = m + C.r;
    }
    return flip ? { nx: -nx, ny: -ny, depth } : { nx, ny, depth };
  }
  const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
  if (ox < oy) return { nx: (A.x0 + A.x1) < (B.x0 + B.x1) ? 1 : -1, ny: 0, depth: ox };
  return { nx: 0, ny: (A.y0 + A.y1) < (B.y0 + B.y1) ? 1 : -1, depth: oy };
}

export function physics(game, dt) {
  const w = game.world;
  const cfg = w.physics ?? {};
  const gx = cfg.gravity?.[0] ?? 0, gy = cfg.gravity?.[1] ?? 900;
  const iterations = cfg.iterations ?? 4, slop = cfg.slop ?? 0.01;
  const bodies = [];
  for (const e of w.entities) if (e.body) bodies.push(e);
  for (const e of bodies) {
    const b = e.body;
    b.ground = false; b.wall = 0;
    if (!b.static && !b.sensor) { const k = b.gravity ?? 1; e.vx += gx * k * dt; e.vy += gy * k * dt; }
  }
  if (bodies.length < 2) return;
  const reported = new Set();
  // Broadphase: bodies that cannot move during the solve (static, sensor) are gridded once per
  // step; movers are re-gridded each iteration. Candidate pairs (i < j) are visited in
  // lexicographic order: exactly the order of the all-pairs loop in SPEC.md §7.1.
  const fixedIdx = [], moverIdx = [];
  bodies.forEach((e, i) => (e.body.static || e.body.sensor ? fixedIdx : moverIdx).push(i));
  if (!moverIdx.length) return; // only fixed bodies: every pair is skipped anyway
  const cols = new Array(bodies.length);
  for (const i of fixedIdx) cols[i] = collider(w, bodies[i]);
  let cell = 16;
  for (const i of moverIdx) { const c = collider(w, bodies[i]); cell = Math.max(cell, c.x1 - c.x0, c.y1 - c.y0); }
  for (const i of fixedIdx) { const c = cols[i]; const sz = Math.max(c.x1 - c.x0, c.y1 - c.y0); if (sz > cell && sz < 4096) cell = sz; }
  const inv = 1 / cell, keyOf = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  const insert = (grid, i, c) => {
    for (let cx = Math.floor(c.x0 * inv); cx <= Math.floor(c.x1 * inv); cx++)
      for (let cy = Math.floor(c.y0 * inv); cy <= Math.floor(c.y1 * inv); cy++) {
        const k = keyOf(cx, cy); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]);
      }
  };
  const fixedGrid = new Map();
  for (const i of fixedIdx) insert(fixedGrid, i, cols[i]);
  for (let it = 0; it < iterations; it++) {
    for (const i of moverIdx) cols[i] = collider(w, bodies[i]);
    const moverGrid = new Map();
    for (const i of moverIdx) insert(moverGrid, i, cols[i]);
    const pairSet = new Set();
    const addPairs = (i, c, grid) => {
      for (let cx = Math.floor(c.x0 * inv); cx <= Math.floor(c.x1 * inv); cx++)
        for (let cy = Math.floor(c.y0 * inv); cy <= Math.floor(c.y1 * inv); cy++) {
          const l = grid.get(keyOf(cx, cy));
          if (l) for (const j of l) if (j !== i) pairSet.add(i < j ? i * 1048576 + j : j * 1048576 + i);
        }
    };
    for (const i of moverIdx) { addPairs(i, cols[i], moverGrid); addPairs(i, cols[i], fixedGrid); }
    const pairs = [...pairSet].sort((a, b) => a - b);
    let any = false;
    for (const key of pairs) {
      const i = Math.floor(key / 1048576), j = key % 1048576;
      const a = bodies[i], b = bodies[j], ba = a.body, bb = b.body;
      if ((ba.static || ba.sensor) && (bb.static || bb.sensor)) continue;
      const c = contact(cols[i], cols[j]);
      if (!c) continue;
      if (!reported.has(key)) { reported.add(key); game.emit('contact', { a: a.id, b: b.id, nx: c.nx, ny: c.ny }); }
      if (ba.sensor || bb.sensor) continue;
      any = true;
      const ia = ba.static ? 0 : 1 / (ba.mass ?? 1), ib = bb.static ? 0 : 1 / (bb.mass ?? 1), sum = ia + ib;
      // positional correction
      const corr = Math.max(c.depth - slop, 0) / sum;
      a.x -= c.nx * corr * ia; a.y -= c.ny * corr * ia;
      b.x += c.nx * corr * ib; b.y += c.ny * corr * ib;
      // grounding / walls (normal from a to b)
      if (c.ny > 0.5) ba.ground = true;
      if (c.ny < -0.5) bb.ground = true;
      if (c.nx > 0.5) { ba.wall = 1; bb.wall = -1; } else if (c.nx < -0.5) { ba.wall = -1; bb.wall = 1; }
      // impulse along the normal
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * c.nx + rvy * c.ny;
      if (vn >= 0) continue;
      const rest = Math.max(ba.restitution ?? 0, bb.restitution ?? 0);
      const jn = (-(1 + rest) * vn) / sum;
      a.vx -= jn * c.nx * ia; a.vy -= jn * c.ny * ia;
      b.vx += jn * c.nx * ib; b.vy += jn * c.ny * ib;
      // friction along the tangent (Coulomb, clamped)
      const mu = Math.sqrt((ba.friction ?? 0) * (bb.friction ?? 0));
      if (mu > 0) {
        const tx = -c.ny, ty = c.nx;
        const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
        let jt = -vt / sum;
        const lim = jn * mu; if (jt > lim) jt = lim; else if (jt < -lim) jt = -lim;
        a.vx -= jt * tx * ia; a.vy -= jt * ty * ia;
        b.vx += jt * tx * ib; b.vy += jt * ty * ib;
      }
    }
    if (!any) break;
  }
}

// ---------------------------------------------------------------- queries

/** Ray vs segment intersection distance t along (dx, dy), or Infinity. */
function raySeg(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
  if (den === 0) return Infinity;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

/**
 * Cast a ray from (x, y) along (dx, dy) up to `max` distance against entity outlines.
 * Returns the nearest hit { entity, x, y, distance } or null. `tag` limits candidates.
 */
export function raycast(world, x, y, dx, dy, { max = Infinity, tag = null, ignore = null } = {}) {
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len; dy /= len;
  let best = null, bestT = max;
  for (const e of tag ? world.query(tag) : world.entities) {
    if (e === ignore || e.id === ignore || e.hidden) continue;
    const g = entityGeom(world, e);
    if (!g.polys?.length) continue;
    // cheap reject: distance from ray to center vs bounding radius
    const r = (g.bounds?.radius ?? 0) * Math.abs(e.scale), qx = e.x - x, qy = e.y - y, proj = qx * dx + qy * dy;
    const perp = qx * dy - qy * dx;
    if (perp * perp > r * r || proj + r < 0 || proj - r > bestT) continue;
    const c = Math.cos(e.rot) * e.scale, s = Math.sin(e.rot) * e.scale;
    for (const poly of g.polys) {
      for (let i = 0; i < poly.length - 1; i++) {
        const [px, py] = poly[i], [qx2, qy2] = poly[i + 1];
        const t = raySeg(x, y, dx, dy, e.x + px * c - py * s, e.y + px * s + py * c, e.x + qx2 * c - qy2 * s, e.y + qx2 * s + qy2 * c);
        if (t < bestT) { bestT = t; best = e; }
      }
    }
  }
  return best ? { entity: best, x: x + dx * bestT, y: y + dy * bestT, distance: bestT } : null;
}

/** Entities whose outline contains the point (topmost — last drawn — first). */
export function pointQuery(world, x, y, { tag = null } = {}) {
  const out = [];
  for (const e of tag ? world.query(tag) : world.entities) {
    const g = entityGeom(world, e);
    const r = (g.bounds?.radius ?? 0) * Math.abs(e.scale) + (g.pad ?? 0);
    if ((e.x - x) ** 2 + (e.y - y) ** 2 > r * r || !g.polys?.length) continue;
    // to local space
    const c = Math.cos(-e.rot) / e.scale, s = Math.sin(-e.rot) / e.scale, lx = (x - e.x) * c - (y - e.y) * s, ly = (x - e.x) * s + (y - e.y) * c;
    let inside = false;
    for (const poly of g.polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > ly) !== (yj > ly) && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) out.push(e);
  }
  return out.reverse();
}

/** Nearest entity with a tag to (x, y), or null. Ties resolve to the earliest entity. */
export function nearest(world, x, y, tag) {
  let best = null, bd = Infinity;
  for (const e of world.query(tag)) {
    const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
