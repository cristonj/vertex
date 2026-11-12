// Uniform-grid spatial hash broadphase. Turns tag-pair collision from O(A*B) into roughly
// O(A + B) for evenly spread worlds, while keeping event order identical to the brute-force
// loop (candidates are re-sorted by entity index), so replays and digests never change.

export class SpatialHash {
  constructor(cell = 64) {
    this.cell = cell;
    this.map = new Map();
  }

  clear() { this.map.clear(); }

  key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }

  /** Insert an item covering the circle (x, y, r). */
  insert(item, x, y, r) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = this.key(cx, cy);
      let b = this.map.get(k);
      if (!b) this.map.set(k, (b = []));
      b.push(item);
    }
  }

  /** Unique items whose cells overlap the circle (x, y, r). Unordered. */
  query(x, y, r, out = new Set()) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const b = this.map.get(this.key(cx, cy));
      if (b) for (const it of b) out.add(it);
    }
    return out;
  }
}

/**
 * Shared tag-pair broadphase. Calls narrow(a, b) for each candidate pair whose bounding
 * circles overlap, in exactly the order the naive nested loop would.
 * Uses brute force for small sets (faster below ~32 candidates) and a grid above that.
 */
export function forEachPair(world, ta, tb, narrow) {
  const A = world.query(ta), B = world.query(tb);
  if (!A.length || !B.length) return;
  const rad = new Map();
  for (const e of A) rad.set(e, world.radius(e));
  for (const e of B) if (!rad.has(e)) rad.set(e, world.radius(e));
  const test = (a, b) => {
    if (a === b) return;
    const rr = rad.get(a) + rad.get(b), dx = a.x - b.x, dy = a.y - b.y;
    if (dx * dx + dy * dy < rr * rr) narrow(a, b);
  };
  if (A.length * B.length <= 1024) {
    for (const a of A) for (const b of B) test(a, b);
    return;
  }
  // Grid path: B indices bucketed by cell (flat arrays, no Sets), candidates deduped with a
  // per-query stamp and visited in ascending index order — identical order to brute force.
  let maxR = 1;
  for (const r of rad.values()) if (r > maxR) maxR = r;
  const cell = Math.max(16, maxR * 2), inv = 1 / cell;
  const buckets = new Map();
  const bx = new Float64Array(B.length), by = new Float64Array(B.length), br = new Float64Array(B.length);
  for (let i = 0; i < B.length; i++) {
    const b = B[i], r = rad.get(b);
    bx[i] = b.x; by[i] = b.y; br[i] = r;
    const x0 = Math.floor((b.x - r) * inv), x1 = Math.floor((b.x + r) * inv);
    const y0 = Math.floor((b.y - r) * inv), y1 = Math.floor((b.y + r) * inv);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx * 73856093 ^ cy * 19349663;
      const list = buckets.get(k);
      if (list) list.push(i); else buckets.set(k, [i]);
    }
  }
  const stamp = new Int32Array(B.length).fill(-1);
  const cand = [];
  for (let ai = 0; ai < A.length; ai++) {
    const a = A[ai], ra = rad.get(a);
    const x0 = Math.floor((a.x - ra) * inv), x1 = Math.floor((a.x + ra) * inv);
    const y0 = Math.floor((a.y - ra) * inv), y1 = Math.floor((a.y + ra) * inv);
    cand.length = 0;
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const list = buckets.get(cx * 73856093 ^ cy * 19349663);
      if (!list) continue;
      for (let j = 0; j < list.length; j++) {
        const bi = list[j];
        if (stamp[bi] === ai) continue;
        stamp[bi] = ai;
        const rr = ra + br[bi], dx = a.x - bx[bi], dy = a.y - by[bi];
        if (dx * dx + dy * dy < rr * rr) cand.push(bi);
      }
    }
    if (cand.length > 1) cand.sort((p, q) => p - q);
    for (let j = 0; j < cand.length; j++) if (B[cand[j]] !== a) narrow(a, B[cand[j]]);
  }
}
