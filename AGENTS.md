# AGENTS.md — Using Vertex as an AI agent

You are a first-class user of this engine. Everything you need is text.

## Building a game
1. Write a scene object: `shapes` (SVG path `d` strings, centered on 0,0, facing +x) and `entities`.
2. Add behavior as systems: `game.use((game, dt) => { ... })`. Read `game.input` (held actions),
   `game.pressed` (this step only), `game.events` (emitted this step), mutate `game.world`.
3. Use built-ins from `systems`: `motion`, `wrap`, `lifetime` (`data.ttl`), `collide([[tagA, tagB]])`.
4. Use `game.random()` — never `Math.random()` — so runs stay deterministic.

## Play-testing headless (Node, no browser)
```js
const game = createMyGame({ seed: 1 });
game.press('thrust');
const events = game.step(120);        // advance 2s at 60fps
game.snapshot();                      // compact JSON: entities, positions, state
game.toSVG();                         // full frame as SVG text — read it, or rasterize it
```
See `examples/drift/agent-play.js` for a full observe → decide → act loop.

## Conventions
- Shapes: origin = pivot/center. Rotation 0 faces +x. Keep paths small; prefer `M/L/Q/C/Z`.
- Tags drive systems (`wrap`, `rock`, `bullet`). Put game-specific numbers in `entity.data`.
- `world.state` is for game-level values; `state.hud` is drawn as text by both renderers.
- Keep the core dependency-free. Run `npm test` before committing.
