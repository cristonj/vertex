// Animation, in text: path morphs and keyframed transforms. No timelines, no tooling —
// an entity's `data.morph` or `data.keys` IS the animation, readable and editable live.

import { parsePath, flatten } from './path.js';

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Morph one path into another. Both are resampled to the same number of points by arc
 * length, aligned in start point and winding, then lerped. Works for any two single-
 * subpath shapes: blob -> star, ship -> circle, letter -> letter.
 */
export function morph(dA, dB, t, steps = 64) {
  if (t <= 0) return dA;
  if (t >= 1) return dB;
  const A = resample(flatten(parsePath(dA))[0], steps);
  let B = resample(flatten(parsePath(dB))[0], steps);
  if (signedArea(A) * signedArea(B) < 0) B = B.slice().reverse(); // same winding
  let best = 0, bestD = Infinity; // align start points to minimize twisting
  for (let i = 0; i < B.length; i++) {
    const d = (B[i][0] - A[0][0]) ** 2 + (B[i][1] - A[0][1]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best) B = B.slice(best).concat(B.slice(0, best));
  let d = `M${r2(A[0][0] + (B[0][0] - A[0][0]) * t)} ${r2(A[0][1] + (B[0][1] - A[0][1]) * t)}`;
  for (let i = 1; i < steps; i++) {
    d += `L${r2(A[i][0] + (B[i][0] - A[i][0]) * t)} ${r2(A[i][1] + (B[i][1] - A[i][1]) * t)}`;
  }
  return d + 'Z';
}

/** Resample an open polyline to n points, evenly spaced by arc length. */
function resample(pts, n) {
  if (!pts || pts.length < 2) return pts ? pts.slice(0, n) : [];
  const lens = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    lens.push(total);
  }
  if (!total) return Array(n).fill(pts[0]);
  const out = [];
  let seg = 1;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    while (seg < lens.length - 1 && lens[seg] < target) seg++;
    const span = lens[seg] - lens[seg - 1] || 1;
    const f = (target - lens[seg - 1]) / span;
    const a = pts[seg - 1], b = pts[seg];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * System: entities with `data.morph = { a, b, speed?, loop? }` (a/b are `d` strings)
 * get their inline geometry `e.d` rewritten every step.
 * loop: 'once' (default) | 'loop' | 'pingpong'
 */
export function morphAnim(game, dt) {
  for (const e of game.world.entities) {
    const m = e.data?.morph;
    if (!m) continue;
    m.t = (m.t ?? 0) + dt * (m.speed ?? 1);
    let t = m.t;
    if (m.loop === 'loop') t = ((t % 1) + 1) % 1;
    else if (m.loop === 'pingpong') { const m2 = ((t % 2) + 2) % 2; t = m2 < 1 ? m2 : 2 - m2; }
    else t = Math.max(0, Math.min(1, t));
    e.d = morph(m.a, m.b, t);
  }
}

/**
 * System: entities with `data.keys = [{ t, x?, y?, rot?, scale? }, ...]` are interpolated
 * between keyframes. `data.loop`: 'once' (default, holds last key) | 'loop' | 'pingpong'.
 * Time accumulates in `data.kt`. Keyframes only touch properties present on both keys.
 */
export function keyframes(game, dt) {
  for (const e of game.world.entities) {
    const keys = e.data?.keys;
    if (!keys?.length) continue;
    e.data.kt = (e.data.kt ?? 0) + dt;
    const dur = keys[keys.length - 1].t || 1;
    let t = e.data.kt;
    if (e.data.loop === 'loop') t = ((t % dur) + dur) % dur;
    else if (e.data.loop === 'pingpong') { const m = ((t % (2 * dur)) + 2 * dur) % (2 * dur); t = m < dur ? m : 2 * dur - m; }
    else t = Math.min(t, dur);
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const f = Math.max(0, Math.min(1, (t - a.t) / ((b.t - a.t) || 1)));
    for (const k of ['x', 'y', 'rot', 'scale']) {
      if (a[k] !== undefined && b[k] !== undefined) e[k] = a[k] + (b[k] - a[k]) * f;
    }
  }
}
