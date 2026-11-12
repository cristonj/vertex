// Two renderers over the same data:
//  - toSVG(world): headless string output. Agents can "see" a frame as text, diff it, or rasterize it.
//  - CanvasRenderer: browser, Path2D cached per shape part, zero allocations per frame.
// Both support: registered shapes, inline entity geometry (e.d), gradient fills,
// part clipping, and HUD text rendered with the built-in vector stroke font.

import { textPath } from './text.js';
import { drawList } from './view.js';
import { projectSpace, meshOf } from './space.js';
import { entityGeom, inlineD, inlineStyle } from './world.js';

/** Local bounding radius incl. stroke padding, for culling. */
export const cullRadius = (world) => (e) => { const g = entityGeom(world, e); return (g.bounds?.radius ?? 0) + (g.pad ?? 0); };

const r = (n) => Math.round(n * 100) / 100;

const isGrad = (fill) => fill && typeof fill === 'object';

// Gradient/clip def ids are derived from content position (shape name + part index, or
// entity id), never from a process-wide counter: the same world always renders the same
// bytes, so frame digests match across processes, replays and implementations.

function gradStops(g) {
  return [...g.stops].sort((a, b) => a[0] - b[0])
    .map(([off, col]) => `<stop offset="${off}" stop-color="${col}"/>`).join('');
}

function gradDefXML(fill, id) {
  if (fill.type === 'radial') {
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fill.cx}" cy="${fill.cy}" r="${fill.r}">${gradStops(fill)}</radialGradient>`;
  }
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fill.x1}" y1="${fill.y1}" x2="${fill.x2}" y2="${fill.y2}">${gradStops(fill)}</linearGradient>`;
}

function partAttrs(p, key) {
  const fill = isGrad(p.fill) ? `url(#g-${key})` : (p.fill ?? 'none');
  let attrs = `fill="${fill}" stroke="${p.stroke ?? 'none'}"`;
  if (p.width) attrs += ` stroke-width="${p.width}"`;
  if (p.stroke) attrs += ' stroke-linejoin="round" stroke-linecap="round"';
  if (isGrad(p.fill)) gradDefs.add(gradDefXML(p.fill, `g-${key}`));
  if (p.clip) {
    const id = `c-${key}`;
    gradDefs.add(`<clipPath id="${id}"><path d="${p.clip}"/></clipPath>`);
    attrs += ` clip-path="url(#${id})"`;
  }
  return attrs;
}

const gradDefs = new Set(); // defs accumulated during one render pass

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

/** HUD string -> glyph path group in world units (baseline at 12,24). */
function hudGroup(hud) {
  const { parts } = textPath(String(hud), 16);
  return `<g transform="translate(12 24)" fill="none" stroke="${hudColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    parts.map((p) => `<path d="${p.d}"/>`).join('') + '</g>';
}

let hudColor = '#fff';

/** Render the world to a standalone SVG string. */
export function toSVG(world, { hud = true, hudFill = '#fff', cull = true } = {}) {
  hudColor = hudFill;
  gradDefs.clear();
  const defs = Object.entries(world.shapes).map(([name, s]) =>
    `<g id="${name}">${s.parts.map((p, i) =>
      `<path d="${esc(p.d)}" ${partAttrs(p, `${name}-${i}`)}/>`).join('')}</g>`).join('');
  const cam = !!world.camera;
  // 3D: projected, shaded faces (back to front) form the world; 2D entities draw on top.
  const faces = world.space ? projectSpace(world).map((f) =>
    `<path data-id="${f.id}" d="${f.d}" ${partAttrs({ fill: f.fill, stroke: f.stroke, width: f.width }, '')}/>`).join('') : '';
  const uses = faces + drawList(world, cullRadius(world), { cull }).map(([e, m]) => {
    if (e.shape && meshOf(world.shapes[e.shape])) return '';
    const t = cam
      ? `matrix(${m.map((v) => +v.toFixed(4)).join(' ')})`
      : `translate(${r(e.x)} ${r(e.y)}) rotate(${r(e.rot * 180 / Math.PI)}) scale(${r(e.scale)})`;
    const d = inlineD(e);
    if (d != null) {
      const p = { d, ...inlineStyle(e) };
      return `<path data-id="${e.id}" d="${esc(d)}" ${partAttrs(p, `e-${e.id}`)} transform="${t}"/>`;
    }
    if (!e.shape) return '';
    return `<use href="#${e.shape}" data-id="${e.id}" transform="${t}"/>`;
  }).join('');
  const hudSvg = hud && world.state.hud ? hudGroup(world.state.hud) : '';
  const extraDefs = gradDefs.size ? [...gradDefs].join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${world.width} ${world.height}" width="${world.width}" height="${world.height}">` +
    `<rect width="100%" height="100%" fill="${world.background}"/><defs>${defs}${extraDefs}</defs>${uses}${hudSvg}</svg>`;
}

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cache = new WeakMap();   // compiled shape -> { paths: Path2D[], clips: Path2D[] }
    this.grads = new WeakMap();   // gradient part -> CanvasGradient
    this.entityPaths = new WeakMap(); // entity -> { d, path }
    this.hudCache = new Map();    // hud string -> Path2D[]
  }

  compiled(shape) {
    let c = this.cache.get(shape);
    if (!c) {
      c = { paths: shape.parts.map((p) => new Path2D(p.d)), clips: shape.parts.map((p) => p.clip ? new Path2D(p.clip) : null) };
      this.cache.set(shape, c);
    }
    return c;
  }

  grad(p) {
    let g = this.grads.get(p);
    if (!g) {
      const ctx = this.ctx;
      if (p.fill.type === 'radial') g = ctx.createRadialGradient(p.fill.cx, p.fill.cy, 0, p.fill.cx, p.fill.cy, p.fill.r);
      else g = ctx.createLinearGradient(p.fill.x1, p.fill.y1, p.fill.x2, p.fill.y2);
      for (const [off, col] of [...p.fill.stops].sort((a, b) => a[0] - b[0])) g.addColorStop(off, col);
      this.grads.set(p, g);
    }
    return g;
  }

  paint(ctx, p, path, clip) {
    if (clip) { ctx.save(); ctx.clip(clip); }
    if (p.fill && !isGrad(p.fill) && p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill(path); }
    else if (isGrad(p.fill)) { ctx.fillStyle = this.grad(p); ctx.fill(path); }
    if (p.stroke && p.stroke !== 'none') {
      ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? 1;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(path);
    }
    if (clip) ctx.restore();
  }

  hud(hud) {
    let paths = this.hudCache.get(hud);
    if (!paths) {
      paths = textPath(hud, 16).parts.map((p) => new Path2D(p.d));
      if (this.hudCache.size > 64) this.hudCache.clear();
      this.hudCache.set(hud, paths);
    }
    return paths;
  }

  draw(world) {
    const { ctx, canvas } = this;
    const sx = (canvas.width / world.width), sy = (canvas.height / world.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = world.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (world.space) {
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.lineJoin = 'round';
      for (const f of projectSpace(world)) {
        const p = new Path2D(f.d);
        ctx.fillStyle = f.fill; ctx.fill(p);
        if (f.stroke) { ctx.strokeStyle = f.stroke; ctx.lineWidth = f.width ?? 1; ctx.stroke(p); }
        else { ctx.strokeStyle = f.fill; ctx.lineWidth = 0.6; ctx.stroke(p); } // hide AA seams between faces
      }
    }
    for (const [e, m] of drawList(world, cullRadius(world))) {
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      const d = inlineD(e);
      if (d != null) {
        let rec = this.entityPaths.get(e);
        if (!rec || rec.d !== d) { rec = { d, path: new Path2D(d) }; this.entityPaths.set(e, rec); }
        this.paint(ctx, inlineStyle(e), rec.path, null);
        continue;
      }
      const shape = world.shapes[e.shape];
      if (!shape) continue;
      const { paths, clips } = this.compiled(shape);
      for (let i = 0; i < shape.parts.length; i++) this.paint(ctx, shape.parts[i], paths[i], clips[i]);
    }
    if (world.state.hud) {
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.translate(12, 24);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const p of this.hud(world.state.hud)) ctx.stroke(p);
    }
  }
}
