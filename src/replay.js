// Input recordings. A seed plus an action log IS the whole game:
// replays are exact, a few hundred bytes, and renderable at any resolution.
// Format: { vertex: 1, scene, seed, fps, steps, digest, inputs: [[frame, "p"|"r", action], ...] }
// `inputs` is an ordered event list — only frames where held actions changed appear.
/** 64-bit non-cryptographic string hash (two 32-bit FNV-1a lanes), as 16 hex chars. */
export function hash64(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519) ^ (h1 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Short digest of the current frame. Same digest after a replay = the run was identical.
 *  Pure JS, so replays verify identically in Node and in the browser. */
export function digest(game) {
  return hash64(game.toSVG());
}

/**
 * Attach to a fresh game (before any step) to log every input change per frame.
 * Wraps game.press/release; game logic does not change.
 */
export class Recorder {
  constructor(game) {
    this.game = game;
    this.inputs = [];
    const press = game.press.bind(game);
    const release = game.release.bind(game);
    game.press = (a) => { if (!game.input.has(a)) this.inputs.push([game.world.frame, 'p', a]); press(a); };
    game.release = (a) => { if (game.input.has(a)) this.inputs.push([game.world.frame, 'r', a]); release(a); };
    const axis = game.axis.bind(game);
    game.axis = (name, v) => { if ((game.axes[name] ?? 0) !== (v || 0)) this.inputs.push([game.world.frame, 'a', name, v || 0]); axis(name, v); };
    const point = game.point.bind(game);
    game.point = (x, y) => {
      if (x !== game.pointer.x || y !== game.pointer.y) this.inputs.push([game.world.frame, 'm', x, y]);
      point(x, y);
    };
  }

  /** Serialize. Pass { scene: "path/to/scene.js" } so the recording names its scene. */
  toJSON(extra = {}) {
    return {
      vertex: 1,
      seed: this.game._initialSeed,
      fps: Math.round(1 / this.game.dt),
      steps: this.game.world.frame,
      digest: digest(this.game),
      inputs: this.inputs,
      ...extra,
    };
  }
}

/** Apply one logged input: [frame, "p"|"r", action], [frame, "m", x, y] (pointer) or [frame, "a", axis, value]. */
export function applyInput(game, inp) {
  if (inp[1] === 'p') game.press(inp[2]);
  else if (inp[1] === 'r') game.release(inp[2]);
  else if (inp[1] === 'm') game.point(inp[2], inp[3]);
  else if (inp[1] === 'a') game.axis(inp[2], inp[3]);
}

/** Drive a fresh game through a recording, frame by frame. Returns the game at the final frame. */
export function applyRecording(game, rec) {
  let i = 0;
  for (let f = 0; f < rec.steps; f++) {
    while (i < rec.inputs.length && rec.inputs[i][0] === f) {
      applyInput(game, rec.inputs[i++]);
    }
    game.step(1);
  }
  return game;
}

/** Throw unless a replayed game landed on exactly the recorded frame. */
export function verifyReplay(game, rec) {
  const d = digest(game);
  if (d !== rec.digest) {
    throw new Error(`Replay mismatch: frame digest ${d}, recording says ${rec.digest}`);
  }
  return true;
}
