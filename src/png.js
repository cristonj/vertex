// Pure-JS vector rasterizer: world -> PNG. Zero dependencies (node:zlib only).
// Fills polygons (even-odd scanline) and strokes (thick quads + round joins) with flat color,
// using the same coordinates as toSVG. HUD text is not rasterized (agents use the SVG for that).
import { deflateSync } from 'node:zlib';
import { flatten } from './path.js';

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ffa500', purple: '#800080',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', gold: '#ffd700', navy: '#000080',
  teal: '#008080', pink: '#ffc0cb', brown: '#a52a2a',
};

/** Minimal CSS color parser: hex, rgb()/rgba(), and a few names. Returns [r,g,b] or null. */
export function parseColor(s) {
  if (typeof s !== 'string') return null;
  s = s.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p[3] === 0) return null;
    return p.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))));
  }
  return null;
}

/**
 * Render a world to a PNG buffer. Default size = world size (1 world unit = 1 pixel);
 * pass width/height to render at any other resolution — vectors stay crisp.
 */
export function toPNG(world, { width = world.width, height = world.height } = {}) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const px = Buffer.alloc(width * height * 3);
  const bg = parseColor(world.background) ?? [0, 0, 0];
  for (let i = 0; i < px.length; i += 3) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; }

  const sx = width / world.width, sy = height / world.height;
  for (const e of world.entities) {
    const shape = world.shapes[e.shape];
    if (!shape || e.hidden) continue;
    const cos = Math.cos(e.rot), sin = Math.sin(e.rot);
    const T = (x, y) => [
      (e.x + (x * cos - y * sin) * e.scale) * sx,
      (e.y + (x * sin + y * cos) * e.scale) * sy,
    ];
    for (const part of shape.parts) {
      const polys = part.polys ?? flatten(part.cmds);
      const paths = polys.map((p) => p.map(([x, y]) => T(x, y)));
      const fill = parseColor(part.fill);
      if (fill) fillPolys(px, width, height, paths, fill);
      const stroke = parseColor(part.stroke);
      if (stroke) {
        const w = (part.width ?? 1) * e.scale * ((sx + sy) / 2);
        for (const poly of strokePolys(paths, w)) fillPolys(px, width, height, [poly], stroke);
      }
    }
  }
  return encodePNG(px, width, height);
}

/** Even-odd scanline fill of one or more subpaths (shared edges => holes work). */
function fillPolys(px, W, H, paths, [r, g, b]) {
  let minY = Infinity, maxY = -Infinity;
  const edges = [];
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; // wrap: SVG fills close subpaths
      if (y1 === y2) continue;
      edges.push([x1, y1, x2, y2]);
      if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
      if (y2 < minY) minY = y2; if (y2 > maxY) maxY = y2;
    }
  }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.floor(maxY));
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    const xs = [];
    for (const [x1, ya, x2, yb] of edges) {
      if ((sy >= ya && sy < yb) || (sy >= yb && sy < ya)) {
        xs.push(x1 + (sy - ya) * (x2 - x1) / (yb - ya));
      }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let x = xa; x <= xb; x++) {
        const i = (y * W + x) * 3;
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    }
  }
}

/** Expand polylines into filled quads + 12-gon joins/caps (round caps, round joins). */
function strokePolys(paths, width) {
  const hw = Math.max(0.5, width / 2);
  const out = [];
  for (const p of paths) {
    const closed = p.length > 2 &&
      Math.abs(p[0][0] - p[p.length - 1][0]) < 1e-6 && Math.abs(p[0][1] - p[p.length - 1][1]) < 1e-6;
    const pts = closed ? p.slice(0, -1) : p;
    const n = pts.length;
    if (n < 2) continue;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * hw, ny = (dx / len) * hw;
      out.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
    }
    for (const [vx, vy] of pts) out.push(circle(vx, vy, hw));
  }
  return out;
}

function circle(cx, cy, r, steps = 12) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// --- PNG encoding (truecolor RGB, no interlace) ---

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG(rgb, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
