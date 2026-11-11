import { World } from './world.js';
import { toSVG } from './render.js';

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

  emit(type, payload = {}) { this.events.push({ type, frame: this.world.frame, ...payload }); }

  press(action) { if (!this.input.has(action)) this.pressed.add(action); this.input.add(action); }
  release(action) { this.input.delete(action); }

  /** Advance n fixed steps. Returns events emitted during those steps. */
  step(n = 1) {
    const all = [];
    for (let i = 0; i < n; i++) {
      this.events = [];
      for (const s of this.systems) s(this, this.dt);
      this.world.time += this.dt;
      this.world.frame++;
      this.pressed.clear();
      all.push(...this.events);
    }
    return all;
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
