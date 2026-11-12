// Procedural vector shape kit: parametric art as plain path data. No assets, ever.
// Every function returns `{ d }` (or a full shape when given style) ready for defineShape,
// inline entity geometry, or morphing.

const TAU = Math.PI * 2;
const r2 = (n) => Math.round(n * 100) / 100;
const ring = (pts) => 'M' + pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L') + 'Z';

/** Regular n-gon. */
export function polygonShape(n = 6, r = 20, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { d: ring(pts) };
}

/** n-pointed star between two radii. */
export function starShape(n = 5, r1 = 10, r2r = 20, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU;
    const r = i % 2 ? r1 : r2r;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return { d: ring(pts) };
}

/** Donut: outer ring + opposite-winding inner ring (even-odd hole). */
export function ringShape(rInner = 10, rOuter = 16, n = 32) {
  const outer = [], inner = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    outer.push([Math.cos(a) * rOuter, Math.sin(a) * rOuter]);
    inner.push([Math.cos(a) * rInner, Math.sin(a) * rInner]);
  }
  return { d: ring(outer) + ring(inner.reverse()) };
}

/** Seeded organic blob (deterministic per seed) — the classic "rock". */
export function blobShape(seed = 1, { n = 8, r = 20, wobble = 0.35 } = {}) {
  let x = seed >>> 0 || 1;
  const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    const rr = r * (1 + (rnd() * 2 - 1) * wobble);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return { d: smoothClosed(pts) };
}

/** Arc arrow pointing +x. */
export function arrowShape(len = 24, w = 10) {
  const tip = len / 2, back = -len / 2;
  return { d: ring([[tip, 0], [back, -w / 2], [back + w * 0.6, 0], [back, w / 2]]) };
}

/** Smooth closed Catmull-Rom spline through every point (as cubic Béziers). */
export function smoothClosed(pts) {
  const n = pts.length;
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r2(c1x)} ${r2(c1y)} ${r2(c2x)} ${r2(c2y)} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d + 'Z';
}
