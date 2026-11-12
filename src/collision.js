// Exact outline collision: the art IS the hitbox.
// Broadphase is the cheap cached bounding radius; narrowphase tests actual transformed
// outlines (segment intersections + containment). Zero dependencies, plain polygons.
import { entityGeom } from './world.js';
import { forEachPair } from './spatial.js';

/** Transform local shape points to world space for an entity. */
export function localToWorld(e) {
  const c = Math.cos(e.rot), s = Math.sin(e.rot);
  return (x, y) => [e.x + (x * c - y * s) * e.scale, e.y + (x * s + y * c) * e.scale];
}

/** Entity outline polygons in world space (inline `e.d` or registered shape, all parts). */
export function entityPolys(world, e) {
  const geom = entityGeom(world, e);
  if (!geom.polys?.length) return [];
  const T = localToWorld(e);
  return geom.polys.map((poly) => poly.map(([x, y]) => T(x, y)));
}

/** Segment pairs of one polygon (open polylines stay open; closed rings include the closing edge). */
export function edgesOf(poly) {
  const closed = poly.length > 2 &&
    Math.abs(poly[0][0] - poly[poly.length - 1][0]) < 1e-9 &&
    Math.abs(poly[0][1] - poly[poly.length - 1][1]) < 1e-9;
  const pts = closed ? poly.slice(0, -1) : poly;
  const n = pts.length, out = [];
  if (n < 2) return out;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) out.push([pts[i], pts[(i + 1) % n]]);
  return out;
}

function orient(a, b, c) {
  const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return d > 1e-9 ? 1 : d < -1e-9 ? -1 : 0;
}

function onSeg(a, b, p) {
  return Math.min(a[0], b[0]) - 1e-9 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    Math.min(a[1], b[1]) - 1e-9 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

/** Do segments p1-p2 and q1-q2 intersect (including touching / collinear overlap)? */
export function segmentsIntersect(p1, p2, q1, q2) {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(p1, p2, q1)) || (o2 === 0 && onSeg(p1, p2, q2)) ||
    (o3 === 0 && onSeg(q1, q2, p1)) || (o4 === 0 && onSeg(q1, q2, p2));
}

/** Do any segments of polygon A touch/cross any segments of polygon B? */
export function outlinesTouch(polyA, polyB) {
  const ea = edgesOf(polyA), eb = edgesOf(polyB);
  for (const [p1, p2] of ea) {
    const ax0 = Math.min(p1[0], p2[0]), ax1 = Math.max(p1[0], p2[0]);
    const ay0 = Math.min(p1[1], p2[1]), ay1 = Math.max(p1[1], p2[1]);
    for (const [q1, q2] of eb) {
      if (Math.max(q1[0], q2[0]) < ax0 || Math.min(q1[0], q2[0]) > ax1 ||
          Math.max(q1[1], q2[1]) < ay0 || Math.min(q1[1], q2[1]) > ay1) continue; // segment AABB reject
      if (segmentsIntersect(p1, p2, q1, q2)) return true;
    }
  }
  return false;
}

/** Even-odd point-in-polygon. */
export function pointInPoly([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** World-space polys + their AABBs for an entity, optionally memoized for one pass. */
function worldPolys(world, e, cache) {
  let rec = cache?.get(e);
  if (rec) return rec;
  const polys = entityPolys(world, e);
  const boxes = polys.map((p) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  });
  rec = { polys, boxes };
  cache?.set(e, rec);
  return rec;
}

/** Full outline overlap test (touching edges or containment, either direction). */
export function outlinesOverlap(world, a, b, cache) {
  const A = worldPolys(world, a, cache), B = worldPolys(world, b, cache);
  if (!A.polys.length || !B.polys.length) return false;
  for (let i = 0; i < A.polys.length; i++) {
    const ba = A.boxes[i], pa = A.polys[i];
    for (let j = 0; j < B.polys.length; j++) {
      const bb = B.boxes[j], pb = B.polys[j];
      if (ba[2] < bb[0] || bb[2] < ba[0] || ba[3] < bb[1] || bb[3] < ba[1]) continue; // AABB reject
      if (outlinesTouch(pa, pb)) return true;
      if (pa.length >= 3 && pointInPoly(pb[0], pa)) return true;
      if (pb.length >= 3 && pointInPoly(pa[0], pb)) return true;
    }
  }
  return false;
}

/**
 * Outline collision between tag pairs, like systems.collide but exact:
 * circle broadphase, then real polygon intersection. Emits the same `hit` events.
 * Usage: collideOutline([["bullet","rock"],["ship","rock"]])
 */
export function collideOutline(pairs) {
  return (game) => {
    const w = game.world, cache = new Map(); // world-space outlines, computed once per entity per step
    for (const [ta, tb] of pairs) {
      forEachPair(w, ta, tb, (a, b) => {
        if (outlinesOverlap(w, a, b, cache)) game.emit('hit', { a: a.id, b: b.id, tags: [ta, tb] });
      });
    }
  };
}
