# Concepts

One page, the whole mental model.

```text
cartridge (JSON) ──loadCartridge──▶ Game ── step() ×60/s ──▶ World ──▶ renderer / SVG / network
                                     │                          ▲
                        input ──▶ actions            systems run in order, mutate it
```

| Concept | What it is | Key rule |
|---|---|---|
| **Cartridge** | the game as one JSON document | the only source of truth |
| **World** | shapes, entities, `state`, timers, camera | everything that matters lives here |
| **Entity** | a plain object: transform, velocity, `tags`, `data`, optional `body`/`emitter`/`interact` | tags decide what touches it |
| **Shape** | vector art: SVG path(s), or a 3D mesh | pivot at (0, 0), rotation 0 faces +x, y down |
| **System** | a step function, run in the order of `systems` | events reach only later systems |
| **Rule** | sandboxed logic: `each` / `on` + `when` + `do` | no state outside the world |
| **Action** | a named input (`jump`), from keys, touch, gamepad, replay or agent | rules read actions, never devices |
| **Event** | `{type, …}` emitted during a step (`hit`, `contact`, timers) | cleared every step |
| **Step** | timers fire → systems run → scene change → `frame++` | fixed `dt` (1/60 s) |

## Determinism

Same cartridge + seed + inputs ⇒ same frames, byte for byte. That's what makes replays, rewind,
tests and lockstep work. Keep it by: using `random()`/`rand()`/`hash()`/`noise()` for randomness,
keeping all state in the world, and never reading the clock in game logic.

## Frames are text

`toSVG()` renders the world as a canonical SVG string; `digest()` hashes it. Agents read frames
as text, tests compare digests, and two runtimes (JS, Python) agree on them exactly.

## Time

| You want | Use |
|---|---|
| a replay file | `Recorder` → `{seed, inputs, digest}` |
| rewind / scrub / branch | `Timeline` (hold R in the player) |
| "when did these runs differ?" | `vertex diff a.json b.json` |

## Multiplayer

The server runs the same `Game`. Each player is an entity with `data.player`; rules running for
that entity read that player's input. Clients receive nearby entities as deltas and draw locally.
So a single-player cartridge with a `multiplayer` block is already a multiplayer game.

## Glossary

**chunk**: square region of a streamed world · **dormant**: a sleeping chunk's saved entities ·
**focus**: entities that keep chunks awake (players) · **interest**: radius a client receives ·
**HUD**: `state.hud` text overlay · **policy**: a function that presses actions, for bots/tests ·
**conformance**: the test suite every runtime must match.
