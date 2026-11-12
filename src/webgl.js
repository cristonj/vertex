// WebGL2 backend. Same input and output as CanvasRenderer, built for large scenes:
//  - every shape part is tessellated ONCE (src/tess.js) into GPU buffers, keyed by the part;
//  - fills are exact even-odd via stencil-then-cover, so holes and concave art just work;
//  - per-entity cost is one matrix uniform + a few draw calls, no path re-parsing;
//  - camera, layers, parallax and off-screen culling come from src/view.js, like every backend.
// Usage: game.run(new WebGLRenderer(canvas))  — falls back to null if WebGL2 is unavailable.

import { fanTriangles, strokeTriangles, coverQuad } from './tess.js';
import { drawList } from './view.js';
import { cullRadius } from './render.js';
import { entityGeom, inlineD, inlineStyle } from './world.js';
import { parseColor } from './png.js';
import { textPath } from './text.js';
import { flatten, parsePath } from './path.js';

const VS = `#version 300 es
in vec2 a_pos;
uniform vec3 u_m0; uniform vec3 u_m1; uniform vec2 u_res;
out vec2 v_local;
void main() {
  vec2 p = vec2(dot(u_m0, vec3(a_pos, 1.0)), dot(u_m1, vec3(a_pos, 1.0)));
  v_local = a_pos;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_local;
uniform int u_mode; uniform vec4 u_color;
uniform vec4 u_geo; uniform int u_n; uniform float u_off[8]; uniform vec4 u_col[8];
out vec4 o;
void main() {
  if (u_mode == 0) { o = u_color; return; }
  float t;
  if (u_mode == 1) { vec2 v = u_geo.zw - u_geo.xy; t = dot(v_local - u_geo.xy, v) / max(dot(v, v), 1e-6); }
  else t = length(v_local - u_geo.xy) / max(u_geo.z, 1e-6);
  vec4 c = u_col[0];
  for (int i = 1; i < 8; i++) {
    if (i >= u_n) break;
    if (t > u_off[i - 1]) c = mix(u_col[i - 1], u_col[i], clamp((t - u_off[i - 1]) / max(u_off[i] - u_off[i - 1], 1e-6), 0.0, 1.0));
  }
  o = c;
}`;

const rgba = (s) => { const c = parseColor(s); return c ? [c[0] / 255, c[1] / 255, c[2] / 255, 1] : null; };

export class WebGLRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { stencil: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 unavailable — use CanvasRenderer');
    this.canvas = canvas; this.gl = gl;
    this.prog = link(gl, VS, FS);
    const u = (n) => gl.getUniformLocation(this.prog, n);
    this.u = { m0: u('u_m0'), m1: u('u_m1'), res: u('u_res'), mode: u('u_mode'), color: u('u_color'),
      geo: u('u_geo'), n: u('u_n'), off: u('u_off'), col: u('u_col') };
    this.aPos = gl.getAttribLocation(this.prog, 'a_pos');
    this.parts = new WeakMap();     // compiled part -> GPU mesh
    this.inline = new WeakMap();    // entity -> { d, mesh }
    this.hudMesh = new Map();       // hud string -> mesh
    this.stats = { entities: 0, draws: 0 };
  }

  buffer(data) {
    const gl = this.gl;
    if (!data.length) return null;
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, buf, count: data.length / 2 };
  }

  /** Tessellate a part once: fill fans, clip fans, stroke triangles, cover quad. */
  mesh(part, polys) {
    const clipPolys = part.clip ? flatten(parsePath(part.clip)) : null;
    const stroked = part.stroke && part.stroke !== 'none';
    const w = part.width ?? 1;
    return {
      fill: part.fill && part.fill !== 'none' ? this.buffer(fanTriangles(polys)) : null,
      clip: clipPolys ? this.buffer(fanTriangles(clipPolys)) : null,
      stroke: stroked ? this.buffer(strokeTriangles(polys, w)) : null,
      cover: this.buffer(coverQuad(clipPolys ? [polys, clipPolys] : [polys], stroked ? w : 1)),
    };
  }

  draw(world) {
    const { gl, canvas, u } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const bg = rgba(world.background) ?? [0, 0, 0, 1];
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(u.res, world.width, world.height);
    gl.enable(gl.STENCIL_TEST);
    this.stats.draws = 0;
    const list = drawList(world, cullRadius(world));
    this.stats.entities = list.length;
    for (const [e, m] of list) {
      gl.uniform3f(u.m0, m[0], m[2], m[4]);
      gl.uniform3f(u.m1, m[1], m[3], m[5]);
      const d = inlineD(e);
      if (d != null) {
        let rec = this.inline.get(e);
        const style = inlineStyle(e);
        if (!rec || rec.d !== d || rec.part.width !== style.width) {
          if (rec) this.free(rec.mesh);
          const part = { d, ...style };
          rec = { d, part, mesh: this.mesh(part, entityGeom(world, e).polys) };
          this.inline.set(e, rec);
        }
        rec.part.fill = style.fill; rec.part.stroke = style.stroke;
        this.paint(rec.part, rec.mesh);
        continue;
      }
      const shape = world.shapes[e.shape];
      if (!shape) continue;
      for (const part of shape.parts) {
        let mesh = this.parts.get(part);
        if (!mesh) { mesh = this.mesh(part, part.polys); this.parts.set(part, mesh); }
        this.paint(part, mesh);
      }
    }
    if (world.state.hud) this.drawHUD(String(world.state.hud), world.state.hudColor);
    gl.disable(gl.STENCIL_TEST);
  }

  call(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    this.stats.draws++;
  }

  setPaint(fill) {
    const { gl, u } = this;
    if (fill && typeof fill === 'object') {
      const stops = [...fill.stops].sort((a, b) => a[0] - b[0]).slice(0, 8);
      gl.uniform1i(u.mode, fill.type === 'radial' ? 2 : 1);
      gl.uniform4f(u.geo, ...(fill.type === 'radial' ? [fill.cx ?? 0, fill.cy ?? 0, fill.r ?? 1, 0]
        : [fill.x1 ?? 0, fill.y1 ?? 0, fill.x2 ?? 1, fill.y2 ?? 0]));
      gl.uniform1i(u.n, stops.length);
      gl.uniform1fv(u.off, new Float32Array(8).map((_, i) => stops[Math.min(i, stops.length - 1)][0]));
      const cols = new Float32Array(32);
      stops.forEach(([, c], i) => cols.set(rgba(c) ?? [0, 0, 0, 0], i * 4));
      gl.uniform4fv(u.col, cols);
      return true;
    }
    const c = rgba(fill);
    if (!c) return false;
    gl.uniform1i(u.mode, 0);
    gl.uniform4f(u.color, ...c);
    return true;
  }

  paint(part, mesh) {
    const gl = this.gl;
    if (mesh.fill && this.setPaint(part.fill)) {
      // 1) even-odd coverage into stencil bit 0 (and clip region into bit 1)
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      gl.stencilMask(0x01); this.call(mesh.fill);
      if (mesh.clip) { gl.stencilMask(0x02); this.call(mesh.clip); }
      // 2) cover: paint where coverage (and clip) bits are set, zero every touched pixel
      gl.colorMask(true, true, true, true);
      const ref = mesh.clip ? 0x03 : 0x01;
      gl.stencilFunc(gl.EQUAL, ref, ref);
      gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      gl.stencilMask(0xff); this.call(mesh.cover);
    }
    if (mesh.stroke && this.setPaint(part.stroke)) {
      if (mesh.clip) {
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.stencilMask(0x02); this.call(mesh.clip);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.EQUAL, 0x02, 0x02); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        this.call(mesh.stroke);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
        gl.stencilMask(0xff); this.call(mesh.cover);
        gl.colorMask(true, true, true, true);
      } else {
        gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        this.call(mesh.stroke);
      }
    }
  }

  drawHUD(hud, color = '#fff') {
    const { gl, u } = this;
    let mesh = this.hudMesh.get(hud);
    if (!mesh) {
      const polys = textPath(hud, 16).parts.flatMap((p) => flatten(parsePath(p.d)));
      mesh = this.buffer(strokeTriangles(polys, 1.5));
      if (this.hudMesh.size > 64) { for (const m of this.hudMesh.values()) this.free({ stroke: m }); this.hudMesh.clear(); }
      this.hudMesh.set(hud, mesh);
    }
    if (!mesh) return;
    gl.uniform3f(u.m0, 1, 0, 12); gl.uniform3f(u.m1, 0, 1, 24);
    this.setPaint(color);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    this.call(mesh);
  }

  free(mesh) {
    for (const m of Object.values(mesh)) if (m) { this.gl.deleteBuffer(m.buf); this.gl.deleteVertexArray(m.vao); }
  }
}

function link(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/** Best available renderer for a canvas: WebGL2, else Canvas2D. */
export async function autoRenderer(canvas) {
  try { return new WebGLRenderer(canvas); } catch {
    const { CanvasRenderer } = await import('./render.js');
    return new CanvasRenderer(canvas);
  }
}
