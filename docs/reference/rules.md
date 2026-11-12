# Rules reference

Rules are game logic as data. Normative definition: [SPEC.md §6](../../SPEC.md).

```json rules
[
  { "on": "start", "do": "state.score = 0" },
  { "each": "player", "when": "held('jump') && self.body.ground", "do": "self.vy = -500; sound('jump')" },
  { "on": "hit", "tags": ["player", "coin"], "do": "despawn(b); state.score += 1" },
  { "do": "state.hud = 'SCORE ' + str(state.score)" }
]
```

## Rule kinds

Rules run in array order, once per step, where `"rules"` sits in `systems`.

| Rule | Runs | Binds |
|---|---|---|
| `{ do }` | every step | — |
| `{ each: tag, do }` | once per entity with `tag` | `self` |
| `{ on: "start", do }` | first step only | — |
| `{ on: "hit", tags?: [a, b], do }` | per `hit` event so far this step, matching tag order | `a`, `b`, `event` |
| `{ on: "contact", tags?: [a, b], do }` | per physics `contact`, tags in either order | `a` (has tag a), `b`, `event` |
| `{ on: "<type>", do }` | per event of that type so far this step | `event` |

Any rule may add `when: "<expression>"`; `do` is a string or an array of strings (joined by `;`).

## Language

| Syntax | Example |
|---|---|
| statements | `a; b; c` |
| local variable | `let n = count('coin')` |
| assignment | `=`, `+=`, `-=`, `*=`, `/=` on locals or fields: `self.data.hp -= 1` |
| if / else | `if (state.hp <= 0) { goto('over') } else state.hp -= 1` |
| bounded loop | `repeat (5) spawn('rock', {x: i * 40, y: 20})` (`i` = 0…n−1, max 10,000) |
| operators | `+ - * / %`, `== != < <= > >=` (strict), `&& \|\| !`, `c ? a : b` |
| literals | `1.5`, `'text'` or `"text"`, `true`, `false`, `null`, `[1, 2]`, `{x: 1, tags: ['a']}` |
| access | `self.x`, `state.items[0]`, `event.name`; missing fields are `undefined` |

Values follow JavaScript semantics restricted to JSON data plus entities. `+` concatenates when
either side is a string. Forbidden: `__proto__`, `prototype`, `constructor`, unknown names/functions.

## Variables

| Name | Value |
|---|---|
| `dt` | seconds per step (1/60 by default) |
| `frame`, `time` | step count, seconds elapsed |
| `state` | `world.state`, game-wide JSON |
| `W`, `H` | world width, height |
| `PI` | π |
| `pointer` | `{x, y}` in world units (per player online) |
| `camera` | `world.camera` or `null` |
| `self`, `a`, `b`, `event` | bound by the rule kind (above) |

## Builtins

### Input
| | |
|---|---|
| `held(action)` | action is down. Online: the current player's input |
| `pressed(action)` | action went down this step |
| `axis(name)` | analog value in [−1, 1] (`'x'`, `'y'` from sticks/joystick), 0 if unset |

### Randomness and noise
| | |
|---|---|
| `random()` | seeded, [0, 1) |
| `rand(lo, hi)` | seeded, [lo, hi) |
| `hash(a, b, c)` | deterministic [0, 1) from integers: use for procedural content |
| `noise(x, y, seed)` | smooth value noise in [0, 1) |

### Entities
| | |
|---|---|
| `spawn(shape, fields?)` | create an entity, returns it. `shape` may be `null` (text, emitters, invisible) |
| `despawn(e)` | remove an entity (or id) |
| `get(id)` | entity or `null` |
| `alive(e)` | still in the world |
| `first(tag)` · `all(tag)` · `count(tag)` | query by tag |
| `has(e, tag)` · `tag(e, t)` · `untag(e, t)` | tag tests and edits |
| `nearest(x, y, tag)` | closest entity with a tag, or `null` |
| `at(x, y, tag?)` | topmost entity whose outline contains the point |
| `raycast(x, y, dx, dy, max?, tag?)` | `{entity, x, y, distance}` of the first outline hit, or `null` |
| `dist(a, b)` | distance between entities |

### Events, time, flow
| | |
|---|---|
| `emit(type, payload?)` | emit an event (visible to later systems this step) |
| `after(seconds, type, payload?)` | emit an event later (saved with the world) |
| `goto(scene)` | switch scene at the end of this step |
| `sound(name)` | play a sound from `sounds` |
| `burst(e, n)` | make an entity's emitter spray `n` particles |
| `talk(dialogueId, npc?, actor?)` | start a conversation |
| `inDialogue(actor?)` | a conversation is open |

### Math and text
| | |
|---|---|
| `abs` `min` `max` `floor` `ceil` `sqrt` `sign` | as in JavaScript |
| `round(v)` | `floor(v + 0.5)` |
| `clamp(v, lo, hi)` · `lerp(a, b, t)` | |
| `sin` `cos` `atan2` | radians (implementation-tolerant: see [SPEC §8](../../SPEC.md)) |
| `str(v)` · `len(v)` | to string · length of string/array (0 for null) |

## Events emitted by the engine

| Event | Fields | From |
|---|---|---|
| `hit` | `a`, `b`, `tags` | `collide`, `collideOutline`, `collide3d` |
| `contact` | `a`, `b`, `nx`, `ny` | `physics` |
| `scene` | `name` | `goto` (delivered next step) |
| `chunkEnter` / `chunkLeave` | `cx`, `cy`, `key`, `fresh`, `x`, `y`, `size` | `streaming` |
| `interact` | `a` (actor), `b` (target) | `interact` |
| `dialogue` · `choice` · `dialogueEnd` | `id`, `node`, `who`, `actor`, (`choice`) | `dialogue` |
| `join` / `leave` | `player`, `entity` | multiplayer server (delivered next step) |
| `sound` | `name` | `sound()` |
| *your timers* | your payload | `after()` |
