# AGENTS.md — Using Vertex as an AI agent

You are a first-class user of this engine. Everything you need is text.

## Building a game
1. Write a scene object: `shapes` (SVG path `d` strings, centered on 0,0, facing +x) and `entities`.
2. Add behavior as systems: `game.use((game, dt) => { ... })`. Read `game.input` (held actions),
   `game.pressed` (this step only), `game.events` (emitted this step), mutate `game.world`.
3. Use built-ins from `systems`: `motion`, `wrap`, `lifetime` (`data.ttl`), `collide([[tagA, tagB]])`.
4. Use `game.random()` — never `Math.random()` — so runs stay deterministic.
5. Scenes are validated on construction against `schema/scene.schema.json`. A bad scene fails
   with the exact path (e.g. `entities[3].shape: unknown shape "rock"`) — fix that and retry.

A scene module exports `createGame(opts)` returning a configured `Game`. That one function is
the whole contract for the CLI, MCP, and tests.

## The fastest path: write a cartridge (one JSON file, no JS)
A cartridge is a scene plus `systems`, `rules` and `keys` (see SPEC.md §2.2, §6 and
`examples/starfall/starfall.json`). Rules are a small sandboxed language:
```json
{ "each": "player", "when": "held('left')", "do": "self.x = max(20, self.x - 200 * dt)" }
{ "on": "hit", "tags": ["player", "coin"], "do": "despawn(b); state.score += 1; sound('ding')" }
{ "on": "start", "do": "spawn('coin', {x: rand(0, W), y: 40, tags: ['coin']})" }
```
Put `"rules"` after `collide` in `systems` so hit rules see this step's collisions. Errors name
the rule index and the problem. Test it with `node bin/vertex.js run game.json --steps 600 --svg f.svg`,
share it with `node bin/vertex.js link game.json`.

Keep cross-implementation determinism in mind (SPEC.md §8): `+ - * / sqrt floor` are exact
everywhere; `sin/cos/atan2`, `drag` and arcs are only "visually identical" across runtimes.

## Play-testing headless (Node, no browser)
```js
const game = createMyGame({ seed: 1 });
game.press('thrust');
const events = game.step(120);        // advance 2s at 60fps
game.snapshot();                      // compact JSON: entities, positions, state
game.toSVG();                         // full frame as SVG text — read it, diff it
game.toPNG({ width: 400 });           // PNG buffer for multimodal screenshots
```
See `examples/drift/agent-play.js` for a full observe → decide → act loop, and
`examples/drift/policy.js` for the policy shape: `(game) => void` that presses/releases actions.

## CLI (no code required)
```bash
node bin/vertex.js run examples/drift/drift.js --seed 42 --steps 600 \
  --policy examples/drift/policy.js --record run.json --svg frame.svg --png frame.png
node bin/vertex.js play run.json        # verify a replay reproduces exactly (exit 1 if not)
node bin/vertex.js schema               # the scene JSON Schema
```

## Recordings (bug reports that always reproduce)
```js
const rec = new Recorder(game);   // attach to a FRESH game, before stepping
// ...run...
const doc = rec.toJSON({ scene: 'examples/drift/drift.js' });  // seed + input log + digest
```
Replay with `applyRecording(freshGame, doc)` and check with `verifyReplay`. The input log is
ordered events `[frame, "p"|"r", action]` and replays byte-identically for the same seed.
Send the whole JSON file as a bug report.

## Time travel
`new Timeline(createGame, { seed })` logs inputs and checkpoints: `seek(frame)`, `rewind(n)`,
`branch(frame)`, `toRecording()`. `vertex play run.json --at 120 --svg f.svg` renders any frame;
`vertex diff a.json b.json` finds the first divergent frame. For checkpoints to be valid, keep
system state in `world.state` / `entity.data`, never in closures.

## MCP server
`node bin/vertex.js mcp` serves tools `load, step, observe, view, screenshot, edit, reset`
over stdio. Session-scoped: `load` a scene (module path or inline JSON), then drive it.
`edit` ops mutate the live world: `spawn`, `despawn` (by id/tag), `set` (by id/tag + fields),
`state` (set keys on `world.state`).

## Conventions
- Shapes: origin = pivot/center. Rotation 0 faces +x. Keep paths small; prefer `M/L/Q/C/Z`.
- Tags drive systems (`wrap`, `rock`, `bullet`). Put game-specific numbers in `entity.data`.
- `world.state` is for game-level values; `state.hud` is drawn as text by both renderers
  (the PNG rasterizer skips text).
- Keep the core dependency-free. Run `node --test` before committing.
