# Vertex — Vision

> A game engine where every asset is a vector, every scene is text, and an AI agent is a first-class user — not an afterthought.

## The bet

Modern LLMs are genuinely good at writing SVG path data, JSON, and small functions. They are bad at
producing PNG sprite sheets, navigating editor GUIs, or reasoning about binary asset formats.

Most engines are built around rasters and GUIs. Vertex is built around the things models (and
humans with a text editor) are fluent in:

| Traditional engine            | Vertex                                         |
|-------------------------------|------------------------------------------------|
| PNG/atlas sprites (KB–MB each)| SVG path strings (tens of bytes each)          |
| Binary scene files            | Plain JSON documents, diffable, mergeable      |
| GUI editor required           | Text is the editor; a GUI is optional sugar    |
| Screenshots to "see" the game | `toSVG()` frame = text an agent can read       |
| Non-deterministic loop        | Fixed-step, seeded — replays match bit-for-bit |
| Resolution-locked art         | Infinite resolution, any DPI, any zoom         |

## Principles

1. **Vectors all the way down.** Shapes, UI, fonts (eventually), particles, even "textures" (patterns,
   gradients) are geometry. No raster assets in the core. A whole game should fit in a single-digit-KB
   gzip if the author wants it to.
2. **Text is the source of truth.** A game = a JSON scene + small JS systems. Everything round-trips
   through `World.toJSON()`. No hidden editor state.
3. **Two top-level users, one API.** Humans press keys; agents call `game.press('fire')`. Humans see
   pixels; agents read `snapshot()` (JSON) or `toSVG()` (vector frame). Same engine, same code path.
4. **Headless first.** The engine must run in Node with zero DOM. That's what makes agent play-testing,
   CI-tested gameplay, RL training, and reproducible bug reports trivial.
5. **Deterministic.** Fixed timestep + seeded PRNG. A `(seed, input log)` pair *is* a replay.
6. **Zero dependencies, tiny core.** The core stays readable in one sitting (currently ~15 KB of source).
   Small enough that an agent can hold the entire engine in context.
7. **Plain functions over frameworks.** A system is `(game, dt) => void`. Agents write these well.

## Why it's fast and light

- Geometry is parsed **once** per shape, cached as `Path2D`; entities are just transforms + a shape name.
- Collision uses bounds derived from the same vector data — no separate hitbox authoring.
- Memory is dominated by entity count, not asset size. 10k entities ≈ a few MB.
- Future: WebGL/WebGPU tessellated backend (shapes → cached triangle meshes, instanced draws).

## Roadmap

### v0.1 — Proof (this release)
- [x] SVG path parser (M L H V C S Q T Z, abs+rel), flattening, bounds
- [x] JSON world model: shapes, entities, tags, state
- [x] Deterministic fixed-step `Game`, seeded RNG, event bus
- [x] Canvas2D renderer (Path2D cache) + headless `toSVG()`
- [x] Built-in systems: motion, wrap, lifetime, circle collision
- [x] Action-based input (keyboard + programmatic)
- [x] Example game *Drift* + headless agent player

### v0.2 — Agent loop
- [ ] `vertex` CLI: `vertex run scene.json --steps 600 --inputs log.json --out frame.svg`
- [ ] MCP server: `load_scene`, `step`, `press`, `snapshot`, `render_svg`, `patch_scene` tools
- [ ] JSON Schema for scenes (so agents get validation + autocomplete)
- [ ] Input recording / replay files
- [ ] Rasterize frame → PNG for vision models (optional, via resvg-wasm)

### v0.3 — Richer vectors
- [ ] True arc flattening, polygon (SAT) collision, raycasts
- [ ] Gradients, patterns, clip paths, blend modes
- [ ] Vector animation: keyframed path morphing + skeletal transforms
- [ ] Vector text (SVG font glyphs embedded as paths)
- [ ] Procedural shapes: `{ gen: "star", points: 5 }`, noise-jittered outlines

### v0.4 — Scale
- [ ] WebGL2 backend: tessellate once, instanced rendering
- [ ] Spatial hash broadphase
- [ ] Camera, layers, parallax
- [ ] Audio as data (tiny synth / sfxr-style params, not WAV files)

### Beyond
- [ ] Live-editing devtool: edit JSON/SVG in a panel, game hot-reloads
- [ ] "Prompt → game" template: an agent produces a playable game in one file
- [ ] Gameplay test suites: assert on outcomes (`after 600 steps with policy X, score > 100`)

## Open questions

- Should scripts live inside the JSON (string-eval) for single-file games, or always be modules?
- How far to push "audio as vectors" — parametric synth only, or also tracker-style music data?
- Do we standardize an agent observation format (entity list vs. SVG vs. both) for RL use?
