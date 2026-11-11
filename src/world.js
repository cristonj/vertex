import { parsePath, flatten, bounds } from './path.js';
import { assertValidScene } from './validate.js';

/**
 * A World is plain data: shapes (vector art) + entities (instances) + state.
 * Everything serializes to JSON, so humans and agents can read/write it directly.
 *
 * Shape:  { d: "M0 0 L10 0 Z", fill?: "#fff", stroke?: "#000", width?: 1, parts?: Shape[] }
 * Entity: { id, shape, x, y, rot, scale, vx, vy, vr, tags: [], data: {} }
 */
export class World {
  constructor(doc = {}) {
    assertValidScene(doc);
    this.width = doc.width ?? 800;
    this.height = doc.height ?? 600;
    this.background = doc.background ?? '#000';
    this.shapes = {};
    this.entities = [];
    this.state = structuredClone(doc.state ?? {});
    this.time = 0;
    this.frame = 0;
    this._nextId = 1;
    for (const [name, s] of Object.entries(doc.shapes ?? {})) this.defineShape(name, s);
    for (const e of doc.entities ?? []) this.spawn(e);
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
    this.shapes[name] = { src: shape, parts: compiled, polys, bounds: bounds(polys) };
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
    return ent;
  }

  despawn(entOrId) {
    const id = typeof entOrId === 'string' ? entOrId : entOrId.id;
    const i = this.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.entities.splice(i, 1);
  }

  get(id) { return this.entities.find((e) => e.id === id); }
  query(tag) { return this.entities.filter((e) => e.tags.includes(tag)); }

  /** World-space bounding radius of an entity. */
  radius(e) { return (this.shapes[e.shape]?.bounds.radius ?? 0) * e.scale; }

  /** Serialize back to a document (round-trips through the constructor). */
  toJSON() {
    return {
      width: this.width, height: this.height, background: this.background,
      shapes: Object.fromEntries(Object.entries(this.shapes).map(([k, v]) => [k, v.src])),
      entities: this.entities.map((e) => ({ ...e })),
      state: this.state,
    };
  }
}
