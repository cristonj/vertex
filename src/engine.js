import { World } from './world.js';
import { toSVG } from './render.js';
import { toPNG } from './png.js';

/**
 * Game = World + systems + deterministic fixed-timestep loop.
 * The same Game runs in a browser (attach a renderer + input) or headless in Node
 * (an agent calls step(), sets input, and reads snapshot()/toSVG()).
 */
export class Game {
  constructor(doc, { fps = 60, seed = 1 } = {}) {
    this.world = doc instanceof World ? doc : new World(doc);
    this.dt = 1 / fps;
    this.systems = [];
    this.input = new Set();      // currently held actions, e.g. "left", "fire"
    this.pressed = new Set();    // actions pressed this step (edge-triggered)
    this.events = [];            // events emitted this step: { type, ...payload }
    this._seed = seed >>> 0 || 1;
    this._initialSeed = this._seed;
    this.pointer = { x: 0, y: 0 };
    this.axes = {};                 // analog inputs in [-1, 1], e.g. { x: 0.5, y: -1 }; recorded like keys  // world-space pointer; moved via point(), recorded like keys
    this._pendingScene = null; // recordings remember this, so replays rebuild the same game
  }

  /** Deterministic PRNG (xorshift32) so headless replays match exactly. */
  random() {
    let x = this._seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this._seed = x >>> 0;
    return this._seed / 4294967296;
  }

  /** Add a system: (game, dt) => void. Runs in insertion order each step. */
  use(system) { this.systems.push(system); return this; }

  /** Play a named sound from world.sounds (emits a "sound" event; attachAudio plays it). */
  sound(name, payload = {}) { this.emit('sound', { name, ...payload }); }

  emit(type, payload = {}) { this.events.push({ type, frame: this.world.frame, ...payload }); }

  /** Move the pointer (mouse/touch) to world coordinates. Press/release it as the "pointer" action. */
  point(x, y) { this.pointer.x = x; this.pointer.y = y; }

  /** Set an analog axis (stick, joystick, trigger) to a value in [-1, 1]. */
  axis(name, value) { if (value) this.axes[name] = value; else delete this.axes[name]; }

  /** Fire a `type` event `seconds` from now (stored in the world, so it survives save/rewind). */
  after(seconds, type, payload = {}) {
    this.world.timers.push({ at: this.world.time + seconds, type, ...payload });
  }

  /**
   * Switch to a named scene from world.scenes at the end of this step: entities are replaced,
   * `state` keys from the scene are merged in, camera replaced if given, `state.scene` set.
   */
  goto(name) {
    if (!this.world.scenes?.[name]) throw new Error(`unknown scene "${name}"`);
    this._pendingScene = name;
  }

  _applyScene(name) {
    const w = this.world, sc = w.scenes[name];
    for (const e of [...w.entities]) w.despawn(e);
    for (const e of sc.entities ?? []) w.spawn(e);
    if (sc.state) Object.assign(w.state, structuredClone(sc.state));
    if (sc.camera) w.camera = { zoom: 1, rot: 0, ...sc.camera };
    w.state.scene = name;
    // Delivered at the start of the next step (as an already-due timer), so rules see it.
    w.timers = [{ at: w.time, type: 'scene', name }];
  }

  press(action) { if (!this.input.has(action)) this.pressed.add(action); this.input.add(action); }
  release(action) { this.input.delete(action); }

  /** Advance n fixed steps. Returns events emitted during those steps. */
  step(n = 1) {
    const all = [];
    for (let i = 0; i < n; i++) {
      this.events = [];
      const w = this.world;
      if (w.timers.length) { // due timers fire first, in creation order
        const due = w.timers.filter((t) => t.at <= w.time + 1e-9);
        if (due.length) {
          w.timers = w.timers.filter((t) => t.at > w.time + 1e-9);
          for (const { at, ...ev } of due) this.emit(ev.type, ev);
        }
      }
      for (const s of this.systems) s(this, this.dt);
      if (this._pendingScene) { const n = this._pendingScene; this._pendingScene = null; this._applyScene(n); }
      this.world.time += this.dt;
      this.world.frame++;
      this.pressed.clear();
      all.push(...this.events);
    }
    return all;
  }

  /**
   * Full simulation state as plain JSON: world, clock, RNG and held input.
   * Restoring it with loadState() resumes bit-identically — as long as systems keep their
   * state in the world (world.state / entity.data), not in closures. That is the rule that
   * makes rewind, branching and checkpoints cheap.
   */
  saveState() {
    const w = this.world;
    return {
      world: structuredClone(w.toJSON()), frame: w.frame, time: w.time, nextId: w._nextId,
      seed: this._seed, input: [...this.input], pressed: [...this.pressed], pointer: { ...this.pointer }, axes: { ...this.axes },
    };
  }

  loadState(st) {
    const w = this.world.restore(structuredClone(st.world)); // in place: closures keep working
    w.frame = st.frame; w.time = st.time; w._nextId = st.nextId;
    this._seed = st.seed;
    this.input = new Set(st.input);
    this.pressed = new Set(st.pressed);
    this.pointer = { x: 0, y: 0, ...st.pointer };
    this.axes = { ...st.axes };
    return this;
  }

  /** Compact, JSON-safe view of the world — what an agent "observes". */
  snapshot() {
    const w = this.world;
    return {
      frame: w.frame, time: +w.time.toFixed(3), state: w.state,
      entities: w.entities.map((e) => ({
        id: e.id, shape: e.shape, tags: e.tags,
        x: +e.x.toFixed(1), y: +e.y.toFixed(1), rot: +e.rot.toFixed(2),
      })),
    };
  }

  toSVG(opts) { return toSVG(this.world, opts); }
  toPNG(opts) { return toPNG(this.world, opts); }

  /** Browser loop: requestAnimationFrame + accumulator. Returns a stop function. */
  run(renderer) {
    let acc = 0, last = performance.now(), raf = 0;
    const tick = (now) => {
      acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= this.dt) { this.step(1); acc -= this.dt; }
      renderer?.draw(this.world);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }
}
