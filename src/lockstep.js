// Multiplayer by sharing inputs. Every peer runs the same deterministic simulation; peers
// exchange only their action changes, tagged with the frame they apply on (now + delay).
// A peer advances a frame only once it has every peer's input for that frame, so all peers
// compute identical worlds. Bandwidth is a few bytes per input change, not per entity.
//
// Actions are namespaced by player: local "fire" is pressed in the game as "p2:fire".
// Spectating is the same thing with no local input. Transports are pluggable:
//   memoryTransport()            — in-process (tests, local split-screen, bots)
//   broadcastTransport(name)     — browser tabs on one machine (BroadcastChannel)
//   any { send(msg), onMessage(fn) } — WebSocket, WebRTC data channel, relay server, ...

export class Lockstep {
  /**
   * @param {import('./engine.js').Game} game
   * @param {{ id: string, peers: string[], transport, delay?: number }} opts  peers includes id
   */
  constructor(game, { id, peers, transport, delay = 3 }) {
    this.game = game; this.id = id; this.peers = [...peers].sort(); this.transport = transport;
    this.delay = delay;
    this.frames = new Map();      // frame -> Map(peer -> [[kind, action], ...])
    this.pending = [];            // local changes not yet sent
    transport.onMessage((m) => this.receive(m));
    // Every peer pre-commits empty input for the first `delay` frames.
    for (let f = 0; f < delay; f++) for (const p of this.peers) this.slot(f).set(p, []);
  }

  slot(f) { let s = this.frames.get(f); if (!s) this.frames.set(f, (s = new Map())); return s; }

  press(action) { this.pending.push(['p', action]); }
  release(action) { this.pending.push(['r', action]); }

  receive({ from, frame, inputs }) { this.slot(frame).set(from, inputs); }

  /** Commit local input for frame (now + delay) and broadcast it. Call once per tick. */
  commit() {
    const frame = this.game.world.frame + this.delay;
    if (this.slot(frame).has(this.id)) return;
    const inputs = this.pending; this.pending = [];
    this.slot(frame).set(this.id, inputs);
    this.transport.send({ from: this.id, frame, inputs });
  }

  /** True if every peer's input for the current frame has arrived. */
  ready() {
    const s = this.frames.get(this.game.world.frame);
    return !!s && this.peers.every((p) => s.has(p));
  }

  /** Advance as far as inputs allow (at most `max` frames). Returns events. */
  advance(max = 1) {
    const evs = [];
    for (let i = 0; i < max && this.ready(); i++) {
      const f = this.game.world.frame, s = this.frames.get(f);
      for (const p of this.peers) {
        for (const [kind, action] of s.get(p)) {
          const a = `${p}:${action}`;
          if (kind === 'p') this.game.press(a); else this.game.release(a);
        }
      }
      this.frames.delete(f);
      evs.push(...this.game.step(1));
    }
    return evs;
  }

  /** One network tick: commit local input, then step if possible. */
  tick() { this.commit(); return this.advance(1); }
}

/** In-process transport hub: hub.connect() -> transport per peer. */
export function memoryTransport() {
  const listeners = [];
  const queue = [];
  return {
    connect() {
      let fn = () => {};
      const t = { send: (m) => queue.push([t, structuredClone(m)]), onMessage: (f) => { fn = f; listeners.push([t, (m) => fn(m)]); } };
      return t;
    },
    /** Deliver queued messages (simulates the network; call between ticks). */
    flush() {
      while (queue.length) {
        const [from, m] = queue.shift();
        for (const [t, fn] of listeners) if (t !== from) fn(m);
      }
    },
  };
}

/** Same-machine browser tabs. */
export function broadcastTransport(name = 'vertex') {
  const ch = new BroadcastChannel(name);
  return { send: (m) => ch.postMessage(m), onMessage: (fn) => { ch.onmessage = (e) => fn(e.data); } };
}

/** Helper for game code: is `action` held by `player`? (`held(game, 'p1', 'fire')`) */
export const held = (game, player, action) => game.input.has(`${player}:${action}`);
