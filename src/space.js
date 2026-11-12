// Vector-native 3D. Meshes are data (vertices + faces); every frame they are projected through
// a perspective camera into flat, shaded 2D polygons — ordinary vector paths. So 3D works in
// every backend (SVG frame, Canvas2D, WebGL2, PNG), in replays, rewinds and over the network,
// and a 3D model is a few hundred bytes of JSON.
//
// Shapes:  { mesh: { v: [[x,y,z], ...], f: [[i, j, k, ...], ...], colors?: [faceColor...] },
//            fill?: "#8cf", stroke?: "#000", width?: 1, shade?: true }
//          { extrude: { d: "M...", depth: 10 } , fill }   — any 2D path becomes a solid
//          procedural: box(w,h,d), sphere(r, rings, segs), cylinder(r, h, segs), plane(w, d, nx, nz)
// Entities: { shape, x, y, z, rx, ry, rz, scale, ... } — 3D when their shape has a mesh.
// Scene:    space: { camera: { x, y, z, yaw, pitch, roll?, fov: 60, near: 1, far: 5000 },
//                    light: [x, y, z], ambient: 0.35, fog?: { color, near, far } }
//
// Faces are sorted back to front (painter's algorithm) and back faces are culled. Intersecting
// faces resolve per face, not per pixel; keep meshes convex-ish or split them.
// Uses trig (implementation-tolerant, SPEC.md §8).

import { parsePath, flatten } from './path.js';
import { parseColor } from './png.js';

// ---------------------------------------------------------------- mesh builders

/** Axis-aligned box centered on the origin. */
export function box(w = 20, h = 20, d = 20) {
  const x = w / 2, y = h / 2, z = d / 2;
  return {
    v: [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]],
    f: [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]],
  };
}

/** UV sphere. */
export function sphere(r = 10, rings = 8, segs = 12) {
  const v = [], f = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI, y = -Math.cos(t) * r, rr = Math.sin(t) * r;
    for (let j = 0; j < segs; j++) { const p = (j / segs) * Math.PI * 2; v.push([Math.cos(p) * rr, y, Math.sin(p) * rr]); }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = (i + 1) * segs + ((j + 1) % segs), d = (i + 1) * segs + j;
    if (i === 0) f.push([a, d, c]); else if (i === rings - 1) f.push([a, d, b]); else f.push([a, d, c, b]);
  }
  return { v: round(v), f };
}

/** Closed cylinder along y. */
export function cylinder(r = 10, h = 20, segs = 12) {
  const v = [], f = [];
  for (let j = 0; j < segs; j++) { const p = (j / segs) * Math.PI * 2; v.push([Math.cos(p) * r, -h / 2, Math.sin(p) * r], [Math.cos(p) * r, h / 2, Math.sin(p) * r]); }
  for (let j = 0; j < segs; j++) { const a = j * 2, b = ((j + 1) % segs) * 2; f.push([a, b, b + 1, a + 1]); }
  f.push([...Array(segs).keys()].map((j) => j * 2).reverse(), [...Array(segs).keys()].map((j) => j * 2 + 1));
  return { v: round(v), f };
}

/** Grid plane on y = 0 (ground, terrain). `height(x, z)` optionally displaces vertices. */
export function plane(w = 100, d = 100, nx = 4, nz = 4, height = null) {
  const v = [], f = [];
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) {
    const x = -w / 2 + (j / nx) * w, z = -d / 2 + (i / nz) * d;
    v.push([x, height ? -height(x, z) : 0, z]);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
    const a = i * (nx + 1) + j;
    f.push([a, a + nx + 1, a + nx + 2, a + 1]);
  }
  return { v: round(v), f };
}

/** Extrude a closed 2D path (x right, y down) along z: walls + caps. */
export function extrude(d, depth = 10) {
  const polys = flatten(parsePath(d)).map((p) => (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? p.slice(0, -1) : p));
  const v = [], f = [];
  for (const poly of polys) {
    const base = v.length, n = poly.length;
    for (const [x, y] of poly) v.push([x, y, -depth / 2], [x, y, depth / 2]);
    for (let i = 0; i < n; i++) { const a = base + i * 2, b = base + ((i + 1) % n) * 2; f.push([a, b, b + 1, a + 1]); }
    const ccw = signedArea(poly) > 0;
    const front = [...Array(n).keys()].map((i) => base + i * 2), back = [...Array(n).keys()].map((i) => base + i * 2 + 1);
    f.push(ccw ? front.reverse() : front, ccw ? back : back.reverse());
  }
  return { v: round(v), f };
}

const round = (v) => v.map((p) => p.map((c) => Math.round(c * 1000) / 1000));
function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

/** Resolve a shape's mesh (inline, extruded, or none). Cached on the compiled shape. */
export function meshOf(shape) {
  if (!shape) return null;
  if (shape._mesh !== undefined) return shape._mesh;
  const src = shape.src ?? shape;
  let m = null;
  if (src.mesh) m = src.mesh;
  else if (src.extrude) m = extrude(src.extrude.d, src.extrude.depth);
  if (m) {
    const normals = m.f.map((face) => faceNormal(m.v, face));
    m = { ...m, normals, tris: m.f.map((face, i) => triangulate(m.v, face, normals[i])) };
  }
  shape._mesh = m;
  return m;
}

/** Ear-clip a planar 3D polygon into triangles (indices into the face), once per mesh. */
function triangulate(v, face, n) {
  if (face.length === 3) return [0, 1, 2];
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const [u, w] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0]; // drop the dominant axis
  const p = face.map((i) => [v[i][u], v[i][w]]);
  let area = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sign = area >= 0 ? 1 : -1;
  const idx = [...p.keys()], out = [];
  const cross = (a, b, c) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * sign;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      if (cross(p[i0], p[i1], p[i2]) <= 0) continue; // reflex
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (cross(p[i0], p[i1], p[j]) >= 0 && cross(p[i1], p[i2], p[j]) >= 0 && cross(p[i2], p[i0], p[j]) >= 0) { inside = true; break; }
      }
      if (inside) continue;
      out.push(i0, i1, i2); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) break; // degenerate: fall back to a fan for the rest
  }
  for (let k = 1; k < idx.length - 1; k++) out.push(idx[0], idx[k], idx[k + 1]);
  return out;
}

function faceNormal(v, face) {
  // Newell's method: robust for any planar polygon
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < face.length; i++) {
    const a = v[face[i]], b = v[face[(i + 1) % face.length]];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// ---------------------------------------------------------------- projection

function rotation(rx = 0, ry = 0, rz = 0) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz (yaw, pitch, roll)
  return [
    cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
}
const rot = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];

const hex = (c) => '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

/**
 * Project every 3D entity into screen-space faces, back to front.
 * Returns [{ id, d, fill, stroke, width, depth }] in world-size screen units.
 */
export function projectSpace(world) {
  const sp = world.space;
  if (!sp) return [];
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60, near: 1, far: 5000, ...sp.camera };
  const W = world.width, H = world.height;
  const focal = (H / 2) / Math.tan(((cam.fov * Math.PI) / 180) / 2);
  // camera inverse rotation: world -> view
  const R = rotation(-cam.pitch, cam.yaw, cam.roll); // positive pitch looks down (+y is down)
  const toView = (p) => { const d = [p[0] - cam.x, p[1] - cam.y, p[2] - cam.z]; return [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]]; };
  const L = sp.light ?? [0.4, -1, 0.6];
  const ll = Math.sqrt(L[0] * L[0] + L[1] * L[1] + L[2] * L[2]) || 1, light = [-L[0] / ll, -L[1] / ll, -L[2] / ll];
  const ambient = sp.ambient ?? 0.35;
  const fog = sp.fog ? { c: parseColor(sp.fog.color) ?? [0, 0, 0], near: sp.fog.near ?? 200, far: sp.fog.far ?? 1500 } : null;
  const faces = [];
  for (const e of world.entities) {
    if (e.hidden) continue;
    const shape = world.shapes[e.shape];
    const mesh = meshOf(shape);
    if (!mesh) continue;
    const src = shape.src, s = e.scale ?? 1;
    // cheap cull: bounding sphere vs near/far
    const M = rotation(e.rx ?? 0, e.ry ?? 0, e.rz ?? 0);
    const center = toView([e.x, e.y, e.z ?? 0]);
    if (center[2] < cam.near - (shape._r3 ??= Math.sqrt(Math.max(...mesh.v.map((p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2])))) * Math.abs(s)) continue;
    if (center[2] - shape._r3 * Math.abs(s) > cam.far) continue;
    const view = mesh.v.map((p) => { const q = rot(M, p); return toView([e.x + q[0] * s, e.y + q[1] * s, (e.z ?? 0) + q[2] * s]); });
    const base = parseColor(e.fill ?? src.fill ?? '#9aa5bd') ?? [154, 165, 189];
    const stroke = e.stroke ?? src.stroke, width = e.width ?? src.width;
    for (let fi = 0; fi < mesh.f.length; fi++) {
      const raw = mesh.f[fi].map((i) => view[i]);
      const poly = clipNear(raw, cam.near);
      if (poly.length < 3) continue;
      const clipped = poly !== raw;
      const pts = poly.map(([x, y, z]) => [W / 2 + (x * focal) / z, H / 2 + (y * focal) / z]);
      // back-face cull in screen space (y down: clockwise = front)
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area <= 0 && !src.doubleSided) continue;
      let depth = 0;
      for (const p of poly) depth += p[2];
      depth /= poly.length;
      let color = mesh.colors?.[fi] ? parseColor(mesh.colors[fi]) ?? base : base;
      if (src.shade !== false) {
        const n = rot(M, mesh.normals[fi]);
        const k = ambient + (1 - ambient) * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
        color = color.map((c) => c * k);
      }
      if (fog) { const t = Math.max(0, Math.min(1, (depth - fog.near) / (fog.far - fog.near))); color = color.map((c, i) => c + (fog.c[i] - c) * t); }
      const d = 'M' + pts.map(([x, y]) => `${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join('L') + 'Z';
      // triangles for GPU backends: the mesh's triangulation survives projection; clipped faces are convex → fan
      const tris = clipped ? fan(pts.length) : mesh.tris[fi];
      faces.push({ id: `${e.id}.${fi}`, d, pts, tris, rgb: color, fill: hex(color), stroke, width, depth, layer: e.layer ?? 0 });
    }
  }
  faces.sort((a, b) => (a.layer - b.layer) || (b.depth - a.depth));
  return faces;
}

const fan = (n) => { const t = []; for (let k = 1; k < n - 1; k++) t.push(0, k, k + 1); return t; };

/** Sutherland–Hodgman clip of a view-space polygon against z = near. */
function clipNear(poly, near) {
  if (poly.every((p) => p[2] >= near)) return poly;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ain = a[2] >= near, bin = b[2] >= near;
    if (ain) out.push(a);
    if (ain !== bin) { const t = (near - a[2]) / (b[2] - a[2]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]); }
  }
  return out;
}

/** Project a world point to the screen (for HUD labels over 3D things). Null if behind the camera. */
export function projectPoint(world, x, y, z) {
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60, near: 1, ...world.space?.camera };
  const focal = (world.height / 2) / Math.tan(((cam.fov * Math.PI) / 180) / 2);
  const R = rotation(-cam.pitch, cam.yaw, cam.roll);
  const d = [x - cam.x, y - cam.y, z - cam.z];
  const v = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
  if (v[2] < cam.near) return null;
  return [world.width / 2 + (v[0] * focal) / v[2], world.height / 2 + (v[1] * focal) / v[2], v[2]];
}

/** Integrate 3D velocity (vz) and angular velocities (vrx, vry, vrz) for entities that have them. */
export function motion3d(game, dt) {
  for (const e of game.world.entities) {
    if (e.vz) e.z = (e.z ?? 0) + e.vz * dt;
    if (e.vrx) e.rx = (e.rx ?? 0) + e.vrx * dt;
    if (e.vry) e.ry = (e.ry ?? 0) + e.vry * dt;
    if (e.vrz) e.rz = (e.rz ?? 0) + e.vrz * dt;
  }
}

/** Third-person chase camera: sits behind an entity's yaw (`ry`) and looks at it. */
export function chaseCamera(id, { distance = 120, height = 50, lerp = 0.15, pitch = 0.3 } = {}) {
  return (game, dt) => {
    const w = game.world, t = w.get(id);
    if (!t || !w.space) return;
    const c = (w.space.camera ??= { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 60 });
    const yaw = t.ry ?? 0;
    const tx = t.x - Math.sin(yaw) * distance, tz = (t.z ?? 0) - Math.cos(yaw) * distance, ty = t.y - height;
    const k = lerp >= 1 ? 1 : 1 - Math.pow(1 - lerp, dt * 60);
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.z += (tz - c.z) * k;
    let dy = yaw - (c.yaw ?? 0); dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw = (c.yaw ?? 0) + dy * k;
    c.pitch = pitch;
  };
}

/** Bounding-sphere radius of a 3D entity (mesh radius × scale). */
export function radius3d(world, e) {
  const shape = world.shapes[e.shape], mesh = meshOf(shape);
  if (!mesh) return 0;
  shape._r3 ??= Math.sqrt(Math.max(...mesh.v.map((p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2])));
  return shape._r3 * Math.abs(e.scale ?? 1);
}

/** Local axis-aligned bounds of a shape's mesh, cached on the compiled shape. */
function meshBounds(shape) {
  if (!shape) return null;
  if (shape._mb !== undefined) return shape._mb;
  const mesh = meshOf(shape);
  if (!mesh || !mesh.v.length) return (shape._mb = null);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.v) for (let i = 0; i < 3; i++) {
    if (p[i] < min[i]) min[i] = p[i];
    if (p[i] > max[i]) max[i] = p[i];
  }
  return (shape._mb = { min, max });
}

/**
 * World-space oriented box of a 3D entity: { c, h, axes } where `c` is the center,
 * `h` the half extents and `axes` the three rotated unit axes.
 * The box is the mesh's local AABB taken through the entity's rotation and scale, so a
 * tower collides where it looks like a tower, not where a sphere around it would be.
 */
function entityBox3d(world, e) {
  const shape = world.shapes[e.shape];
  const mb = meshBounds(shape);
  if (!mb) return null;
  const s = Math.abs(e.scale ?? 1);
  const local = [0, 1, 2].map((i) => (mb.min[i] + mb.max[i]) / 2);
  const h = [0, 1, 2].map((i) => ((mb.max[i] - mb.min[i]) / 2) * s);
  const M = rotation(e.rx ?? 0, e.ry ?? 0, e.rz ?? 0);
  const signed = e.scale ?? 1;
  const off = rot(M, local.map((v) => v * signed));
  const c = [e.x + off[0], e.y + off[1], (e.z ?? 0) + off[2]];
  // columns of M are the box's unit axes
  const axes = [
    [M[0], M[3], M[6]],
    [M[1], M[4], M[7]],
    [M[2], M[5], M[8]],
  ];
  return { c, h, axes };
}

/** Separating-axis test for two oriented boxes (3 face axes each + 9 edge crosses). */
function boxesOverlap3d(a, b) {
  const d = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const test = (L) => {
    const len2 = dot(L, L);
    if (len2 < 1e-12) return true; // parallel edges: axis is redundant
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) {
      ra += a.h[i] * Math.abs(dot(a.axes[i], L));
      rb += b.h[i] * Math.abs(dot(b.axes[i], L));
    }
    return Math.abs(dot(d, L)) <= ra + rb + 1e-9 * Math.sqrt(len2);
  };
  for (const ax of a.axes) if (!test(ax)) return false;
  for (const bx of b.axes) if (!test(bx)) return false;
  for (const ax of a.axes) for (const bx of b.axes) if (!test(cross(ax, bx))) return false;
  return true;
}

/** True when two 3D entities' oriented mesh bounds overlap. */
function overlaps3d(world, a, b) {
  const ba = entityBox3d(world, a), bb = entityBox3d(world, b);
  if (!ba || !bb) return false;
  // cheap sphere broadphase before the exact test
  const ra = Math.hypot(...ba.h), rb = Math.hypot(...bb.h);
  const dx = ba.c[0] - bb.c[0], dy = ba.c[1] - bb.c[1], dz = ba.c[2] - bb.c[2];
  if (dx * dx + dy * dy + dz * dz > (ra + rb) ** 2) return false;
  return boxesOverlap3d(ba, bb);
}

/**
 * Box-vs-box collision between tag pairs in 3D. Emits the same `hit` events as collide().
 * Uses each mesh's rotated local AABB; concave meshes still have a box hitbox.
 */
export function collide3d(pairs) {
  return (game) => {
    const w = game.world;
    for (const [ta, tb] of pairs) {
      const A = w.query(ta), B = w.query(tb);
      for (const a of A) for (const b of B) {
        if (a === b) continue;
        if (overlaps3d(w, a, b)) game.emit('hit', { a: a.id, b: b.id, tags: [ta, tb] });
      }
    }
  };
}
