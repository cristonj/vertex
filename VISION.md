# Vertex — Vision

> **North star: a game is a piece of text.** Small enough to fit in a message, readable by any
> model, playable on any screen, forkable by anyone. Vertex aims to be the format and runtime for
> that, the way HTML was for documents.

This document is deliberately ambitious. The [status section](#where-we-are-today) at the end says
what actually exists.

## The bet

Current LLMs are fluent in SVG path data, JSON and small functions. They are bad at sprite sheets,
binary asset formats and editor GUIs. Most engines are built around exactly those things.

Vertex is built on one idea: **everything is a vector, and every vector is text.** Art, scenes,
frames, replays, sound and rules are all data a human or a model can read, write and diff.

| Traditional engine | Vertex |
|---|---|
| PNG sprites, kilobytes to megabytes each | SVG path strings, tens of bytes each |
| Binary scene files | Plain JSON you can diff and merge |
| GUI editor required | Text is the editor; a GUI is optional |
| Screenshots to "see" the game | A frame is SVG text an agent can read |
| Timing varies run to run | Fixed steps and a seeded RNG, so replays match exactly |
| Art locked to one resolution | Crisp at any size or zoom |

## 1. The format is the product

- **An open spec, not one engine.** The scene format (paths, entities, rules) becomes a standard
  anyone can implement: in JS, in Rust, on a microcontroller, in a terminal. This repo is the
  reference implementation.
- **Games as links.** A full game fits in a URL, a QR code or a chat message. No install, no
  download, no asset server.
- **View source for games.** Every game is readable and remixable. Forking a game is copying text.
  A mod is a diff. A patch is a pull request.
- **Runs on anything that can draw a line.** Phones, watches, e-ink, laser projectors, pen
  plotters, 8K walls, all from the same file.

## 2. Agents in every role

Humans and agents are both top-level users, through the same API. An agent can be:

- **Designer.** Prompt to playable game in seconds, because the model writes the art, the scene
  and the rules in formats it already knows.
- **Player.** It reads the frame as text and presses the same named actions a human does.
- **Play-tester.** It plays a thousand headless runs overnight and reports where the game is
  unfair, boring or broken, with the seed and inputs for each case.
- **Balancer.** It changes a number, replays the same seeds, and compares outcomes.
- **Opponent, teammate, narrator.** A model inside the game loop, as a character.
- **Artist at runtime.** New enemies, levels and items drawn as paths while you play. Content
  with no asset pipeline and no upper limit.

## 3. The frame is a universal interface

Because any frame can be emitted as a small SVG document with entity ids attached:

- **Models see without vision.** No screenshot, no pixel decoding. The screen is a few KB of text.
- **Frames are diffable and testable.** "What changed" is a text diff. A visual regression test is
  a string comparison.
- **Every game is an agent benchmark.** Any Vertex game is automatically an environment with a
  text observation, named actions and a score. A library of games becomes a library of evals.
- **Training at scale.** Headless and deterministic means millions of cheap, reproducible steps,
  and a growing corpus of games, frames and replays in a format models learn from directly.

## 4. Time is data too

Determinism means a seed plus an input log is the whole game.

- **Replays are tiny.** A full match is a few hundred bytes, re-renderable at any resolution.
- **Time travel.** Rewind, scrub, and step any run. Debug by bisecting frames.
- **Branching timelines.** Fork a game at any frame and try something else. Version control for
  play, not just for code.
- **Bug reports that always reproduce.** Seed, inputs, and the SVG of the broken frame.
- **Multiplayer by sharing inputs.** Players exchange actions instead of world state, so
  bandwidth stays tiny. Spectating is replaying the same log.

## 5. Vectors beyond 2D art

Push the same idea into every asset type, so no binary file is ever required:

- **Animation** as path morphing and skeletal transforms, keyframed in text.
- **Text** as glyph paths, so fonts ship inside the game.
- **Sound** as synth parameters, and music as notes, rather than audio files.
- **Effects** as gradients, clipping, blending and procedural shapes.
- **Physics** on the real outlines, so the art is the hitbox.
- **3D** as curves, extrusions and wireframes, described as geometry rather than as textures.

## 6. Self-improving games

The pieces above compose into a loop no raster engine can run cheaply:

1. An agent writes a game.
2. Agents play it thousands of times, headless.
3. The results say what is fun, fair and finishable.
4. An agent edits the text and the loop repeats.

Games that tune themselves, levels that are generated and verified beatable before a human sees
them, and whole genres explored by search.

## Principles

1. **Vectors all the way down.** No raster assets in the core.
2. **Text is the source of truth.** No hidden editor state.
3. **Two users, one API.** Humans and agents go through the same code.
4. **Headless first.** The engine runs with no browser.
5. **Deterministic.** Same seed and inputs, same game.
6. **Tiny core, no dependencies.** Small enough for an agent to hold entirely in context.
7. **Plain functions over frameworks.** A behaviour is `(game, dt) => void`.

## Roadmap

| Stage | Theme | What it adds |
|---|---|---|
| **v0.1** (shipped) | Proof | Path parser, JSON world, deterministic loop, canvas and SVG renderers, built-in behaviours, the Drift demo, a headless agent player |
| **v0.2** | Agent loop | CLI runner, MCP server (load, step, observe, edit as tools), JSON Schema for scenes, input recording and replay, optional PNG output |
| **v0.3** | Richer vectors | True arcs, exact outline collision, gradients and clipping, path-morph and skeletal animation, vector text, procedural shapes |
| **v0.4** | Scale | GPU renderer, spatial broadphase, camera and layers, sound as synth data |
| **v0.5** | Time | Rewind and scrub, branching timelines, input-sync multiplayer, shareable replay files |
| **v1.0** | The format | A written, versioned spec; single-file games; games as links; a second implementation in another language |
| **Beyond** | Ecosystem | Prompt-to-game, a public registry of forkable games, an agent benchmark suite, runtime generative content, self-tuning games, 3D |

## Hard problems

Stated plainly, because the ambition depends on them:

- **Vector rendering cost.** Many complex filled paths are slower to draw than sprites. The GPU
  backend has to solve this for large scenes.
- **Art range.** Vectors suit clean, stylised looks. Painterly or photographic styles are out of
  scope by design.
- **Determinism across implementations.** Floating-point behaviour differs between languages and
  machines. A cross-language spec needs fixed rules for math.
- **Logic in a portable format.** Rules are JavaScript today. A spec needs a rules format that is
  safe to run and implementable anywhere.
- **Model reliability.** Generated games need automatic verification, which is why headless
  play-testing is central rather than optional.

## Where we are today

v0.1 exists and is tested: the parser (arcs are approximated as straight lines), the JSON world,
the deterministic loop, both renderers, circle-based collision, action input, and one example game
with a scripted headless player. Everything else in this document is direction, not shipped code.
