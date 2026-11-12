// Camera, layers, parallax and culling — shared by every renderer so all outputs agree.
//
// world.camera = { x, y, zoom?, rot? }  — the world point shown at the screen center.
//   Absent camera = identity view (world units map 1:1 to the screen, origin top-left).
// entity.layer    — draw order (lower first, stable within a layer). Default 0.
// entity.parallax — camera influence: 1 = normal, 0 = pinned to screen, 0.5 = far background.
// entity.fixed    — true = screen-space (HUD/UI); ignores the camera entirely.
//
// Matrices are [a, b, c, d, e, f] (canvas/SVG convention): x' = a*x + c*y + e, y' = b*x + d*y + f.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Local -> world transform of an entity (translate, rotate, scale). */
export function entityMatrix(e) {
  const c = Math.cos(e.rot) * e.scale, s = Math.sin(e.rot) * e.scale;
  return [c, s, -s, c, e.x, e.y];
}

/** World -> screen transform for an entity's layer (camera + parallax), in world-size units. */
export function viewMatrix(world, e) {
  const cam = world.camera;
  if (!cam || e?.fixed) return IDENTITY;
  const p = e?.parallax ?? 1;
  const W2 = world.width / 2, H2 = world.height / 2;
  const z = Math.pow(cam.zoom ?? 1, p), rot = (cam.rot ?? 0) * p;
  const cx = W2 + (cam.x - W2) * p, cy = H2 + (cam.y - H2) * p;
  const c = Math.cos(-rot) * z, s = Math.sin(-rot) * z;
  // T(W2,H2) * S(z) * R(-rot) * T(-cx,-cy)
  return [c, s, -s, c, W2 - (c * cx - s * cy), H2 - (s * cx + c * cy)];
}

/** Full local -> screen (world-size units) transform. */
export function fullMatrix(world, e) {
  const v = viewMatrix(world, e);
  return v === IDENTITY ? entityMatrix(e) : mul(v, entityMatrix(e));
}

/** Uniform scale factor of a matrix (for stroke widths and radii). */
export const matScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

/**
 * Entities in draw order: by layer (stable), hidden removed, and — when `cull` is set —
 * anything whose bounding circle is fully off-screen skipped. Returns [entity, matrix] pairs.
 * @param {(e) => number} radiusOf local bounding radius (unscaled)
 */
export function drawList(world, radiusOf, { cull = true, margin = 2 } = {}) {
  let ents = world.entities;
  if (ents.some((e) => e.layer)) {
    ents = ents.map((e, i) => [e, i]).sort((a, b) => (a[0].layer ?? 0) - (b[0].layer ?? 0) || a[1] - b[1]).map((p) => p[0]);
  }
  const out = [];
  const W = world.width, H = world.height;
  for (const e of ents) {
    if (e.hidden) continue;
    const m = fullMatrix(world, e);
    if (cull) {
      const rad = radiusOf(e) * matScale(m) + margin + (e.width ?? 0);
      const x = m[4], y = m[5];
      if (x + rad < 0 || y + rad < 0 || x - rad > W || y - rad > H) continue;
    }
    out.push([e, m]);
  }
  return out;
}

/** Screen point (world-size units) -> world point, through the default (parallax 1) camera. */
export function screenToWorld(world, x, y) {
  return apply(invert(viewMatrix(world, null)), x, y);
}

/** Camera system helper: ease the camera toward an entity. `follow('ship', 0.1)` */
export function follow(id, lerp = 1) {
  return (game, dt) => {
    const w = game.world, t = w.get(id);
    if (!t) return;
    w.camera ??= { x: w.width / 2, y: w.height / 2, zoom: 1, rot: 0 };
    const k = lerp >= 1 ? 1 : 1 - Math.pow(1 - lerp, dt * 60);
    w.camera.x += (t.x - w.camera.x) * k;
    w.camera.y += (t.y - w.camera.y) * k;
  };
}
