# Systems reference

`"systems"` is the game loop, run in order every step. Events reach only systems listed after the
one that emits them, so `"rules"` usually goes after `collide`/`physics`.

| System | Does | Emits |
|---|---|---|
| `"rules"` | runs the cartridge's [rules](rules.md) (at most once in the list) | your events |
| `"motion"` | `x += vx·dt`, `y += vy·dt`, `rot += vr·dt`; applies `drag` | |
| `"wrap"` | entities tagged `wrap` re-enter from the opposite edge | |
| `"lifetime"` | counts down `data.ttl`, despawns at 0 | |
| `{ "collide": [[a, b], …] }` | bounding-circle overlap between tag pairs | `hit` |
| `{ "collideOutline": [[a, b], …] }` | exact outline overlap | `hit` |
| `"physics"` | gravity, solid bodies, restitution, friction, sensors; sets `body.ground` / `body.wall` | `contact` |
| `"particles"` | runs entity `emitter`s (client-side only when online) | |
| `{ "follow": id \| {id, lerp} }` | 2D camera eases toward an entity | |
| `"streaming"` | sleeps/wakes chunks around `focus` entities (put first) | `chunkEnter`, `chunkLeave` |
| `"interact"` | nearest `interact` entity per player, prompt, triggers | `interact` |
| `"dialogue"` | runs conversations and draws the dialogue box | `dialogue`, `choice`, `dialogueEnd` |
| `"motion3d"` | integrates `vz`, `vrx`, `vry`, `vrz` | |
| `{ "chase": id \| {id, distance, height, lerp, pitch} }` | 3D camera behind an entity | |
| `{ "collide3d": [[a, b], …] }` | oriented mesh-bound boxes in 3D | `hit` |
| `"morph"` · `"keyframes"` | path morphing (`data.morph`) · keyframed transforms (`data.keys`) | |

Typical orders:

| Game | `systems` |
|---|---|
| arcade | `["motion", "wrap", "lifetime", {"collide": [...]}, "rules"]` |
| platformer | `["motion", "physics", "particles", "lifetime", "rules", {"follow": "player"}]` |
| open world | `["streaming", "rules", "motion", "physics", "interact", "dialogue"]` |
| 3D | `["rules", "motion", "motion3d", {"collide3d": [...]}, {"chase": "player"}]` |

In JavaScript, a system is any `(game, dt) => void`; add it with `game.use(fn)`.
