# Cookbook

Copy, adapt. Every code block below compiles in CI.

## Movement

8-way top-down movement (keys + analog stick/joystick):

```json rules
{ "each": "player", "do": "let mx = axis('x') + (held('right') ? 1 : 0) - (held('left') ? 1 : 0); let my = axis('y') + (held('down') ? 1 : 0) - (held('up') ? 1 : 0); let l = sqrt(mx * mx + my * my); if (l > 1) { mx = mx / l; my = my / l } self.vx = mx * 160; self.vy = my * 160" }
```

Platformer run + variable-height jump (needs `physics`):

```json rules
[
  { "each": "player", "do": "let d = (held('right') ? 1 : 0) - (held('left') ? 1 : 0); self.vx = self.vx + (d * 220 - self.vx) * min(1, 12 * dt)" },
  { "each": "player", "when": "pressed('jump') && self.body.ground", "do": "self.vy = -520" },
  { "each": "player", "when": "!held('jump') && self.vy < -200", "do": "self.vy = -200" }
]
```

Face the movement direction: `"do": "if (abs(self.vx) + abs(self.vy) > 1) self.rot = atan2(self.vy, self.vx)"`.

## Spawning

Repeating timer, faster as the score rises:

```json rules
[
  { "on": "start", "do": "after(1, 'spawn')" },
  { "on": "spawn", "do": "spawn('enemy', {x: rand(0, W), y: -10, vy: 80, tags: ['enemy'], data: {ttl: 10}}); after(max(0.3, 2 - state.score * 0.05), 'spawn')" }
]
```

A burst of particles at a point: `spawn(null, {x: b.x, y: b.y, emitter: {shape: 'spark', burst: 12, rate: 0, life: [0.2, 0.5]}, data: {ttl: 0.6}})`.

## Combat

Health, damage, invulnerability frames:

```json rules
[
  { "on": "hit", "tags": ["player", "enemy"], "when": "a.data.iframes <= 0", "do": "a.data.hp -= 1; a.data.iframes = 1; despawn(b); if (a.data.hp <= 0) goto('over')" },
  { "each": "player", "do": "self.data.iframes = max(0, self.data.iframes - dt); self.hidden = self.data.iframes > 0 && floor(time * 20) % 2 == 0" }
]
```

Shoot toward the pointer:

```json rules
{ "each": "player", "when": "pressed('pointer')", "do": "let dx = pointer.x - self.x; let dy = pointer.y - self.y; let l = sqrt(dx * dx + dy * dy); spawn('bullet', {x: self.x, y: self.y, vx: dx / l * 400, vy: dy / l * 400, rot: atan2(dy, dx), tags: ['bullet'], data: {ttl: 1}})" }
```

## Game flow

Pause with a key (`systems` keep running; gate your rules):

```json rules
[
  { "when": "pressed('pause')", "do": "state.paused = !state.paused" },
  { "each": "player", "when": "!state.paused", "do": "self.x += self.vx * dt" }
]
```

Levels: put each in `scenes`, then `goto('level2')`. Restart: `goto(state.scene)`.
High score that survives restarts: keep it in top-level `state` (scenes merge, they don't reset).

## World

Line of sight: `"when": "raycast(self.x, self.y, p.x - self.x, p.y - self.y, dist(self, p), 'wall') == null"` (with `let p = first('player')` earlier in `do`, or a `when` on a per-step rule).

Procedural chunk content (needs `streaming`):

```json rules
{ "on": "chunkEnter", "when": "event.fresh", "do": "repeat (8) { let x = event.x + hash(event.cx, event.cy, i) * event.size; let y = event.y + hash(event.cx, event.cy, 100 + i) * event.size; if (noise(x / 200, y / 200, 1) > 0.5) spawn('tree', {x: x, y: y, body: {static: true}}) }" }
```

## UI

Per-player HUD that also works online: set `self.data.hud` in an `each` rule; for single-player add
`{ "do": "state.hud = first('player').data.hud" }`.

Floating text: `spawn(null, {text: '+10', size: 10, x: b.x, y: b.y, vy: -30, stroke: '#ffd166', data: {ttl: 0.8}})`.

A talking NPC: give the entity `"interact": {"prompt": "Talk", "dialogue": "elder"}` and add
`"interact"`, `"dialogue"` to `systems` (see [worlds](worlds.md#dialogue)).
