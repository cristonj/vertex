// Tessellation for GPU backends. Pure functions over polygons -> flat Float32Array triangles,
// computed once per shape part and cached as GPU buffers.
//
// Fills use "stencil-then-cover": every subpath becomes a triangle fan from its first vertex.
// Drawn into the stencil with INVERT, the fans leave exactly the even-odd interior set — holes,
// self-intersections and concave outlines included — with zero polygon triangulation.

/** Triangle fans (as triangle lists) for all subpaths. */
export function fanTriangles(polys) {
  let n = 0;
  for (const p of polys) if (p.length >= 3) n += (p.length - 2) * 6;
  const out = new Float32Array(n);
  let o = 0;
  for (const p of polys) {
    if (p.length < 3) continue;
    const [x0, y0] = p[0];
    for (let i = 1; i < p.length - 1; i++) {
      out[o++] = x0; out[o++] = y0;
      out[o++] = p[i][0]; out[o++] = p[i][1];
      out[o++] = p[i + 1][0]; out[o++] = p[i + 1][1];
    }
  }
  return out;
}

/**
 * Stroke triangles: a quad per segment plus a round cap/join disc at every vertex,
 * matching the round joins/caps of the Canvas and SVG backends.
 */
export function strokeTriangles(polys, width, joinSegs = 8) {
  const h = width / 2, tris = [];
  const disc = (x, y) => {
    for (let k = 0; k < joinSegs; k++) {
      const a0 = (k / joinSegs) * Math.PI * 2, a1 = ((k + 1) / joinSegs) * Math.PI * 2;
      tris.push(x, y, x + Math.cos(a0) * h, y + Math.sin(a0) * h, x + Math.cos(a1) * h, y + Math.sin(a1) * h);
    }
  };
  for (const p of polys) {
    for (let i = 0; i < p.length - 1; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[i + 1];
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      if (!len) continue;
      const nx = (-dy / len) * h, ny = (dx / len) * h;
      tris.push(x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny);
      tris.push(x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny);
    }
    if (h > 0.75) for (const [x, y] of p) disc(x, y); // joins only matter once lines are thick
  }
  return new Float32Array(tris);
}

/** Axis-aligned cover quad (two triangles) over all polygons, padded. */
export function coverQuad(polyLists, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const polys of polyLists) for (const p of polys) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return new Float32Array(0);
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  return new Float32Array([x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1]);
}

/** Signed area sum of the fan triangles — equals the even-odd area for simple shapes (tests). */
export function trianglesArea(tris) {
  let a = 0;
  for (let i = 0; i < tris.length; i += 6) {
    a += ((tris[i + 2] - tris[i]) * (tris[i + 5] - tris[i + 1]) - (tris[i + 4] - tris[i]) * (tris[i + 3] - tris[i + 1])) / 2;
  }
  return a;
}
