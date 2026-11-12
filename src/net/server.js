// Authoritative multiplayer server for any cartridge. Transport-agnostic: anything with
// send(text) and on('message' | 'close') is a connection (src/net/ws.js, in-memory pipes, ...).
//
// cartridge.multiplayer = {
//   player: { shape: "hero", tags: ["player"], body: {...}, ... },   // template for each joiner
//   spawn: { x: 0, y: 0, spread: 200 },                               // where players appear
//   interest: 700,           // radius: each client only receives entities this close to its player
//   plane: "xy" | "xz",      // which coordinates measure distance (xz for 3D ground worlds)
//   publicData: ["name", "hp"],  // entity.data keys other players may see (own player sees all)
//   sendRate: 20,            // snapshots per second (simulation still runs at fps)
//   maxPlayers: 10000
// }
//
// Each player gets an id ("p1", "p2", ...) and an entity with data.player = id. Their inputs are
// namespaced ("p1:left"), and rules running for that entity read them through plain held('left'),
// so single-player cartridges become multiplayer without changes (rules.js "input owner").
//
// Protocol (JSON text messages):
//   client -> server  { t: "hello", name }   { t: "in", p: [...pressed], r: [...released], m: [x, y], a: { axis: v } }
//   server -> client  { t: "welcome", id, entity, fps, sendRate, scene }   (scene = static parts: shapes, sounds, dialogue, ...)
//                     { t: "snap", tick, add: [entity...], upd: [{ id, ...changedFields }], del: [[id, field...]], gone: [id...], state: {...changed} }
// Snapshots are interest-filtered and delta-compressed per client: an idle crowd costs ~0 bytes.

import { loadCartridge } from '../cartridge.js';

const STATIC_KEYS = ['width', 'height', 'background', 'shapes', 'sounds', 'dialogue', 'dialogueStyle', 'interaction', 'space', 'camera', 'physics', 'keys', 'title', 'multiplayer'];
const q = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const PRIVATE = new Set(['data']);

export class GameServer {
  constructor(cartridge, { seed = 1, fps = 60, now = () => Date.now() } = {}) {
    this.doc = cartridge;
    this.mp = { interest: 700, plane: 'xy', publicData: ['name'], sendRate: 20, maxPlayers: 10000, ...(cartridge.multiplayer ?? {}) };
    this.game = loadCartridge(cartridge, { seed, fps });
    this.game.server = true;
    this.game.pointers = {}; this.game.axesBy = {};
    this.clients = new Map();       // id -> client
    this.persist = new WeakMap();   // entity -> { rec, snap }: change detection across ticks
    this.anchors = new WeakMap();   // entity -> dead-reckoning anchor
    this.nextId = 1;
    this.tick = 0;
    this.sendEvery = Math.max(1, Math.round(fps / this.mp.sendRate));
    this.stats = { bytesOut: 0, messagesOut: 0, lastSnapshotBytes: 0 };
    this.now = now;
    this.scene = Object.fromEntries(STATIC_KEYS.filter((k) => cartridge[k] !== undefined).map((k) => [k, cartridge[k]]));
  }

  /** Accept a connection. Returns the client record. */
  connect(conn) {
    const client = { id: null, conn, entity: null, known: new Map(), state: new Map(), held: new Set(), name: null };
    conn.on('message', (msg) => { try { this.onMessage(client, JSON.parse(msg)); } catch (e) { this.sendTo(client, { t: 'error', message: String(e.message ?? e) }); } });
    conn.on('close', () => this.leave(client));
    return client;
  }

  onMessage(client, m) {
    if (m.t === 'hello') return this.join(client, m);
    if (!client.id) return;
    const g = this.game, ns = (a) => `${client.id}:${a}`;
    if (m.t === 'in') {
      for (const a of m.p ?? []) if (typeof a === 'string' && a.length < 64) { g.press(ns(a)); client.held.add(a); }
      for (const a of m.r ?? []) if (typeof a === 'string') { g.release(ns(a)); client.held.delete(a); }
      if (Array.isArray(m.m)) g.pointers[client.id] = { x: +m.m[0] || 0, y: +m.m[1] || 0 };
      if (m.a && typeof m.a === 'object') {
        const ax = (g.axesBy[client.id] ??= {});
        for (const [k, v] of Object.entries(m.a)) { const n = Math.max(-1, Math.min(1, +v || 0)); if (n) ax[k] = n; else delete ax[k]; }
      }
    }
  }

  join(client, { name = null } = {}) {
    if (client.id) return;
    if (this.clients.size >= this.mp.maxPlayers) { this.sendTo(client, { t: 'error', message: 'server full' }); client.conn.close?.(); return; }
    const id = `p${this.nextId++}`, w = this.game.world, tpl = this.mp.player ?? { tags: ['player'] };
    const sp = this.mp.spawn ?? { x: w.width / 2, y: w.height / 2, spread: 0 };
    const r = () => (this.game.random() * 2 - 1) * (sp.spread ?? 0);
    const pos = this.mp.plane === 'xz' ? { x: (sp.x ?? 0) + r(), y: sp.y ?? 0, z: (sp.z ?? 0) + r() } : { x: (sp.x ?? 0) + r(), y: (sp.y ?? 0) + r() };
    const entity = w.spawn({
      ...structuredClone(tpl), ...pos, id: `${id}`,
      tags: [...new Set([...(tpl.tags ?? []), 'player'])],
      data: { ...structuredClone(tpl.data ?? {}), player: id, name: String(name ?? id).slice(0, 32) },
    });
    Object.assign(client, { id, entity: entity.id, name: entity.data.name });
    this.clients.set(id, client);
    // delivered at the start of the next step (like timers), so rules see it
    w.timers.push({ at: w.time, type: 'join', player: id, entity: entity.id });
    this.sendTo(client, { t: 'welcome', id, entity: entity.id, fps: Math.round(1 / this.game.dt), sendRate: this.mp.sendRate, scene: this.scene });
    this.encoded = new Map(); this.records = new Map();
    this.snapshotFor(client, this.buildGrid(), true);
  }

  leave(client) {
    if (!client.id || !this.clients.has(client.id)) return;
    const g = this.game;
    for (const a of client.held) g.release(`${client.id}:${a}`);
    delete g.pointers[client.id]; delete g.axesBy[client.id];
    g.world.despawn(client.entity);
    this.clients.delete(client.id);
    g.world.timers.push({ at: g.world.time, type: 'leave', player: client.id, entity: client.entity });
  }

  /** Advance one simulation step; every sendEvery steps, send snapshots. Returns events. */
  step() {
    const evs = this.game.step(1);
    this.tick++;
    if (this.tick % this.sendEvery === 0) this.broadcast();
    return evs;
  }

  coord(e) { return this.mp.plane === 'xz' ? [e.x, e.z ?? 0] : [e.x, e.y]; }

  buildGrid() {
    const cell = this.mp.interest, grid = new Map();
    for (const e of this.game.world.entities) {
      if (e.tags.includes('ui') || e.tags.includes('particle')) continue; // cosmetic/local-only
      const [x, y] = this.coord(e);
      const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
      const l = grid.get(k); if (l) l.push(e); else grid.set(k, [e]);
    }
    return grid;
  }

  broadcast() {
    const grid = this.buildGrid();
    this.prevRecords = this.records;
    this.encoded = new Map(); // per-tick caches of encoded public entities (shared across clients)
    this.records = new Map();
    for (const c of this.clients.values()) this.snapshotFor(c, grid, false);
  }

  /** Encoded entity + per-field fingerprints + whole-entity signature, cached per tick. */
  record(e, own) {
    if (!own) {
      const c = this.records?.get(e); if (c) return c;
      // across ticks: an entity whose fields are all unchanged reuses last tick's record as-is
      const last = this.persist.get(e);
      if (last && unchanged(e, last.snap)) { this.records?.set(e, last.rec); return last.rec; }
    }
    const enc = this.encode(e, own), fields = {};
    let sig = '';
    for (const k in enc) { const v = enc[k]; const f = typeof v === 'object' ? JSON.stringify(v) : String(v) + (typeof v)[0]; fields[k] = f; sig += k + '=' + f + ';'; }
    const rec = { enc, fields, sig };
    if (!own) { this.records?.set(e, rec); this.persist.set(e, { rec, snap: snapshotOf(e) }); }
    return rec;
  }

  /** Public view of an entity (quantized numbers, data filtered unless it's the owner). */
  encode(e, own, anchored = true) {
    if (anchored && !own && this.encoded?.has(e)) return this.encoded.get(e);
    const out = {};
    const anchor = anchored ? this.anchorOf(e) : null;
    for (const k in e) {
      const v = e[k];
      if (v === undefined || typeof v === 'function' || k.startsWith('_')) continue;
      if (anchor && k in anchor.at) { out[k] = q(anchor.at[k]); continue; }
      if (k === 'emitter') { const { acc, ...rest } = v; out.emitter = rest; continue; } // emitters run client-side
      if (k === 'data' && !own) {
        const pub = {};
        for (const key of this.mp.publicData) if (v[key] !== undefined) pub[key] = v[key];
        out.data = pub;
      } else out[k] = q(v);
    }
    if (anchored && !own) this.encoded?.set(e, out);
    return out;
  }

  /**
   * Dead reckoning: clients integrate velocities themselves, so a moving entity's position is
   * only re-sent when it deviates from x0 + v·t by more than `epsilon` or its velocity changes.
   */
  anchorOf(e) {
    const eps = this.mp.epsilon ?? 0.5, dt = this.game.dt;
    let a = this.anchors.get(e);
    const v = [e.vx ?? 0, e.vy ?? 0, e.vz ?? 0, e.vr ?? 0, e.vry ?? 0];
    if (a && v.every((x, i) => x === a.v[i])) {
      const t = (this.game.world.frame - a.frame) * dt;
      const pred = { x: a.p.x + v[0] * t, y: a.p.y + v[1] * t, z: a.p.z + v[2] * t, rot: a.p.rot + v[3] * t, ry: a.p.ry + v[4] * t };
      if (Math.abs(e.x - pred.x) <= eps && Math.abs(e.y - pred.y) <= eps && Math.abs((e.z ?? 0) - pred.z) <= eps &&
          Math.abs(e.rot - pred.rot) <= 0.02 && Math.abs((e.ry ?? 0) - pred.ry) <= 0.02) return a;
    }
    a = { frame: this.game.world.frame, v, p: { x: e.x, y: e.y, z: e.z ?? 0, rot: e.rot, ry: e.ry ?? 0 }, at: { x: e.x, y: e.y, rot: e.rot } };
    if (e.z !== undefined) a.at.z = e.z;
    if (e.ry !== undefined) a.at.ry = e.ry;
    this.anchors.set(e, a);
    return a;
  }

  snapshotFor(client, grid, full) {
    const w = this.game.world, me = w.get(client.entity);
    if (!me) return;
    const R = this.mp.interest, [mx, my] = this.coord(me);
    const cx = Math.floor(mx / R), cy = Math.floor(my / R);
    const visible = new Map();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const e of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        const [x, y] = this.coord(e);
        if ((x - mx) * (x - mx) + (y - my) * (y - my) <= R * R) visible.set(e.id, e);
      }
    }
    visible.set(me.id, me);
    // Each entity's change since the previous tick is the same for every client that saw it then,
    // so deltas are computed and serialized once per entity per tick and shared as JSON fragments.
    const add = [], upd = [], del = [], gone = [];
    for (const [id, e] of visible) {
      const own = e === me, rec = this.record(e, own), prev = client.known.get(id);
      client.known.set(id, rec);
      if (!prev || full) { add.push(JSON.stringify(this.encode(e, own, false))); continue; } // exact current position
      if (prev.sig === rec.sig) continue;
      const shared = !own && prev === this.prevRecords?.get(e);
      const d = shared ? (rec.delta ??= diff(prev, rec, id)) : diff(prev, rec, id);
      if (d.upd) upd.push(d.upd);
      if (d.del) del.push(d.del);
    }
    for (const id of client.known.keys()) if (!visible.has(id)) { gone.push(id); client.known.delete(id); }
    let state = '';
    for (const k in w.state) {
      if (k === 'dialogue') continue;
      const v = JSON.stringify(w.state[k]);
      if (client.state.get(k) !== v || full) { state += (state ? ',' : '') + JSON.stringify(k) + ':' + v; client.state.set(k, v); }
    }
    if (!add.length && !upd.length && !del.length && !gone.length && !state) return;
    let text = `{"t":"snap","tick":${this.tick},"frame":${w.frame}`;
    if (add.length) text += `,"add":[${add.join(',')}]`;
    if (upd.length) text += `,"upd":[${upd.join(',')}]`;
    if (del.length) text += `,"del":[${del.join(',')}]`;
    if (gone.length) text += `,"gone":${JSON.stringify(gone)}`;
    if (state) text += `,"state":{${state}}`;
    this.stats.lastSnapshotBytes = this.sendText(client, text + '}');
  }

  sendText(client, text) {
    client.conn.send(text);
    this.stats.bytesOut += text.length; this.stats.messagesOut++;
    return text.length;
  }

  sendTo(client, msg) {
    const text = JSON.stringify(msg);
    client.conn.send(text);
    this.stats.bytesOut += text.length; this.stats.messagesOut++;
    return text.length;
  }
}


/** In-memory duplex pipe: returns [serverSide, clientSide] connections (tests, bots, local co-op). */
export function pipe() {
  const mk = () => { const l = { message: [], close: [] }; return { l, on: (ev, fn) => l[ev].push(fn) }; };
  const a = mk(), b = mk();
  let open = true;
  a.send = (t) => { if (open) queueMicrotask(() => b.l.message.forEach((f) => f(t))); };
  b.send = (t) => { if (open) queueMicrotask(() => a.l.message.forEach((f) => f(t))); };
  a.close = b.close = () => { if (!open) return; open = false; a.l.close.forEach((f) => f()); b.l.close.forEach((f) => f()); };
  return [a, b];
}

/** Cheap structural snapshot of an entity: primitives as-is, objects copied one level deep. */
function snapshotOf(e) {
  const snap = {};
  for (const k in e) {
    const v = e[k];
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) snap[k] = v.slice();
      else { const o = {}; for (const kk in v) { const x = v[kk]; o[kk] = x !== null && typeof x === 'object' ? JSON.stringify(x) : x; } snap[k] = o; }
    } else snap[k] = v;
  }
  return snap;
}

function unchanged(e, snap) {
  let n = 0;
  for (const k in e) {
    n++;
    const v = e[k], p = snap[k];
    if (v === p) continue;
    if (v === null || typeof v !== 'object' || p === undefined || p === null || typeof p !== 'object') return false;
    if (Array.isArray(v)) { if (!Array.isArray(p) || p.length !== v.length) return false; for (let i = 0; i < v.length; i++) if (v[i] !== p[i]) return false; continue; }
    let m = 0;
    for (const kk in v) {
      m++;
      const x = v[kk];
      if (x !== null && typeof x === 'object') { if (JSON.stringify(x) !== p[kk]) return false; } else if (x !== p[kk]) return false;
    }
    if (m !== Object.keys(p).length) return false;
  }
  return n === Object.keys(snap).length;
}

/** Field-level delta between two records of one entity, as JSON fragments. */
function diff(prev, rec, id) {
  let upd = '', n = 0;
  for (const k in rec.fields) if (prev.fields[k] !== rec.fields[k]) { upd += ',' + JSON.stringify(k) + ':' + JSON.stringify(rec.enc[k]); n++; }
  const removed = [];
  for (const k in prev.fields) if (!(k in rec.fields)) removed.push(k);
  return { upd: n ? `{"id":${JSON.stringify(id)}${upd}}` : null, del: removed.length ? JSON.stringify([id, ...removed]) : null };
}

export { PRIVATE };
