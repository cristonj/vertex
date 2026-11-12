# The Vertex way

Vertex is an **extremely opinionated framework for games made of text**, with a plain library
underneath. Each opinion removes a class of work and has a cost:

| Opinion | You get | You give up |
|---|---|---|
| **Everything is a vector** (SVG paths, meshes, stroke font) | KB-sized games, any resolution, art that people and models can edit | bitmaps, textures, painterly art |
| **Text is the source of truth** (one JSON cartridge) | diffs, forks, games as links, AI-authored games | opaque editor-only workflows |
| **The simulation is deterministic** | few-KB replays, rewind, exact bug reports, tests, lockstep, a bit-identical Python runtime | `Math.random()` and wall-clock logic (use `random`, `rand`, `hash`, `noise`) |
| **Logic is sandboxed rules** | cartridges safe to load from anywhere, portable across runtimes | arbitrary code (drop to JS systems when needed) |
| **State lives in the world** (`data`, `state`, timers) | save, rewind and multiplayer sync with no serialization code | caching state in closures |
| **Systems run in an explicit order** | a loop you can read in one line; events reach later systems | occasionally deciding where `rules` goes (usually last) |
| **Agents are users** | headless play, JSON/SVG observations, MCP | nothing |

## Three layers

| Layer | You write | Use when |
|---|---|---|
| Cartridge (framework) | JSON: shapes, entities, systems, rules | almost always |
| JS systems | `(game, dt) => { … }` next to a cartridge | logic rules can't express |
| Library | your own loop, using `World`, `Game`, renderers, server… | embedding Vertex in another app |

JS systems can break determinism and the state-in-the-world rule. Don't, unless you've decided
replays and rewind don't matter for your game.

## Not a fit

Photoreal or texture-heavy art · depth-buffered 3D with shadows or skeletal animation · a visual
editor as the main workflow · competitive twitch netcode (see [multiplayer limits](multiplayer.md#limits-honest)).
