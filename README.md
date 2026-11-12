# Vertex

**An extremely opinionated framework for games made of text.** 2D and 3D games are small JSON
documents: SVG paths and meshes for art, a sandboxed rules language for logic. Runs in the browser,
headless in Node, and as an authoritative multiplayer server, with a plain library underneath.
Zero dependencies.

**[Documentation](https://cristonj.github.io/vertex/docs/)** · [Live demos](https://cristonj.github.io/vertex/) · [Tutorial](docs/tutorial.md) · [The Vertex way](docs/philosophy.md) · [Spec](SPEC.md) · [For AI agents](AGENTS.md) · [Changelog](CHANGELOG.md)

```bash
npx vertex-engine new mygame --template platformer   # or topdown, 3d, arcade
cd mygame && npm install && npm start                # http://localhost:8080
```

## What you get

| | |
|---|---|
| **2D** | SVG-path art, gradients, clipping, vector text, particles, camera/layers/parallax, outline collision, deterministic physics with platforming, raycasts |
| **3D** | Mesh and extrusion shapes, perspective camera, flat shading, fog, chase camera, 3D collision; rendered as vector polygons in every backend |
| **Huge worlds** | Chunk streaming: only areas near players are awake; deterministic `hash`/`noise` + `chunkEnter` hooks for endless procedural worlds |
| **Multiplayer / MMO** | Authoritative server, WebSocket transport, interest management, delta snapshots, dead reckoning. Single-player games become multiplayer without code changes |
| **Dialogue & interaction** | Branching dialogue trees as data (conditions, effects, interpolation, typewriter), proximity interactions with prompts |
| **Input** | Keyboard, mouse/touch/pen, gamepad, generated on-screen touch controls with an analog joystick; all recorded in replays |
| **Time** | Deterministic fixed-step simulation: record, replay, rewind, scrub, branch and diff any run |
| **Tooling** | Player with live inspector and hot reload, CLI, MCP server for AI agents, TypeScript types, project scaffolding |
| **Rendering** | WebGL2 (batched, stencil-then-cover), Canvas2D, canonical SVG frames, pure-JS PNG |
| **A real format** | [SPEC.md](SPEC.md) and a conformance suite; a second runtime in Python reproduces every core frame bit-for-bit |

## A game is one document

```json
{
  "title": "Tiny", "width": 320, "height": 240,
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

Play it in a page:

```js
import { createPlayer } from 'vertex-engine';
await createPlayer({ canvas: document.querySelector('canvas'), cartridge: game });
```

Serve it to many players:

```bash
npx vertex serve game.json --root .    # then open /?online (scaffolded projects) or /play.html?server=auto
```

## Examples

<!-- GAMES:START -->
| Game | Gameplay | Source | Gzip |
|---|---|---:|---:|
| [Apex](examples/apex/apex.json) | Perspective racing. Sunset bends, traffic, boost and timed checkpoints. | 8.5 KiB | 2.5 KiB |
| [Drift](examples/drift/drift.js) | The original vector space shooter, with outline collisions and time rewind. | 3.2 KiB | 1.4 KiB |
| [Breaker](examples/breaker/breaker.json) | Clear a neon wall. Paddle placement controls the bounce. Three lives. | 4.1 KiB | 1.5 KiB |
| [Pulse](examples/pulse/pulse.json) | Formation shooting, return fire, shields and increasingly fast waves. | 4.7 KiB | 1.7 KiB |
| [Serpent](examples/serpent/serpent.json) | Grow a luminous snake. Each fruit speeds up the grid. | 4.2 KiB | 1.5 KiB |
| [Rally](examples/rally/rally.json) | A paddle duel against a beatable CPU. First to seven takes the match. | 4.3 KiB | 1.4 KiB |
| [Lunar](examples/lunar/lunar.json) | A fuel-limited lander. Control angle and velocity for a soft touchdown. | 4.0 KiB | 1.4 KiB |
| [Starfall](examples/starfall/starfall.json) | Catch gold, dodge red, chain combos and collect shields. | 7.1 KiB | 2.1 KiB |
| [Ascent](examples/ascent/ascent.json) | Two platforming stages with variable jumps, gems and a summit. | 9.7 KiB | 2.0 KiB |
| [Skyline](examples/skyline/skyline.json) | A 3D city time trial. Collect six gems and dodge the buildings. | 10.8 KiB | 1.9 KiB |
| [Frontier](examples/frontier/frontier.json) | Explore an endless forest, gather gold and talk to wanderers. Solo or online. | 7.8 KiB | 2.5 KiB |

Sizes measure each complete game source with LF line endings. Gzip uses level 9; the shared engine, player and optional icon are excluded. Rebuild with `node tools/gallery.mjs`.
<!-- GAMES:END -->

## Use it headless (tests, agents, servers)

```js
import { loadCartridge, Recorder, applyRecording, verifyReplay } from 'vertex-engine';

const game = loadCartridge(doc, { seed: 42 });
const rec = new Recorder(game);
game.press('right'); game.step(600);
game.snapshot();          // JSON observation
game.toSVG();             // the frame as text
const run = rec.toJSON(); // a replay: seed + input log + digest
verifyReplay(applyRecording(loadCartridge(doc, { seed: 42 }), run), run);
```

CLI: `vertex run | play | diff | link | serve | new | schema | mcp` (run `npx vertex-engine` for help).

## Performance

Measured on one core (Node 22): 10,000 entities with exact outline collision step in ~7 ms; rules
for 5,000 entities take ~2.7 ms; a multiplayer server with 500 players and ~24,000 awake entities
in a streamed world runs a full tick (simulation + all snapshots) in ~54 ms, sending ~300 bytes
per player per snapshot. Benchmarks: `npm run bench`, `node bench/rules-bench.js`, `test/net.test.js`.

## Verification

- `node --test`: 110+ tests (rendering, physics, rules, 3D, streaming, dialogue, networking over
  real WebSockets, replays, CLI, MCP).
- `python py/vertex.py conform`: the Python runtime matches 84 core digests (plus 21 extended).
- `node tools/browser/run.mjs` and `play-check.mjs`: WebGL2 vs Canvas2D pixels and every example in
  headless Chrome.
- `npx -p typescript tsc -p types`: types check under `strict`.

## Honest limits

3D sorts per face (no depth buffer) and uses flat shading without textures. Multiplayer has no
client-side prediction yet (input waits about one round trip), no persistence or accounts, and one
process per world. Physics colliders are axis-aligned boxes and circles. See the guides for details.

## License

MIT
