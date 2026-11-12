# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `hit` / `contact` rules never run | `"rules"` is before `collide`/`physics` in `systems` | move `"rules"` after them |
| `on: "scene"` / `"join"` rule doesn't fire on that step | these events arrive at the **start of the next step** | expected; act in the handler |
| Replay says `MISMATCH` | nondeterminism: `Math.random()`, clock, state kept in a JS closure, or a different seed/fps | use `game.random()`; keep state in `world`; record seed and fps |
| Rewind (`R`) jumps to wrong state | a JS system keeps private state between steps | store it in `entity.data` or `world.state` |
| Value becomes `NaN` | field was never set: `undefined + 1` | initialize it in the entity, e.g. `"ry": 0`, `"data": {"gold": 0}` |
| `rules[3]: expected ";"` | syntax error in rule 3 | the message names the rule; check quotes (`'...'` inside JSON strings) |
| `rules: unknown variable "x"` | assigning a name not declared with `let` | `let x = …` first, or assign to a field |
| `unknown shape "rock"` | entity references a missing shape | add it to `shapes` (or `"shape": null` for text/emitters) |
| Player can't jump | `body.ground` is set by `physics` | add `"physics"` to `systems` and a `body` to player and floors |
| Player falls through thin platforms at speed | per-step overlap resolution (no CCD) | thicker platforms, lower speed, or more `physics.iterations` |
| Things far away stop moving | `streaming` sleeps chunks without a `focus` entity nearby | expected; tag things with a `keep` tag to keep them awake |
| Same procedural chunk differs between visits | generation used `random()` | use `hash(cx, cy, n)` / `noise()` in `chunkEnter` |
| Everyone in multiplayer moves together | rule reads input outside a player context | use `each: "player"` (or `a` in hit/contact) so input is per player |
| Online score is shared by all players | stored in `state` | store per player in `self.data` |
| 3D faces flicker or overlap wrongly | painter's sort per face; very large faces | subdivide big faces (`plane(w, d, nx, nz)`) |
| Nothing renders in 3D | camera behind objects or `near`/`far` wrong | check `space.camera` z and `pitch`; y is down, z forward |
| No sound | browsers need a user gesture first | press a key or tap once |
| `npx vertex` not found | the bin is `vertex` inside projects | use `npx vertex-engine …` outside a project |

Still stuck? Run headless and read the frame: `npx vertex run game.json --steps 120 --svg f.svg --json`.
