# The Vertex Format — Specification 1.0

Status: **1.0**. The key words MUST, SHOULD and MAY are used as in RFC 2119.

Vertex is a format for games that are entirely text: vector art, scene, rules and input are JSON.
This document defines the format precisely enough that independent implementations produce
**byte-identical frames** for the same game, seed and inputs. Two implementations exist:

| Implementation | Language | Level |
|---|---|---|
| `src/` (reference) | JavaScript (browser + Node) | extended |
| `py/vertex.py` | Python 3.8+ | core |

Conformance is tested by `conformance/cases.json` (cartridges + scripted inputs + frame digests at
checkpoints). An implementation is conformant at a level if it reproduces every digest of that level.

---

## 1. Conformance levels

- **core** — everything needed to run cartridges headless and reproduce digests: the document
  model (§2), geometry (§3), world (§4), simulation (§5), rules (§6), systems `motion`, `wrap`,
  `lifetime`, `collide` (§7), the canonical SVG frame and digest (§9), recordings (§10).
  Camera rotation is excluded.
- **extended** — core plus `collideOutline`, `morph`, `keyframes`, camera rotation, sound
  synthesis, rasterization and live renderers. Extended features are *implementation-tolerant*
  (§8): their results MAY differ in the last bits between implementations.

Versioning: documents carry `"vertex": 1`. Additive changes (new optional fields, builtins,
systems) keep the major version. Any change to §5, §6 semantics or §9 serialization that alters
digests of existing documents requires a new major version.

## 2. Documents

### 2.1 Scene

A **scene** is a JSON object. All fields are optional.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `width`, `height` | number | 800, 600 | World size in world units |
| `background` | string | `"#000"` | CSS color behind everything |
| `camera` | `{x, y, zoom?, rot?}` | absent | World point shown at screen center (§9.4) |
| `shapes` | `{name: Shape}` | `{}` | Named vector shapes |
| `entities` | `Entity[]` | `[]` | Initial entities, in order |
| `state` | object | `{}` | Game-level JSON values; `state.hud` is drawn as text |
| `sounds` | `{name: Sound}` | `{}` | Synth parameters (extended) |

**Shape**: `{ d, fill?, stroke?, width?, clip? }` or `{ parts: Shape[] }`. `d` is SVG path data (§3).
`fill` is a color string, `"none"`, or a gradient
`{ type: "linear", x1, y1, x2, y2, stops }` / `{ type: "radial", cx, cy, r, stops }` with
`stops: [[offset, color], ...]`, in shape-local coordinates. `clip` is path data the part is clipped to.

**Entity**: `{ id?, shape?, d?, fill?, stroke?, width?, x, y, rot, scale, vx, vy, vr, drag?, layer?,
parallax?, fixed?, hidden?, tags?, data? }`. `d` gives inline geometry instead of a named shape.
`rot` is radians (0 faces +x), `vx`/`vy` world units per second, `vr` radians per second.

### 2.2 Cartridge

A **cartridge** is a scene plus behavior — a complete game in one document:

| Field | Type | Meaning |
|---|---|---|
| `vertex` | 1 | Format major version |
| `title`, `description` | string | Metadata |
| `systems` | `(string \| {name: arg})[]` | Systems run each step, in order (§7). Default `["rules", "motion", "wrap", "lifetime"]` |
| `rules` | `Rule[]` | Game logic (§6) |
| `keys` | `{key: action}` | Suggested key bindings (`KeyboardEvent.key` → action) |

`"rules"` MUST appear at most once in `systems`; if absent and `rules` is non-empty, rules run
first. A document is a cartridge if it has a `rules` or `systems` array. Cartridges contain no
host code and MUST be safe to load from untrusted sources.

## 3. Geometry

### 3.1 Path data

Implementations MUST parse SVG path data with commands `M L H V C S Q T A Z`, absolute and
relative. Tokens match `/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/`.
Rules (all coordinates absolute after parsing):

- Arguments repeat: extra pairs after `M` are implicit `L` (`l` for `m`).
- `H`/`V` become `L`. `S`/`T` reflect the previous `C`/`Q` control point, else use the current point.
- `Z` returns the current point to the subpath start.
- `A` is converted with the W3C endpoint-to-center method and sampled as
  `max(4, ceil(|Δθ| / (π/12)))` line segments (implementation-tolerant, §8).
- Parsing stops silently at an incomplete argument list.

### 3.2 Flattening

Each subpath becomes a polygon (list of points). `M` starts a polygon; `L` appends a point;
`Q` and `C` append 8 points at `t = s/8, s = 1..8` evaluated in Bernstein form exactly as:
`Q: u·u·x0 + 2·u·t·x1 + t·t·x2` and `C: u·u·u·x0 + 3·u·u·t·x1 + 3·u·t·t·x2 + t·t·t·x3` (`u = 1 − t`,
left-to-right evaluation). `Z` appends the subpath's first point.

### 3.3 Bounds

A shape's **radius** is `sqrt(max(x² + y²))` over all flattened points of all parts (0 if none).
Its **pad** is `max(0, width/2)` over parts with a `stroke` other than `"none"` (`width` default 1).
Inline geometry has radius from its own `d` and pad `(width ?? 1) / 2`.

## 4. World

- Entities live in an ordered list. **spawn** appends; **despawn** removes; order is otherwise stable.
- spawn builds `{ id, shape, x: 0, y: 0, rot: 0, scale: 1, vx: 0, vy: 0, vr: 0, ...fields, tags, data }`
  where `tags` and `data` are copies. If `id` is absent it is `"e" + n` with a world counter `n`
  starting at 1, incremented only when an id is generated.
- **query(tag)** returns entities having that tag, in list order.
- **radius(e)** = local radius × `e.scale`.
- `state`, `data` and `tags` are plain JSON and MAY be mutated by systems and rules.

## 5. Simulation

- Time advances in fixed steps of `dt = 1 / fps` (default fps 60).
- **step**: (1) clear the event list; (2) run each system in order with `(game, dt)`; (3) `time += dt`,
  `frame += 1`; (4) clear `pressed`.
- **Input** is named actions. `press(a)`: if `a` is not held, add it to `pressed`; add it to `held`.
  `release(a)`: remove it from `held`. Input is applied between steps.
- **Events**: `emit(type, payload)` appends `{ type, frame, ...payload }` (frame = current frame,
  before increment). Events emitted in a step are visible to later systems in the same step.
- **RNG**: xorshift32 over an unsigned 32-bit state `s` (initial `seed >>> 0`, 0 replaced by 1):
  `s ^= s << 13; s ^= s >>> 17; s ^= s << 5` (all mod 2³²), returning `s / 2³²`.
  Games MUST NOT use any other randomness.

## 6. Rules

Rules are an expression language with JavaScript value semantics restricted to JSON values
(number, string, boolean, null, array, object) plus entity references (entities are objects).

### 6.1 Grammar

```
program  := stmt (';' stmt)*                 (a stmt ending in a block needs no ';')
stmt     := 'if' '(' expr ')' body ('else' body)? | 'let' NAME '=' expr | target ASSIGN expr | expr
body     := '{' program '}' | stmt
ASSIGN   := '=' | '+=' | '-=' | '*=' | '/='          target := NAME | postfix-member
expr     := or ('?' expr ':' expr)?
or       := and ('||' and)*        and := cmp ('&&' cmp)*
cmp      := sum (('=='|'!='|'<'|'<='|'>'|'>=') sum)?          (non-associative)
sum      := prod (('+'|'-') prod)*  prod := unary (('*'|'/'|'%') unary)*
unary    := ('-'|'!') unary | postfix
postfix  := primary ('.' NAME | '[' expr ']' | '(' args ')')*   (calls only on builtin names)
primary  := NUMBER | STRING | true | false | null | NAME | '(' expr ')' | '[' items ']' | '{' fields '}'
```

Strings use `'` or `"` with `\` escaping the next character. A rule's `do` is a program string or
an array of program strings joined with `;`. `when` is a single expression.

### 6.2 Semantics

- Arithmetic is IEEE-754 binary64. `+` concatenates if either side is a string, converting the
  other with **ToString** (§9.1; `true`, `false`, `null`). `/` by zero yields ±Infinity or NaN;
  `%` is truncated remainder (sign of the dividend).
- `==`/`!=` are strict (no coercion; objects compare by identity).
- Truthiness: `false`, `null`, `0`, `NaN`, `""` and undefined are falsy; everything else
  (including `[]`, `{}`) is truthy. `&&`/`||` short-circuit and return an operand.
- Names resolve to locals (`let`), then bound variables. Assigning an undeclared name is an error.
- Member access on a missing field yields undefined (falsy); `.length` works on arrays and strings.
  The fields `__proto__`, `prototype`, `constructor` are forbidden.
- Variables: `dt`, `frame`, `time`, `state`, `W`, `H`, `PI`, and per rule `self`, `a`, `b`, `event`.

### 6.3 Rule kinds (evaluated in array order, once per step, when the rules system runs)

| Rule | Runs |
|---|---|
| `{ do, when? }` | every step |
| `{ each: tag, do, when? }` | for each entity in `query(tag)` taken at rule start, skipping any despawned meanwhile; binds `self` |
| `{ on: "start", do }` | in the step where `frame == 0` |
| `{ on: "hit", tags?: [ta, tb], do }` | for each `hit` event so far this step (snapshot at rule start) whose `tags` equal `[ta, tb]`; binds `event`, `a`, `b`; skipped if either entity is gone |
| `{ on: type, do }` | for each event of `type` so far this step; binds `event` |

`when`, if present, is evaluated with the same bindings and skips `do` when falsy.

### 6.4 Builtins

`held(a)`, `pressed(a)`, `random()`, `rand(lo, hi) = lo + random()·(hi − lo)`,
`spawn(shape, fields?)` → entity, `despawn(e|id)`, `alive(e|id)`, `get(id)` (null if absent),
`all(tag)`, `first(tag)` (null if none), `count(tag)`, `has(e, tag)`, `tag(e, t)`, `untag(e, t)`,
`emit(type, payload?)`, `sound(name)` (emits `{type:"sound", name}`), `dist(a, b)`,
`abs`, `min`, `max`, `floor`, `ceil`, `round(v) = floor(v + 0.5)`, `sqrt`, `sign`,
`clamp(v, lo, hi)`, `lerp(a, b, t) = a + (b − a)·t`, `str(v)` (ToString), `len(v)` (0 for null),
and the implementation-tolerant `sin`, `cos`, `atan2`.

## 7. Systems

| Name | Behavior |
|---|---|
| `motion` | for each entity in order: if `drag`, `k = (1 − drag)^dt`, `vx *= k`, `vy *= k`; then `x += vx·dt`, `y += vy·dt`, `rot += vr·dt` |
| `wrap` | for each entity tagged `wrap`: `x < 0 → x += W` else `x ≥ W → x −= W`; same for `y`/`H` |
| `lifetime` | for each entity (snapshot) with `data.ttl`: `ttl −= dt`; despawn if `ttl ≤ 0` |
| `collide: [[ta, tb], ...]` | for each pair in order, for each `a` in `query(ta)`, each `b` in `query(tb)`, `a ≠ b`: emit `hit {a: a.id, b: b.id, tags: [ta, tb]}` if `(ax−bx)² + (ay−by)² < (ra + rb)²` |
| `collideOutline` (extended) | as `collide`, then only if transformed outlines intersect or contain each other |
| `rules` | §6 |

Implementations MAY use any broadphase but MUST emit events in exactly this order.

## 8. Numeric determinism

All core computation is binary64 using only operations IEEE-754 requires to be correctly
rounded: `+ − × ÷ sqrt`, comparisons, `floor`, `ceil`. These are bit-identical everywhere.

**Implementation-tolerant** operations — `sin`, `cos`, `atan2`, `acos`, `pow` with
non-integer exponents — are not correctly rounded in most math libraries and MAY differ in the
last bit. Features that depend on them (arcs, `drag`, camera rotation, parallax ≠ 1 with zoom,
outline collision, morphs, and rules calling trig) are deterministic *within* an implementation
(replays always match there) but are only guaranteed *visually* identical across
implementations. Games that need cross-implementation digests SHOULD avoid them in simulation.

## 9. The canonical frame

The canonical frame is an SVG string. Its digest identifies a world state; conformance means
producing it byte-for-byte.

### 9.1 Number formatting

- **ToString(x)**: ECMAScript `Number::toString` — shortest round-trip digits; integers below
  1e21 without a decimal point; exponent form (`1e-7`, `3e+21`) when the exponent is < −6 or ≥ 21;
  `-0` → `0`; `NaN`, `Infinity`, `-Infinity`.
- **R2(x)** = ToString(`floor(x·100 + 0.5) / 100`). **R1(x)** = ToString(`floor(x·10 + 0.5) / 10`).
- **F4(x)** = ToString of x rounded to 4 decimals from its exact binary value, ties away from zero
  (ECMAScript `toFixed(4)`), then parsed back to a number.

### 9.2 Structure

```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" width="W" height="H">
<rect width="100%" height="100%" fill="BACKGROUND"/>
<defs>SHAPES EXTRA</defs>ENTITIES HUD</svg>
```
(no whitespace between elements). W, H via ToString.

- **SHAPES**: for each shape in document order, `<g id="NAME">` + for each part i
  `<path d="ESC(d)" ATTRS(part, "NAME-i")/>` + `</g>`.
- **ATTRS(p, key)**: `fill="F" stroke="S"` where F is `url(#g-key)` for gradients, else the fill
  string or `none`; S the stroke string or `none`. Then ` stroke-width="ToString(width)"` if width
  is truthy; ` stroke-linejoin="round" stroke-linecap="round"` if stroke is truthy; for clips
  ` clip-path="url(#c-key)"`.
- **EXTRA**: gradient and clip definitions in first-use order, deduplicated by exact string:
  `<linearGradient id="g-key" gradientUnits="userSpaceOnUse" x1="…" y1="…" x2="…" y2="…">STOPS</linearGradient>`,
  `<radialGradient id="g-key" gradientUnits="userSpaceOnUse" cx="…" cy="…" r="…">STOPS</radialGradient>`,
  STOPS = `<stop offset="O" stop-color="C"/>` for stops sorted by offset (stable);
  `<clipPath id="c-key"><path d="CLIP"/></clipPath>`. The gradient definition is generated when the
  fill is serialized, the clip right after.
- **ENTITIES**: the draw list (§9.3). Inline geometry: `<path data-id="ID" d="ESC(d)" ATTRS(e, "e-ID") transform="T"/>`.
  Shapes: `<use href="#SHAPE" data-id="ID" transform="T"/>`. Entities with neither emit nothing.
- **T** without a camera: `translate(R2(x) R2(y)) rotate(R2(rot·180/π)) scale(R2(scale))`.
  With a camera: `matrix(a b c d e f)` with each value F4, of the full matrix (§9.4).
- **HUD** if `state.hud` is truthy: `<g transform="translate(12 24)" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`
  + `<path d="…"/>` per glyph stroke + `</g>`. Glyphs come from the built-in stroke font
  (`FONT` in `src/text.js`; 4×6 grid) at size 16: scale `s = 16/6`, advance `6s`; each stroke is
  `M R1(x0 + px·s) R1((py − 6)·s)` then `L…` per further point; unknown characters advance.
  Text is upper-cased first.
- **ESC** replaces `& < > "` with entities.

### 9.3 Draw list and culling

Entities sorted by `layer` (default 0, stable) only if any entity has a nonzero layer; hidden
entities removed; then culled: with `vz = 1` (no camera or `fixed`), `zoom` (parallax 1) or
`zoom^parallax`, `rad = (radius + pad)·|scale|·vz + 2 + (e.width ?? 0)`; cull if the entity's
screen position `(px, py)` satisfies `px + rad < 0 || py + rad < 0 || px − rad > W || py − rad > H`.

### 9.4 Camera

Entity matrix `[c, s, −s, c, x, y]` with `c = cos(rot)·scale`, `s = sin(rot)·scale`. With a camera
and an entity that is not `fixed`, `p = parallax ?? 1`, `z = zoom^p`, `ρ = rot·p`,
`cx = W/2 + (camera.x − W/2)·p`, `cy` likewise, `c' = cos(−ρ)·z`, `s' = sin(−ρ)·z`:
view = `[c', s', −s', c', W/2 − (c'·cx − s'·cy), H/2 − (s'·cx + c'·cy)]`, full = view × entity.
Without a camera, or for fixed entities, full = entity.

### 9.5 Digest

`hash64(svg)`: over UTF-16 code units `c` of the string,
`h1 = 0x811c9dc5`, `h2 = 0x01000193 ^ length`; for each `c`:
`h1 = (h1 ^ c) × 16777619 mod 2³²`; `h2 = ((h2 ^ c) × 2246822519 mod 2³²) ^ (h1 >>> 13)`.
Result: `h1` then `h2` as 8 lowercase hex digits each.

## 10. Recordings

```json
{ "vertex": 1, "scene": "path", "seed": 42, "fps": 60, "steps": 600, "digest": "…", "inputs": [[frame, "p"|"r", action], …] }
```

Replay: build the game with `seed` and `fps`; for `f = 0 … steps−1`, apply every input with
frame `f` in order, then step. The final canonical frame's digest MUST equal `digest`.

## 11. Links

A cartridge link is `PLAYER#c=CODE` where CODE is base64url (no padding) of the raw-DEFLATE
(RFC 1951) compression of the cartridge's UTF-8 JSON. Players MUST NOT execute anything but the
cartridge's declared systems and rules.

## 12. Extended features (informative)

The reference implementation additionally provides: Canvas2D and WebGL2 renderers, a pure-JS PNG
rasterizer, outline collision, path morphing and keyframes, a procedural shape kit, camera
rotation, synthesized sound (`sounds`) and note-string music, timelines (seek/branch), lockstep
multiplayer, an MCP server and a CLI. Their observable outputs other than §9 are not normative.
