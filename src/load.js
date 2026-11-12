// Scene loading. A "scene module" is a JS file exporting createGame(opts) — behavior included —
// or a bare module export `scene` (a plain document; built-in systems are attached by name).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Game } from './engine.js';
import * as systems from './systems.js';
import { isCartridge, loadCartridge } from './cartridge.js';

/** Load a scene module by path (or pass through an already-loaded module object). */
export async function loadSceneModule(spec) {
  if ((typeof spec === 'string' && spec.endsWith('.json'))) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(resolve(spec), 'utf8'));
  }
  if (typeof spec === 'string' || spec instanceof URL) {
    const url = spec instanceof URL ? spec : pathToFileURL(resolve(String(spec)));
    return import(url.href);
  }
  return spec;
}

/** Build a Game from a scene module or a plain document. */
export function createFrom(mod, opts = {}) {
  if (typeof mod?.createGame === 'function') return mod.createGame(opts);
  const doc = mod?.scene ?? mod?.default ?? mod;
  if (isCartridge(doc)) return loadCartridge(doc, opts);
  const game = new Game(doc, opts);
  for (const name of opts.use ?? ['motion', 'wrap', 'lifetime']) {
    const sys = systems[name];
    if (!sys) throw new Error(`Unknown built-in system: "${name}"`);
    game.use(sys);
  }
  return game;
}
