import { parsePath, flatten, bounds } from './path.js';
import { assertValidScene } from './validate.js';

/**
 * A World is plain data: shapes (vector art) + entities (instances) + state.
 * Everything serializes to JSON, so humans and agents can read/write it directly.
 *
 * Shape:  { d: "M0 0 L10 0 Z", fill?: "#fff", stroke?: "#000", width?: 1, parts?: Shape[] }
 *         fill may also be a gradient: { type: "linear"|"radial", ..., stops: [[t, color]] }
 *         and parts may carry `clip: "M..."` to clip the part's geometry.
 * Entity: { id, shape, x, y, rot, scale, vx, vy, vr, tags: [], data: {} }
 *         or inline geometry: { id, d: "M...", fill?, stroke?, width? } — art written at runtime.
 */
export class World {
  constructor(doc = {}) {
    this.restore(doc);
  }

  /** Replace this world's contents in place (systems holding a reference keep working). */
  restore(doc) {
    assertValidScene(doc);
    this.width = doc.width ?? 800;
    this.height = doc.height ?? 600;
    this.background = doc.background ?? '#000';
    if (doc.camera) this.camera = { zoom: 1, rot: 0, ...doc.camera }; else delete this.camera;
    const prev = this.shapes ?? {};
    this.shapes = {};
    this.entities = [];
    this.state = structuredClone(doc.state ?? {});
    this.sounds = structuredClone(doc.sounds ?? {});
    this._byId = new Map();
    this.time = 0;
    this.frame = 0;
    this._nextId = 1;
    for (const [name, s] of Object.entries(doc.shapes ?? {})) {
      // Reuse compiled geometry when unchanged, so rewinds don't re-tessellate GPU meshes.
      if (prev[name] && JSON.stringify(prev[name].src) === JSON.stringify(s)) this.shapes[name] = prev[name];
      else this.defineShape(name, s);
    }
    for (const e of doc.entities ?? []) this.spawn(e);
    return this;
  }

  /** Register a vector shape. Geometry is parsed once and cached (per part and combined). */
  defineShape(name, shape) {
    const parts = shape.parts ?? [shape];
    const compiled = parts.map((p) => {
      const cmds = parsePath(p.d);
      const polys = flatten(cmds);
      return { ...p, cmds, polys };
    });
    const polys = compiled.flatMap((p) => p.polys);
    const pad = Math.max(0, ...compiled.map((p) => (p.stroke && p.stroke !== 'none' ? (p.width ?? 1) / 2 : 0)));
    this.shapes[name] = { src: shape, parts: compiled, polys, bounds: bounds(polys), pad };
    return this.shapes[name];
  }

  spawn(e) {
    const ent = {
      id: e.id ?? `e${this._nextId++}`,
      shape: e.shape, x: 0, y: 0, rot: 0, scale: 1, vx: 0, vy: 0, vr: 0,
      ...e,
      tags: [...(e.tags ?? [])],
      data: structuredClone(e.data ?? {}),
    };
    this.entities.push(ent);
    this._byId.set(ent.id, ent);
    return ent;
  }

  despawn(entOrId) {
    const id = typeof entOrId === 'string' ? entOrId : entOrId.id;
    const known = this._byId.get(id);
    const i = known ? this.entities.lastIndexOf(known) : this.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.entities.splice(i, 1);
    this._byId.delete(id);
  }

  /** O(1) lookup by id (falls back to a scan for entities pushed without spawn()). */
  get(id) {
    const e = this._byId.get(id);
    if (e) return e;
    const found = this.entities.find((x) => x.id === id);
    if (found) this._byId.set(id, found);
    return found;
  }
  query(tag) { return this.entities.filter((e) => e.tags.includes(tag)); }

  /** World-space bounding radius of an entity (inline geometry or registered shape). */
  radius(e) { return (entityGeom(this, e).bounds.radius ?? 0) * e.scale; }

  /** Serialize back to a document (round-trips through the constructor). */
  toJSON() {
    return {
      width: this.width, height: this.height, background: this.background,
      ...(this.camera ? { camera: { ...this.camera } } : {}),
      ...(Object.keys(this.sounds).length ? { sounds: this.sounds } : {}),
      shapes: Object.fromEntries(Object.entries(this.shapes).map(([k, v]) => [k, v.src])),
      entities: this.entities.map((e) => ({ ...e })),
      state: this.state,
    };
  }
}

// Inline entity geometry (`e.d`) cache: compiled once per d string, recompiled on change.
const geomCache = new WeakMap();

/**
 * Effective local geometry of an entity: inline `e.d` (compiled + cached per entity) or the
 * registered shape. Returns a shape-like { polys, bounds, parts? } in local coordinates.
 */
export function entityGeom(world, e) {
  if (e.d != null) {
    let g = geomCache.get(e);
    if (!g || g.d !== e.d) {
      const cmds = parsePath(e.d);
      const polys = flatten(cmds);
      g = { d: e.d, cmds, polys, bounds: bounds(polys), pad: (e.width ?? 1) / 2 };
      geomCache.set(e, g);
    }
    return g;
  }
  return world.shapes[e.shape] ?? { polys: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, radius: 0 } };
}
