// SVG path data parser + flattener. Zero dependencies.
// Supports: M L H V C S Q T Z (absolute + relative). Arcs (A) are approximated as lines for now.

const CMD = /[MmLlHhVvCcSsQqTtAaZz]/;
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Parse an SVG `d` string into absolute commands.
 * @param {string} d
 * @returns {Array<[string, ...number[]]>}
 */
export function parsePath(d) {
  const tokens = d.match(TOKEN) || [];
  const out = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl = null; // for S/T reflection
  while (i < tokens.length) {
    if (CMD.test(tokens[i])) cmd = tokens[i++];
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARITY[up];
    if (up === 'Z') {
      out.push(['Z']); x = sx; y = sy; lastCtrl = null;
      continue;
    }
    const a = tokens.slice(i, i + n).map(Number);
    if (a.length < n) break;
    i += n;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (up) {
      case 'M':
        x = a[0] + ox; y = a[1] + oy; sx = x; sy = y;
        out.push(['M', x, y]);
        cmd = rel ? 'l' : 'L'; // implicit lineto after moveto
        lastCtrl = null; break;
      case 'L': x = a[0] + ox; y = a[1] + oy; out.push(['L', x, y]); lastCtrl = null; break;
      case 'H': x = a[0] + (rel ? x : 0); out.push(['L', x, y]); lastCtrl = null; break;
      case 'V': y = a[0] + (rel ? y : 0); out.push(['L', x, y]); lastCtrl = null; break;
      case 'C': {
        const c = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
        out.push(['C', ...c]); lastCtrl = ['C', c[2], c[3]]; x = c[4]; y = c[5]; break;
      }
      case 'S': {
        const [rx, ry] = lastCtrl && lastCtrl[0] === 'C' ? [2 * x - lastCtrl[1], 2 * y - lastCtrl[2]] : [x, y];
        const c = [rx, ry, a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push(['C', ...c]); lastCtrl = ['C', c[2], c[3]]; x = c[4]; y = c[5]; break;
      }
      case 'Q': {
        const c = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push(['Q', ...c]); lastCtrl = ['Q', c[0], c[1]]; x = c[2]; y = c[3]; break;
      }
      case 'T': {
        const [rx, ry] = lastCtrl && lastCtrl[0] === 'Q' ? [2 * x - lastCtrl[1], 2 * y - lastCtrl[2]] : [x, y];
        const c = [rx, ry, a[0] + ox, a[1] + oy];
        out.push(['Q', ...c]); lastCtrl = ['Q', rx, ry]; x = c[2]; y = c[3]; break;
      }
      case 'A': // TODO: true arc flattening
        x = a[5] + ox; y = a[6] + oy; out.push(['L', x, y]); lastCtrl = null; break;
    }
  }
  return out;
}

/**
 * Flatten commands into polygons (arrays of [x,y]) — used for collision + bounds.
 * @param {Array<[string, ...number[]]>} cmds
 * @param {number} [steps=8] curve subdivision
 */
export function flatten(cmds, steps = 8) {
  const polys = [];
  let cur = null, x = 0, y = 0;
  for (const c of cmds) {
    switch (c[0]) {
      case 'M': cur = [[c[1], c[2]]]; polys.push(cur); x = c[1]; y = c[2]; break;
      case 'L': cur.push([c[1], c[2]]); x = c[1]; y = c[2]; break;
      case 'Q':
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, u = 1 - t;
          cur.push([u * u * x + 2 * u * t * c[1] + t * t * c[3], u * u * y + 2 * u * t * c[2] + t * t * c[4]]);
        }
        x = c[3]; y = c[4]; break;
      case 'C':
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, u = 1 - t;
          cur.push([
            u * u * u * x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
            u * u * u * y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
          ]);
        }
        x = c[5]; y = c[6]; break;
      case 'Z': if (cur && cur.length) { x = cur[0][0]; y = cur[0][1]; cur.push([x, y]); } break;
    }
  }
  return polys;
}

/** Axis-aligned bounds + bounding radius (from local origin) of polygons. */
export function bounds(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, r2 = 0;
  for (const p of polys) for (const [x, y] of p) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    const d = x * x + y * y; if (d > r2) r2 = d;
  }
  return { minX, minY, maxX, maxY, radius: Math.sqrt(r2) };
}
