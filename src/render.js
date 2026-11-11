// Two renderers over the same data:
//  - toSVG(world): headless string output. Agents can "see" a frame as text, diff it, or rasterize it.
//  - CanvasRenderer: browser, Path2D cached per shape part, zero allocations per frame.

const r = (n) => Math.round(n * 100) / 100;

function partAttrs(p) {
  return `fill="${p.fill ?? 'none'}" stroke="${p.stroke ?? 'none'}"` +
    (p.width ? ` stroke-width="${p.width}"` : '') +
    (p.stroke ? ' stroke-linejoin="round" stroke-linecap="round"' : '');
}

/** Render the world to a standalone SVG string. */
export function toSVG(world, { hud = true } = {}) {
  const defs = Object.entries(world.shapes).map(([name, s]) =>
    `<g id="${name}">${s.parts.map((p) => `<path d="${p.d}" ${partAttrs(p)}/>`).join('')}</g>`).join('');
  const uses = world.entities.filter((e) => e.shape && !e.hidden).map((e) =>
    `<use href="#${e.shape}" data-id="${e.id}" transform="translate(${r(e.x)} ${r(e.y)}) rotate(${r(e.rot * 180 / Math.PI)}) scale(${r(e.scale)})"/>`).join('');
  const text = hud && world.state.hud
    ? `<text x="12" y="24" fill="#fff" font-family="monospace" font-size="16">${escapeXML(String(world.state.hud))}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${world.width} ${world.height}" width="${world.width}" height="${world.height}">` +
    `<rect width="100%" height="100%" fill="${world.background}"/><defs>${defs}</defs>${uses}${text}</svg>`;
}

function escapeXML(s) { return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]); }

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cache = new WeakMap(); // compiled shape -> Path2D[]
  }

  paths(shape) {
    let p = this.cache.get(shape);
    if (!p) { p = shape.parts.map((part) => new Path2D(part.d)); this.cache.set(shape, p); }
    return p;
  }

  draw(world) {
    const { ctx, canvas } = this;
    const sx = (canvas.width / world.width), sy = (canvas.height / world.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = world.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const e of world.entities) {
      const shape = world.shapes[e.shape];
      if (!shape || e.hidden) continue;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.translate(e.x, e.y); ctx.rotate(e.rot); ctx.scale(e.scale, e.scale);
      const paths = this.paths(shape);
      shape.parts.forEach((part, i) => {
        if (part.fill && part.fill !== 'none') { ctx.fillStyle = part.fill; ctx.fill(paths[i]); }
        if (part.stroke && part.stroke !== 'none') {
          ctx.strokeStyle = part.stroke; ctx.lineWidth = part.width ?? 1;
          ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(paths[i]);
        }
      });
    }
    if (world.state.hud) {
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      ctx.fillStyle = '#fff'; ctx.font = '16px monospace';
      ctx.fillText(String(world.state.hud), 12, 24);
    }
  }
}
