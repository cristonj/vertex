# Vertex

**A vector-native, agent-first game engine.** Every asset is an SVG path. Every scene is JSON.
Every run is a tiny replay file. Humans and AI agents drive it through the same API.

- 🪶 **Tiny** — zero dependencies, ~45 KB of readable source. Sprites are tens of bytes, not kilobytes.
- 📐 **Infinite resolution** — vector art renders crisp at any size or DPI.
- 🤖 **Agent-first** — run headless, step the sim, read JSON snapshots, render frames as SVG text.
- 🎯 **Deterministic** — fixed timestep + seeded RNG. Same seed + inputs = same game, every time.
- ⏱️ **Time is data** — record a run to a few KB of JSON; replay it exactly, at any resolution.

See [VISION.md](VISION.md) for the why and the roadmap. Agents: start with [AGENTS.md](AGENTS.md).

## Quick start

```bash
git clone https://github.com/cristonj/vertex && cd vertex
node --test                    # run the engine tests
npm run play:agent             # an AI-style policy plays Drift headless, records drift-run.json, verifies the replay
npm run replay -- --png frame.png   # replay that recording through the CLI, rasterize to PNG
npm run serve                  # then open http://localhost:3000/examples/drift/
```

## A whole game in one object

```js
import { Game, CanvasRenderer, bindKeys, systems } from 'vertex-engine';

const game = new Game({
  width: 800, height: 600, background: '#111',
  shapes: {
    ship: { d: 'M14 0 L-10 -9 L-5 0 L-10 9 Z', stroke: '#7df9ff', width: 2 },
  },
  entities: [{ id: 'ship', shape: 'ship', x: 400, y: 300, vr: 1, tags: ['wrap'] }],
});

game.use(systems.motion).use(systems.wrap);
game.run(new CanvasRenderer(document.querySelector('canvas')));  // browser
// or headless:  game.step(60); console.log(game.snapshot(), game.toSVG(), game.toPNG());
```

## Core concepts

| Concept    | What it is |
|------------|------------|
| **Shape**  | `{ d, fill?, stroke?, width? }` or `{ parts: [...] }` — raw SVG path data, parsed once. |
| **Entity** | `{ id, shape, x, y, rot, scale, vx, vy, vr, tags, data }` — plain data. |
| **World**  | Shapes + entities + `state`. Round-trips via `toJSON()`. Validated on construction. |
| **System** | `(game, dt) => void`. Runs every fixed step, in order. |
| **Action** | Named input (`"fire"`). Keyboard binds to actions; agents call `game.press()`. |
| **Event**  | `game.emit(type, payload)`; `game.step()` returns the events that fired. |
| **Recording** | `{ vertex: 1, seed, inputs: [[frame, "p"\|"r", action], ...] }` — a whole play session. |

## The CLI

```bash
node bin/vertex.js run examples/drift/drift.js --seed 42 --steps 600 \
  --policy examples/drift/policy.js --svg frame.svg --png frame.png --record run.json
node bin/vertex.js play run.json --png replay.png   # replays exactly, exit 1 if it doesn't
node bin/vertex.js schema                           # JSON Schema for scene documents
node bin/vertex.js mcp                              # serve the MCP server on stdio
```

`run` executes a scene headless. A *policy* module (default export: `policy(game)`) drives the
named actions just like a human — that's all an agent needs to playtest. `--record` captures the
entire run (seed + input log + final-frame digest) as a JSON file you can commit, diff, or send
as a bug report.

## Recordings: the game IS the log

```js
import { Recorder, applyRecording, verifyReplay } from 'vertex-engine';

const rec = new Recorder(createGame({ seed: 42 }));   // attach before stepping
play/recording loop...
const doc = rec.toJSON({ scene: 'examples/drift/drift.js' });

const g2 = createGame({ seed: doc.seed, fps: doc.fps });  // replay, anywhere, later
applyRecording(g2, doc);
verifyReplay(g2, doc);        // throws unless the final frame is byte-identical
```

Ten seconds of Drift is ~5 KB of input log — smaller than one raster frame — and it replays
exactly. Rewind, scrub, branch, diff two strategies, or attach the file to a bug report:
seed + inputs + digest always reproduce.

## Screenshots without a browser

`game.toPNG({ width, height })` rasterizes the vector world to a PNG buffer in pure JS
(`node:zlib` is the only dependency). Agents get real screenshots for multimodal models;
humans get previews; nothing native is required. Coordinates match `toSVG` exactly, at any
resolution — render the same frame at 64×48 or 4K.

## MCP: play Vertex games from Claude

Vertex ships a zero-dependency [Model Context Protocol](https://modelcontextprotocol.io) server
so any MCP client can drive the engine: `load → step → observe → view/screenshot → edit → reset`.

```jsonc
// claude_desktop_config.json
{ "mcpServers": { "vertex": { "command": "node", "args": ["/path/to/vertex/bin/vertex.js", "mcp"] } } }
```

Tools take/return plain JSON and SVG text. `observe` is a compact entity snapshot (see without
vision); `view` is the frame as SVG; `screenshot` returns a PNG; `edit` rewrites the live world
(spawn/despawn/set/state) while the game runs; `reset` rebuilds with a seed.

## Scene schema

[schema/scene.schema.json](schema/scene.schema.json) formally describes the format — use it to
drive code generators and editors. The engine validates every scene at construction with
agent-friendly errors (`src/validate.js`): a bad scene fails fast with the exact path to fix.

## License

MIT
