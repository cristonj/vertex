# Cartridge reference

A cartridge is one JSON document: a scene plus behavior. Every field is optional. Machine-readable
schema: [`schema/scene.schema.json`](../../schema/scene.schema.json); normative spec: [SPEC.md §2](../../SPEC.md).

## Top level

| Field | Type | Default | |
|---|---|---|---|
| `title`, `description` | string | | metadata |
| `width`, `height` | number | 800, 600 | world/screen size in world units |
| `background` | color | `#000` | |
| `shapes` | `{name: Shape}` | | [below](#shapes) |
| `entities` | `Entity[]` | | [below](#entities) |
| `state` | object | `{}` | game-wide JSON; `state.hud` is drawn as text |
| `keys` | `{key: action}` | | `KeyboardEvent.key` → action name |
| `systems` | `(name \| {name: arg})[]` | `["rules","motion","wrap","lifetime"]` | the loop, in order: [systems](systems.md) |
| `rules` | `Rule[]` | | [rules](rules.md) |
| `sounds` | `{name: Sound}` | | [below](#sounds) |
| `camera` | `{x, y, zoom?, rot?}` | none | world point at screen center; none = top-left origin |
| `scenes` | `{name: {entities, state?, camera?}}` | | for `goto(name)` |
| `physics` | `{gravity?: [x, y], iterations?, slop?}` | `[0, 900]`, 4, 0.01 | |
| `streaming` | `{chunk?, radius?, focus?, plane?, keep?}` | 512, 1, `"player"`, `"xy"`, `[]` | [worlds](../worlds.md) |
| `space` | `{camera, light?, ambient?, fog?}` | | 3D: [3d](../3d.md) |
| `dialogue` | `{id: {start?, nodes}}` | | [worlds](../worlds.md#dialogue) |
| `dialogueStyle` | `{speed, size, panel, border, textColor, …}` | | |
| `interaction` | `{focus?}` | `"player"` | who triggers `interact` |
| `multiplayer` | `{player, spawn, interest, publicData, sendRate, …}` | | [multiplayer](../multiplayer.md) |

## Shapes

```json
{ "ship": { "d": "M12 0 L-8 -8 L-4 0 L-8 8 Z", "fill": "#0b1020", "stroke": "#7df9ff", "width": 2 } }
```

| Field | | |
|---|---|---|
| `d` | SVG path data | `M L H V C S Q T A Z`, absolute and relative; centered on the pivot |
| `fill` | color or gradient | `{type: "linear", x1, y1, x2, y2, stops: [[0, "#fff"], [1, "#000"]]}` or `{type: "radial", cx, cy, r, stops}` |
| `stroke`, `width` | color, number | |
| `clip` | path data | clip this part to a region |
| `parts` | `Shape[]` | several paths drawn as one shape |
| `mesh` | `{v: [[x,y,z]…], f: [[i,j,k…]…], colors?}` | 3D; plus `shade`, `doubleSided` |
| `extrude` | `{d, depth}` | 3D solid from a 2D path |

Colors: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, a few names, `none`.

## Entities

```json
{ "id": "hero", "shape": "hero", "x": 60, "y": 200, "tags": ["player"], "body": {}, "data": { "hp": 3 } }
```

| Field | Default | |
|---|---|---|
| `id` | `e1`, `e2`, … | unique |
| `shape` | | name in `shapes` (or `null`) |
| `d` / `text` | | inline path, or text in the vector font (`size` 16, `align` center) |
| `fill`, `stroke`, `width` | | style for `d`/`text` |
| `x`, `y`, `rot`, `scale` | 0, 0, 0, 1 | rot in radians, 0 faces +x |
| `vx`, `vy`, `vr` | 0 | velocities (units/s, rad/s), integrated by `motion` |
| `drag` | | velocity loss per second, 0–1 |
| `z`, `rx`, `ry`, `rz`, `vz`, `vrx`, `vry`, `vrz` | | 3D (`ry` = yaw) |
| `layer` | 0 | draw order |
| `parallax`, `fixed`, `hidden` | 1, false, false | camera influence; screen-space UI; skip drawing |
| `tags` | `[]` | what systems and rules select on |
| `data` | `{}` | your fields; `data.ttl` = seconds to live (`lifetime`) |
| `body` | | physics: `{static, sensor, collider: "box"\|"circle", restitution, friction, mass, gravity}`; read `ground`, `wall` |
| `emitter` | | particles: `{shape, rate, burst, life, speed, angle, scale, spin, gravity, shrink, max, tags}` |
| `interact` | | `{prompt, radius, dialogue, do, once}` |

## Sounds

```json
{ "jump": { "wave": "square", "freq": 330, "slide": 900, "decay": 0.12, "volume": 0.3 } }
```

`wave` (`square` `saw` `sine` `triangle` `noise`), `freq` Hz, `slide` Hz/s, `attack`/`sustain`/`decay` s,
`volume`, `vibrato` Hz + `vibratoRate`, `duty` (square), `lowpass` Hz, `seed` (noise).
