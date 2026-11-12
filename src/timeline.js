// Time travel. A Timeline wraps a live game, logs its inputs, and keeps periodic checkpoints
// (saveState snapshots). That gives you, for free from determinism:
//   seek(frame)   rewind / fast-forward to any frame (nearest checkpoint + re-simulation)
//   branch(frame) fork an alternate future that shares the past
//   toRecording() the whole run as a replay file
//
// Requirement (the one rule): systems keep their state in the world (world.state,
// entity.data), not in closures. If a game breaks the rule, pass { checkpoints: false }
// and every seek re-simulates from frame 0 with a fresh game from `factory` — slower, always right.

import { digest } from './replay.js';

export class Timeline {
  /**
   * @param {(opts) => import('./engine.js').Game} factory  builds a fresh game (createGame)
   * @param {{ seed?: number, fps?: number, every?: number, checkpoints?: boolean, keep?: number }} opts
   */
  constructor(factory, { seed = 1, fps = 60, every = 60, checkpoints = true, keep = 600 } = {}) {
    this.factory = factory;
    this.opts = { seed, fps };
    this.every = every;
    this.useCheckpoints = checkpoints;
    this.keep = keep;
    this.game = factory({ seed, fps });
    this.inputs = [];                 // [frame, 'p'|'r', action], ordered
    this.checkpoints = new Map();     // frame -> saveState()
    this.head = 0;                    // furthest frame simulated on this branch
    if (checkpoints) this.checkpoints.set(0, this.game.saveState());
  }

  get frame() { return this.game.world.frame; }

  /** Input that also truncates the future (acting in the past starts a new timeline). */
  press(action) { this._truncate(); if (!this.game.input.has(action)) this.inputs.push([this.frame, 'p', action]); this.game.press(action); }
  release(action) { this._truncate(); if (this.game.input.has(action)) this.inputs.push([this.frame, 'r', action]); this.game.release(action); }

  _truncate() {
    if (this.frame >= this.head) return;
    const f = this.frame;
    this.inputs = this.inputs.filter((i) => i[0] < f);
    for (const k of this.checkpoints.keys()) if (k > f) this.checkpoints.delete(k);
    this.head = f;
  }

  /** Step forward on the current branch, replaying any logged inputs we pass over. */
  step(n = 1) {
    const evs = [];
    for (let i = 0; i < n; i++) {
      const f = this.frame;
      if (f < this.head) this._applyInputsAt(f);
      evs.push(...this.game.step(1));
      if (this.frame > this.head) this.head = this.frame;
      if (this.useCheckpoints && this.frame % this.every === 0 && !this.checkpoints.has(this.frame)) {
        this.checkpoints.set(this.frame, this.game.saveState());
        if (this.checkpoints.size > this.keep) this.checkpoints.delete(this.checkpoints.keys().next().value);
      }
    }
    return evs;
  }

  _applyInputsAt(f) {
    for (const [fr, kind, action] of this.inputs) {
      if (fr !== f) continue;
      if (kind === 'p') this.game.press(action); else this.game.release(action);
    }
  }

  /** Jump to any frame in [0, head]. Uses the nearest checkpoint at or before it. */
  seek(target) {
    target = Math.max(0, Math.min(this.head, Math.round(target)));
    if (this.useCheckpoints) {
      let best = 0;
      for (const k of this.checkpoints.keys()) if (k <= target && k > best) best = k;
      if (!(this.frame <= target && this.frame >= best)) this.game.loadState(this.checkpoints.get(best) ?? this.checkpoints.get(0));
    } else if (this.frame > target) {
      this.game = this.factory(this.opts);
    }
    const head = this.head;
    while (this.frame < target) {
      this._applyInputsAt(this.frame);
      this.game.step(1);
    }
    this.head = head;
    return this;
  }

  rewind(frames = 60) { return this.seek(this.frame - frames); }

  /** A new Timeline that shares history up to `frame` (default: now), then diverges. */
  branch(frame = this.frame) {
    const t = new Timeline(this.factory, { ...this.opts, every: this.every, checkpoints: this.useCheckpoints, keep: this.keep });
    t.inputs = this.inputs.filter((i) => i[0] < frame);
    for (const [k, v] of this.checkpoints) if (k <= frame) t.checkpoints.set(k, v);
    t.head = Math.min(frame, this.head);
    t.seek(frame);
    return t;
  }

  /** Export the current branch (up to head) as a standard recording file. */
  toRecording(extra = {}) {
    const here = this.frame;
    this.seek(this.head);
    const rec = {
      vertex: 1, seed: this.opts.seed, fps: this.opts.fps, steps: this.head,
      digest: digest(this.game), inputs: this.inputs.slice(), ...extra,
    };
    this.seek(here);
    return rec;
  }
}

/** Frame-by-frame comparison of two recordings' outcomes: first frame where snapshots differ. */
export function divergence(factory, recA, recB) {
  const a = factory({ seed: recA.seed, fps: recA.fps }), b = factory({ seed: recB.seed, fps: recB.fps });
  const ia = [...recA.inputs], ib = [...recB.inputs];
  const steps = Math.min(recA.steps, recB.steps);
  const apply = (g, list, f) => { while (list.length && list[0][0] === f) { const [, k, act] = list.shift(); if (k === 'p') g.press(act); else g.release(act); } };
  for (let f = 0; f < steps; f++) {
    apply(a, ia, f); apply(b, ib, f);
    a.step(1); b.step(1);
    if (JSON.stringify(a.snapshot()) !== JSON.stringify(b.snapshot())) return f + 1;
  }
  return null;
}
