/**
 * Map keyboard keys to named actions. Games read actions, never raw keys,
 * so an agent drives the exact same interface via game.press()/release().
 * @param {import('./engine.js').Game} game
 * @param {Record<string,string>} map e.g. { ArrowLeft: "left", " ": "fire" }
 */
export function bindKeys(game, map, target = globalThis) {
  const down = (ev) => { const a = map[ev.key]; if (a) { game.press(a); ev.preventDefault(); } };
  const up = (ev) => { const a = map[ev.key]; if (a) game.release(a); };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => { target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); };
}
