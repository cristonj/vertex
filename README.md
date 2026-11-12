# Vertex

**A vector-native, agent-first game format and engine.** Every asset is an SVG path. Every scene
is JSON. Game logic is a tiny sandboxed rules language. Every run is a replay file a few KB long.
A complete game fits in a link. Humans and AI agents drive it through the same API.

- 🪶 **Tiny**: zero dependencies. A whole game (art, scene, rules) is ~2 KB of JSON, or a ~1.4 KB link.
- 📐 **Infinite resolution**: vector art is crisp at any size, rendered by WebGL2, Canvas2D, SVG or PNG.
- 🤖 **Agent-first**: run headless, step the sim, read JSON snapshots, read frames as SVG text, drive it over MCP.
- 🎯 **Deterministic**: fixed timestep + seeded RNG. Same seed + inputs = same frame, byte for byte.
- ⏱️ **Time is data**: rewind, scrub, branch, diff runs; multiplayer by exchanging inputs only.
- 📜 **A format, not just an engine**: [SPEC.md](SPEC.md) + a conformance suite. A second implementation
  in Python reproduces every frame digest bit-for-bit.

[VISION.md](VISION.md) covers the why and the roadmap. Agents: start with [AGENTS.md](AGENTS.md).

## Quick start

```bash
git clone https://github.com/cristonj/vertex && cd vertex
node --test                                         # engine tests (Node 18.3+)
node bin/vertex.js run examples/starfall/starfall.json --steps 600 --svg frame.svg
python py/vertex.py conform                         # the Python runtime passes the conformance suite
npm run serve                                       # then open http://localhost:3000/play.html
```

Play in the browser: **[play.html](https://cristonj.github.io/vertex/play.html)** (Starfall),
or **[Drift](https://cristonj.github.io/vertex/examples/drift/)**. Hold **R** to rewind time.

## A complete game is one JSON document

```json
{
  "vertex": 1, "title": "Tiny", "width": 320, "height": 240,
  "shapes": { "ship": { "d": "M10 0 L-8 -6 L-4 0 L-8 6 Z", "stroke": "#7df9ff", "width": 2 } },
  "entities": [{ "id": "ship", "shape": "ship", "x": 160, "y": 120, "tags": ["ship", "wrap"] }],
  "keys": { "ArrowLeft": "left", "ArrowRight": "right", "ArrowUp": "go" },
  "systems": ["rules", "motion", "wrap"],
  "rules": [
    { "each": "ship", "when": "held('left')",  "do": "self.rot -= 4 * dt" },
    { "each": "ship", "when": "held('right')", "do": "self.rot += 4 * dt" },
    { "each": "ship", "when": "held('go')",    "do": "self.vx += cos(self.rot) * 200 * dt; self.vy += sin(self.rot) * 200 * dt" }
  ]
}
```

That is a cartridge: art + scene + rules + key bindings, with no host code, so it's safe to load
from anywhere. `vertex link game.json` turns it into a URL that contains the whole game.
See [examples/starfall/starfall.json](examples/starfall/starfall.json) for a full game in ~60 lines.

## Or write JS

```js
import { Game, systems, collideOutline, autoRenderer } from 'vertex-engine';

const game = new Game({ shapes: { ship: { d: 'M14 0 L-10 -9 L-5 0 L-10 9 Z', stroke: '#7df9ff', width: 2 } },
                        entities: [{ id: 'ship', shape: 'ship', x: 400, y: 300, vr: 1, tags: ['wrap'] }] });
game.use(systems.motion).use(systems.wrap).use(collideOutline([['bullet', 'rock']]));
game.run(await autoRenderer(canvas));       // browser: WebGL2, falling back to Canvas2D
// headless: game.step(60); game.snapshot(); game.toSVG(); game.toPNG({ width: 400 });
```

## What's inside

| Area | Module | Highlights |
|---|---|---|
| Geometry | `path.js`, `procedural.js`, `text.js` | Full SVG path parser incl. arcs, flattening, bounds; procedural shapes; built-in stroke font |
| World + sim | `world.js`, `engine.js`, `systems.js` | JSON world, deterministic fixed step, seeded RNG, events, O(1) lookup, save/load state |
| Logic | `rules.js`, `cartridge.js` | Sandboxed rules language; single-file cartridges; games as links |
| Collision | `collision.js`, `spatial.js` | Exact outline collision (the art is the hitbox); spatial-hash broadphase with deterministic order |
| Rendering | `render.js`, `webgl.js`, `png.js`, `view.js`, `tess.js` | Canonical SVG frame, Canvas2D, WebGL2 (stencil-then-cover), pure-JS PNG; camera, layers, parallax, culling |
| Animation | `animate.js` | Path morphing, keyframes |
| Sound | `audio.js` | Synth-parameter sound effects, note-string music, WAV export, WebAudio playback |
| Time | `replay.js`, `timeline.js`, `lockstep.js` | Recordings, seek/rewind/branch, divergence, input-only multiplayer |
| Tooling | `cli.js`, `mcp/server.js` | `vertex run/play/diff/link/schema/mcp`; MCP server for Claude and other clients |
| Format | `SPEC.md`, `schema/`, `conformance/`, `py/` | Normative spec, JSON Schema, conformance suite, Python implementation |

## The CLI

```bash
vertex run <scene.js|cartridge.json> [--seed N] [--steps N] [--policy p.js] [--svg f] [--png f] [--record r.json]
vertex play <recording.json> [--at FRAME] [--svg f] [--png f] [--width W]   # replay exactly, or scrub
vertex diff <a.json> <b.json>                                               # first frame where two runs diverge
vertex link <cartridge.json>                                                # the whole game as a URL
vertex schema                                                               # JSON Schema for scenes
vertex mcp                                                                  # MCP server on stdio
```

## MCP: play Vertex games from Claude

```jsonc
// claude_desktop_config.json
{ "mcpServers": { "vertex": { "command": "node", "args": ["/path/to/vertex/bin/vertex.js", "mcp"] } } }
```

Tools: `load` (module path, cartridge path, or inline JSON), `step`, `observe` (JSON snapshot),
`view` (SVG frame), `screenshot` (PNG), `edit` (spawn/despawn/set/state on the live world), `reset`.

## Time is data

```js
import { Timeline, Lockstep, memoryTransport } from 'vertex-engine';

const t = new Timeline(createGame, { seed: 42 });  // logs inputs, keeps checkpoints
t.press('fire'); t.step(300);
t.seek(120);                                       // exact frame 120
const alt = t.branch(120);                         // an alternate future sharing the past
t.toRecording();                                   // the whole run as a replay file
```

Lockstep multiplayer: every peer runs the same simulation and exchanges only input changes
tagged with a frame. Peers stall rather than desync. Transports are pluggable (in-memory,
BroadcastChannel, or any `{ send, onMessage }`).

## Performance

`npm run bench` (Node 22, one core), at constant density with exact outline collision:

| Entities | Step | SVG frame | Heap |
|---|---|---|---|
| 1,000 | ~1.5 ms | ~1.6 ms | ~10 MB |
| 10,000 | ~6.7 ms | ~10 ms | ~50 MB |

## Verification

- `node --test`: 70+ tests covering parser, world, rules, collision, rendering, PNG, replay, timelines, lockstep, CLI, MCP and conformance.
- `python py/vertex.py conform`: the second implementation reproduces all 42 conformance digests.
- `node tools/browser/run.mjs`: renders the same frames with WebGL2 and Canvas2D in headless Chrome and compares pixels.

## License

MIT
