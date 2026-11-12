// Single-file games ("cartridges"). One JSON document holds everything: vector art, the
// scene, which built-in systems run (in order), the game's rules, and its key bindings.
//
// {
//   "vertex": 1, "title": "Dodge",
//   "width": 400, "height": 300, "shapes": {...}, "entities": [...], "state": {...}, "sounds": {...},
//   "systems": ["rules", "motion", "wrap", "lifetime", { "collide": [["player", "rock"]] }],
//   "rules": [ { "each": "player", "when": "held('left')", "do": "self.x -= 200 * dt" }, ... ],
//   "keys": { "ArrowLeft": "left", "ArrowRight": "right" }
// }
//
// "rules" in `systems` marks where the rules run (once per step); if omitted, rules run first.
// Put it after collide so "hit" rules see this step's collisions.
// Because there is no host code, a cartridge is safe to load from anywhere (a URL, a chat
// message) and runs identically in every Vertex implementation (see SPEC.md).

import { Game } from './engine.js';
import * as systems from './systems.js';
import { collideOutline } from './collision.js';
import { compileRules } from './rules.js';
import * as animate from './animate.js';
import { physics } from './physics.js';
import { particles } from './particles.js';
import { follow } from './view.js';

const FACTORIES = {
  motion: () => systems.motion,
  wrap: () => systems.wrap,
  lifetime: () => systems.lifetime,
  collide: (pairs) => systems.collide(pairs),
  collideOutline: (pairs) => collideOutline(pairs),
  morph: () => animate.morphAnim,
  keyframes: () => animate.keyframes,
  physics: () => physics,
  particles: () => particles,
  follow: (arg) => (typeof arg === 'string' ? follow(arg) : follow(arg.id, arg.lerp ?? 1)),
};

export const CARTRIDGE_KEYS = ['vertex', 'title', 'systems', 'rules', 'keys', 'description'];

export const isCartridge = (doc) => !!doc && typeof doc === 'object' && (Array.isArray(doc.rules) || Array.isArray(doc.systems));

/** Build a Game from a cartridge document. */
export function loadCartridge(doc, opts = {}) {
  const scene = { ...doc };
  for (const k of CARTRIDGE_KEYS) delete scene[k];
  const game = new Game(scene, opts);
  const list = doc.systems ?? ['rules', 'motion', 'wrap', 'lifetime'];
  const rules = doc.rules?.length ? compileRules(doc.rules) : null;
  let placed = false;
  for (const item of list) {
    const [name, arg] = typeof item === 'string' ? [item, undefined] : Object.entries(item)[0];
    if (name === 'rules') {
      if (placed) throw new Error('cartridge: "rules" may appear only once in systems');
      if (rules) game.use(rules);
      placed = true; continue;
    }
    const make = FACTORIES[name];
    if (!make) throw new Error(`cartridge: unknown system "${name}" (known: rules, ${Object.keys(FACTORIES).join(', ')})`);
    game.use(make(arg));
  }
  if (rules && !placed) game.systems.unshift(rules);
  game.cartridge = { title: doc.title ?? 'Untitled', keys: doc.keys ?? {} };
  return game;
}

// ---- Games as links: cartridge <-> URL-safe string (deflate-raw + base64url) ----

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** Encode a cartridge as a compact URL-safe string. */
export async function encodeCartridge(doc) {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  return b64url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** Decode a string made by encodeCartridge. */
export async function decodeCartridge(str) {
  const bytes = await pipe(unb64url(str), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}
