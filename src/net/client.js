// Multiplayer client (browser or Node). Mirrors the server's world from snapshots, smooths
// motion by interpolating between snapshots, sends input, and draws its own player's dialogue
// and interaction prompt locally. Has press/release/point/axis, so bindKeys, bindPointer,
// bindGamepad and touchControls drive it directly.
//
//   const client = await NetClient.connect('wss://host/ws', { name: 'ada' })
//   bindKeys(client, keys); renderer.draw(client.frame(dt))

import { Game } from '../engine.js';
import { dialogueUI, promptUI } from '../dialogue.js';
import { particles } from '../particles.js';

const SMOOTH = ['x', 'y', 'z', 'rot', 'rx', 'ry', 'rz', 'scale'];

export class NetClient {
  /** `socket`: { send(text), and either on('message', fn) or onmessage }. */
  constructor(socket) {
    this.socket = socket;
    this.game = null; this.world = null;
    this.id = null; this.entityId = null;
    this.pending = { p: new Set(), r: new Set(), m: null, a: {} };
    this.held = new Set();
    this.pointer = { x: 0, y: 0 };
    this.anim = new Map();          // id -> { from: {}, to: {}, t }
    this.snapInterval = 0.05;
    this.stats = { snapshots: 0, bytesIn: 0 };
    this.ready = new Promise((res, rej) => { this._ready = res; this._fail = rej; });
    this.listeners = [];
    const onMsg = (raw) => this.onMessage(typeof raw === 'string' ? raw : raw.data ?? String(raw));
    if (socket.on) socket.on('message', onMsg); else socket.onmessage = onMsg;
  }

  /** Connect with the native WebSocket (browsers, Node 22+), or pass a Node fallback `connect`. */
  static async connect(url, { name = null, connect = null } = {}) {
    let socket;
    if (connect) socket = await connect(url);
    else {
      socket = new WebSocket(url);
      await new Promise((res, rej) => { socket.onopen = res; socket.onerror = () => rej(new Error(`cannot connect to ${url}`)); });
    }
    const c = new NetClient(socket);
    c.hello(name);
    await c.ready;
    return c;
  }

  hello(name) { this.send({ t: 'hello', name }); }
  send(m) { this.socket.send(JSON.stringify(m)); }
  onEvent(fn) { this.listeners.push(fn); }

  onMessage(text) {
    this.stats.bytesIn += text.length;
    const m = JSON.parse(text);
    if (m.t === 'welcome') {
      this.id = m.id; this.entityId = m.entity;
      this.snapInterval = 1 / (m.sendRate ?? 20);
      this.game = new Game({ ...m.scene, entities: [], state: {} }, { fps: m.fps });
      this.world = this.game.world;
      this._ready(this);
    } else if (m.t === 'snap') this.apply(m);
    else if (m.t === 'error') { this._fail?.(new Error(m.message)); this.listeners.forEach((f) => f(m)); }
  }

  apply(m) {
    const w = this.world;
    this.stats.snapshots++;
    for (const e of m.add ?? []) {
      w.get(e.id) && w.despawn(e.id);
      w.spawn(e);
      this.anim.delete(e.id);
    }
    for (const u of m.upd ?? []) {
      const e = w.get(u.id);
      if (!e) continue;
      const a = this.anim.get(u.id) ?? { from: {}, to: {}, t: 1 };
      let moved = false;
      for (const k in u) {
        if (k === 'id') continue;
        // dead-reckoned movers snap to the new anchor (they keep integrating); others interpolate
        const v = k === 'x' ? e.vx : k === 'y' ? e.vy : k === 'z' ? e.vz : k === 'rot' ? e.vr : k === 'ry' ? e.vry : 0;
        if (SMOOTH.includes(k) && !v && !u['v' + k] && typeof u[k] === 'number' && typeof e[k] === 'number') { a.from[k] = e[k]; a.to[k] = u[k]; moved = true; }
        else e[k] = u[k];
      }
      if (moved) { a.t = 0; this.anim.set(u.id, a); }
    }
    for (const [id, ...keys] of m.del ?? []) { const e = w.get(id); if (e) for (const k of keys) delete e[k]; }
    for (const id of m.gone ?? []) { w.despawn(id); this.anim.delete(id); }
    if (m.state) Object.assign(w.state, m.state);
    w.frame = m.frame ?? w.frame;
  }

  /** The local player's entity (as last received). */
  get me() { return this.world?.get(this.entityId) ?? null; }

  /** Advance interpolation by dt seconds, refresh local UI, flush input. Returns the world to draw. */
  frame(dt = 1 / 60) {
    if (!this.world) return null;
    // dead reckoning: integrate velocities locally between snapshots (and move local particles)
    for (const e of this.world.entities) {
      if (e.fixed) continue;
      if (e.vx) e.x += e.vx * dt; if (e.vy) e.y += e.vy * dt; if (e.vz) e.z = (e.z ?? 0) + e.vz * dt;
      if (e.vr) e.rot += e.vr * dt; if (e.vry) e.ry = (e.ry ?? 0) + e.vry * dt;
      if (e.data?.particle) { e.data.ttl -= dt; if (e.data.ttl <= 0) this.world.despawn(e); }
    }
    particles(this.game, dt);
    for (const [id, a] of this.anim) {
      const e = this.world.get(id);
      if (!e) { this.anim.delete(id); continue; }
      a.t = Math.min(1, a.t + dt / this.snapInterval);
      for (const k in a.to) e[k] = a.from[k] + (a.to[k] - a.from[k]) * a.t;
      if (a.t >= 1) this.anim.delete(id);
    }
    const me = this.me;
    if (me && this.world.camera && this.world.multiplayer?.follow !== false) { this.world.camera.x = me.x; this.world.camera.y = me.y; }
    if (me) { dialogueUI(this.game, me.data?.dialogue ? me : null); promptUI(this.game, me); }
    this.flush();
    return this.world;
  }

  // ---- input (Controllable) ----
  press(a) { if (this.held.has(a)) return; this.held.add(a); this.pending.p.add(a); this.pending.r.delete(a); }
  release(a) { if (!this.held.has(a)) return; this.held.delete(a); this.pending.r.add(a); this.pending.p.delete(a); }
  point(x, y) { this.pointer = { x, y }; this.pending.m = [x, y]; }
  axis(name, v) { this.pending.a[name] = v; }

  flush() {
    const p = this.pending;
    if (!p.p.size && !p.r.size && !p.m && !Object.keys(p.a).length) return;
    const msg = { t: 'in' };
    if (p.p.size) msg.p = [...p.p]; if (p.r.size) msg.r = [...p.r]; if (p.m) msg.m = p.m; if (Object.keys(p.a).length) msg.a = p.a;
    this.send(msg);
    this.pending = { p: new Set(), r: new Set(), m: null, a: {} };
  }
}
