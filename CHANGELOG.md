# Changelog

## Unreleased

- Eleven-game arcade gallery with original SVG icons and measured source/gzip sizes, including Drift and Frontier.
- New games: Apex (perspective highway racing), Breaker, Pulse, Serpent, Lunar and Rally.
- Starfall: combos, shields, hearts, particles, outline collisions and restart. Ascent: clearer controls and summit restart.
- Skyline: six-gem timed trial and restart; 3D collisions now use rotated mesh-bound boxes instead of oversized spheres.
- Frontier: coin pickups now reach the rules system; corrected initial camera framing.
- Gameplay and replay checks cover every cartridge. Original demo conformance fixtures are frozen so their published digests remain unchanged.

## 2.0.0

The "real work" release: 3D, huge worlds, MMO networking, dialogue, and an npm package.

- **3D**: mesh and extrusion shapes, perspective camera, near clipping, back-face culling,
  painter's sort, flat shading, fog; one batched WebGL draw; `motion3d`, `chase`, `collide3d`.
- **Huge worlds**: chunk `streaming` with sleeping entities; `chunkEnter`/`chunkLeave`;
  deterministic `hash()` / `noise()`; bounded `repeat (n) { ... }` in rules.
- **Multiplayer / MMO**: authoritative `GameServer`, zero-dependency WebSocket server and client,
  per-player input namespaces (single-player cartridges become multiplayer), interest management,
  shared per-tick delta encoding, dead reckoning, client-side cosmetics, `join`/`leave` events,
  `vertex serve`. 500 players / ~24k awake entities ≈ 54 ms per tick in one process.
- **Dialogue and interactions**: dialogue trees as data with interpolation, conditions, effects,
  typewriter text, keyboard/gamepad/touch; proximity `interact` prompts; per-player state online.
- **Input**: analog axes (recorded in replays), virtual joystick, gamepad sticks.
- **Packaging**: `createPlayer()` embeddable player, `vertex new` project scaffolding
  (platformer, topdown, 3d, arcade templates), docs/ guides, TypeScript types for everything.
- **Examples**: Skyline (3D), Frontier (endless multiplayer world with NPC dialogue).
- **Fixes**: `join`/`leave`/`scene` events are delivered at the start of the next step so rules
  see them; physics broadphase is O(movers) instead of O(all bodies) with identical results.
- Spec 1.2 (additive). Python runtime: streaming, hash/noise, repeat, axes; 105 conformance digests.

## 1.1.0

Physics, scenes, timers, text entities, particles, raycasts, pointer/gamepad/touch input, live
inspector, faster rules (closure compilation), TypeScript types, landing page.

## 1.0.0

The format: SPEC.md, the rules language, cartridges, games as links, Python runtime and
conformance suite.

## 0.1 – 0.5

Engine core, agent loop (CLI, MCP, recordings), richer vectors, WebGL2, camera, sound, timelines,
lockstep multiplayer.
