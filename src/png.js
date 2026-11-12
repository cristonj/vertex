// Pure-JS vector rasterizer: world -> PNG. Zero dependencies, runs in Node and browsers.
// Compression: a pluggable deflate (Node's zlib is wired in by src/node.js); without it,
// PNGs are written with stored (uncompressed) deflate blocks — valid, just larger.
// Fills polygons (even-odd scanline) and strokes (thick quads + round joins) with flat color
// or gradients, using the same coordinates as toSVG. Renders registered shapes, inline
// entity geometry (e.d), gradient fills, and HUD text via the built-in vector stroke font.
import { flatten, parsePath } from './path.js';
import { textPath } from './text.js';
import { drawList, invert, apply, matScale } from './view.js';
import { cullRadius } from './render.js';
import { projectSpace } from './space.js';
import { entityGeom, inlineD, inlineStyle } from './world.js';

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

/** Color ramp through gradient stops, as [r,g,b]. */
function ramp(stops, t) {
  const s = [...stops].sort((a, b) => a[0] - b[0]);
  if (t <= s[0][0]) return parseColor(s[0][1]);
  if (t >= s[s.length - 1][0]) return parseColor(s[s.length - 1][1]);
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) {
      const f = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0] || 1);
      const a = parseColor(s[i - 1][1]), b = parseColor(s[i][1]);
      return a.map((v, j) => Math.round(v + (b[j] - v) * f));
    }
  }
  return parseColor(s[s.length - 1][1]);
}

/**
 * Render a world to a PNG buffer. Default size = world size (1 world unit = 1 pixel);
 * pass width/height to render at any other resolution â€” vectors stay crisp.
 */
export function toPNG(world, { width = world.width, height = world.height } = {}) {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const px = new Uint8Array(width * height * 3);
  const bg = parseColor(world.background) ?? [0, 0, 0];
  for (let i = 0; i < px.length; i += 3) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; }

  const sx = width / world.width, sy = height / world.height;
  if (world.space) {
    for (const f of projectSpace(world)) {
      const paths = flatten(parsePath(f.d)).map((poly) => poly.map(([x, y]) => [x * sx, y * sy]));
      fillPolys(px, width, height, paths, parseColor(f.fill));
      const st = parseColor(f.stroke);
      if (st) for (const poly of strokePolys(paths, (f.width ?? 1) * ((sx + sy) / 2))) fillPolys(px, width, height, [poly], st);
    }
  }
  for (const [e, m] of drawList(world, cullRadius(world))) {
    const parts = inlineD(e) != null
      ? [{ polys: entityGeom(world, e).polys, ...inlineStyle(e) }]
      : world.shapes[e.shape]?.parts;
    if (!parts) continue;
    const T = (x, y) => { const [X, Y] = apply(m, x, y); return [X * sx, Y * sy]; };
    const mi = invert(m);
    const inv = (pX, pY) => apply(mi, pX / sx, pY / sy); // pixel -> shape-local, for gradients
    const ms = matScale(m);
    const gradAt = (fill) => {
      if (fill.type === 'radial') return (pX, pY) => { const [lx, ly] = inv(pX, pY); return ramp(fill.stops, Math.hypot(lx - fill.cx, ly - fill.cy) / fill.r); };
      const vx = fill.x2 - fill.x1, vy = fill.y2 - fill.y1, v2 = vx * vx + vy * vy || 1;
      return (pX, pY) => { const [lx, ly] = inv(pX, pY); return ramp(fill.stops, ((lx - fill.x1) * vx + (ly - fill.y1) * vy) / v2); };
    };
    for (const part of parts) {
      const polys = part.polys ?? flatten(part.cmds);
      const paths = polys.map((p) => p.map(([x, y]) => T(x, y)));
      if (part.fill) {
        const colorAt = typeof part.fill === 'object' ? gradAt(part.fill) : null;
        if (colorAt || parseColor(part.fill)) fillPolys(px, width, height, paths, colorAt ?? parseColor(part.fill));
      }
      const stroke = parseColor(part.stroke);
      if (stroke) {
        const w = (part.width ?? 1) * ms * ((sx + sy) / 2);
        for (const poly of strokePolys(paths, w)) fillPolys(px, width, height, [poly], stroke);
      }
    }
  }

  // HUD as vector glyphs (baseline at world 12,24, size 16)
  if (world.state.hud) {
    const T = (x, y) => [(12 + x) * sx, (24 + y) * sy];
    const color = parseColor(world.state.hudColor) ?? [255, 255, 255];
    for (const p of textPath(String(world.state.hud), 16).parts) {
      const paths = flatten(parsePath(p.d)).map((poly) => poly.map(([x, y]) => T(x, y)));
      for (const poly of strokePolys(paths, 1.5 * ((sx + sy) / 2))) fillPolys(px, width, height, [poly], color);
    }
  }

  return encodePNG(px, width, height);
}

/** Even-odd scanline fill of one or more subpaths. `color` is [r,g,b] or colorAt(px,py). */
function fillPolys(px, W, H, paths, color) {
  const fn = typeof color === 'function' ? color : null;
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
        const [r, g, b] = fn ? fn(x, y) : color;
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

let deflateImpl = storedDeflate;
/** Plug in a real deflate (e.g. zlib.deflateSync). Called by src/node.js. */
export function setDeflate(fn) { deflateImpl = fn; }

/** zlib stream made of stored blocks: no compression, no dependencies, always valid. */
function storedDeflate(data) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2, a = 1, b = 0;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535, len = Math.min(65535, data.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 255; out[o++] = len >> 8; out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255;
    out.set(data.subarray(start, start + len), o); o += len;
  }
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  const adler = ((b << 16) | a) >>> 0;
  out[o++] = adler >>> 24; out[o++] = (adler >>> 16) & 255; out[o++] = (adler >>> 8) & 255; out[o++] = adler & 255;
  return out;
}

const u32 = (out, v, o) => { out[o] = v >>> 24; out[o + 1] = (v >>> 16) & 255; out[o + 2] = (v >>> 8) & 255; out[o + 3] = v & 255; };

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  u32(out, data.length, 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  u32(out, crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode packed RGB bytes as a PNG. Returns a Uint8Array (a Buffer under Node). */
export function encodePNG(rgb, width, height) {
  const ihdr = new Uint8Array(13);
  u32(ihdr, width, 0); u32(ihdr, height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateImpl(raw)), chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return globalThis.Buffer ? globalThis.Buffer.from(out.buffer, out.byteOffset, out.length) : out;
}
