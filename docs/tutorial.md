# Tutorial

Build **Orbit Garden**: steer a ship, catch seeds, dodge comets. Four steps, each a complete
cartridge. Paste any of them into the [player](https://cristonj.github.io/vertex/play.html) or a
project's `game.json`. Every example here is tested in CI.

## 1. Fly

```json cartridge play
{
  "title": "Orbit Garden 1",
  "width": 400, "height": 300, "background": "#0b1020",
  "shapes": { "ship": { "d": "M12 0 L-8 -8 L-4 0 L-8 8 Z", "stroke": "#7df9ff", "width": 2 } },
  "entities": [{ "id": "ship", "shape": "ship", "x": 200, "y": 150, "drag": 0.8, "tags": ["ship", "wrap"] }],
  "keys": { "ArrowLeft": "left", "ArrowRight": "right", "ArrowUp": "thrust" },
  "systems": ["rules", "motion", "wrap"],
  "rules": [
    { "each": "ship", "when": "held('left')",   "do": "self.rot -= 4 * dt" },
    { "each": "ship", "when": "held('right')",  "do": "self.rot += 4 * dt" },
    { "each": "ship", "when": "held('thrust')", "do": "self.vx += cos(self.rot) * 300 * dt; self.vy += sin(self.rot) * 300 * dt" }
  ]
}
```

- Shapes are SVG path data around a `(0, 0)` pivot; rotation 0 faces +x; y points down.
- `keys` map to **actions**. Rules only see actions, so gamepads, touch, replays and agents all work.
- `systems` is the loop, in order. `each` binds `self` per tagged entity; `dt` is seconds per step.

## 2. Catch

```json cartridge play
{
  "title": "Orbit Garden 2",
  "width": 400, "height": 300, "background": "#0b1020",
  "shapes": {
    "ship": { "d": "M12 0 L-8 -8 L-4 0 L-8 8 Z", "stroke": "#7df9ff", "width": 2 },
    "seed": { "d": "M0 -6 Q6 0 0 6 Q-6 0 0 -6 Z", "fill": "#8f8" }
  },
  "entities": [{ "id": "ship", "shape": "ship", "x": 200, "y": 150, "drag": 0.8, "tags": ["ship", "wrap"] }],
  "state": { "score": 0 },
  "keys": { "ArrowLeft": "left", "ArrowRight": "right", "ArrowUp": "thrust" },
  "systems": ["motion", "wrap", { "collide": [["ship", "seed"]] }, "rules"],
  "rules": [
    { "on": "start", "do": "after(1, 'plant')" },
    { "on": "plant", "do": "spawn('seed', {x: rand(20, W - 20), y: rand(20, H - 20), vr: 1, tags: ['seed']}); after(1, 'plant')" },
    { "on": "hit", "tags": ["ship", "seed"], "do": "despawn(b); state.score += 1" },
    { "each": "ship", "when": "held('left')",   "do": "self.rot -= 4 * dt" },
    { "each": "ship", "when": "held('right')",  "do": "self.rot += 4 * dt" },
    { "each": "ship", "when": "held('thrust')", "do": "self.vx += cos(self.rot) * 300 * dt; self.vy += sin(self.rot) * 300 * dt" },
    { "do": "state.hud = 'SEEDS ' + str(state.score)" }
  ]
}
```

- `after(1, 'plant')` emits `plant` in one second; the `plant` rule reschedules itself: a repeating timer.
- `rand` is the seeded generator, so replays plant the same seeds.
- `collide` emits `hit` events. `rules` comes **after** it, because events only reach later systems.
- `state.hud` is drawn as on-screen text.

## 3. Danger, juice, game over

```json cartridge play
{
  "title": "Orbit Garden",
  "width": 400, "height": 300, "background": "#0b1020",
  "shapes": {
    "ship":  { "d": "M12 0 L-8 -8 L-4 0 L-8 8 Z", "stroke": "#7df9ff", "width": 2 },
    "seed":  { "d": "M0 -6 Q6 0 0 6 Q-6 0 0 -6 Z", "fill": "#8f8" },
    "comet": { "d": "M0 -9 L8 -3 L6 7 L-5 8 L-9 -2 Z", "fill": "#ff5d73" },
    "spark": { "d": "M-2 0 L2 0", "stroke": "#8f8", "width": 2 }
  },
  "sounds": {
    "ding": { "wave": "triangle", "freq": 660, "slide": 900, "decay": 0.15, "volume": 0.3 },
    "boom": { "wave": "noise", "freq": 800, "slide": -600, "decay": 0.5, "volume": 0.5 }
  },
  "state": { "score": 0, "best": 0 },
  "scenes": {
    "play": { "state": { "score": 0, "playing": true },
              "entities": [{ "id": "ship", "shape": "ship", "x": 200, "y": 150, "drag": 0.8, "tags": ["ship", "wrap"] }] },
    "over": { "state": { "playing": false },
              "entities": [{ "text": "GAME OVER", "size": 24, "x": 200, "y": 130, "stroke": "#ff5d73" },
                           { "text": "UP TO PLAY AGAIN", "size": 9, "x": 200, "y": 165 }] }
  },
  "keys": { "ArrowLeft": "left", "ArrowRight": "right", "ArrowUp": "thrust" },
  "systems": ["motion", "wrap", "particles", "lifetime", { "collide": [["ship", "seed"], ["ship", "comet"]] }, "rules"],
  "rules": [
    { "on": "start", "do": "goto('play')" },
    { "on": "scene", "when": "event.name == 'play'", "do": "after(1, 'plant'); after(3, 'comet')" },
    { "on": "plant", "when": "state.playing", "do": "spawn('seed', {x: rand(20, W - 20), y: rand(20, H - 20), vr: 1, tags: ['seed']}); after(1, 'plant')" },
    { "on": "comet", "when": "state.playing", "do": "spawn('comet', {x: -10, y: rand(0, H), vx: rand(60, 120), vr: 2, tags: ['comet'], data: {ttl: 8}}); after(max(0.6, 3 - state.score * 0.1), 'comet')" },
    { "on": "hit", "tags": ["ship", "seed"], "do": "despawn(b); state.score += 1; sound('ding'); spawn(null, {x: b.x, y: b.y, emitter: {shape: 'spark', burst: 12, rate: 0, life: [0.2, 0.5], speed: [40, 120]}, data: {ttl: 0.6}})" },
    { "on": "hit", "tags": ["ship", "comet"], "do": "sound('boom'); state.best = max(state.best, state.score); goto('over')" },
    { "when": "!state.playing && pressed('thrust')", "do": "goto('play')" },
    { "each": "ship", "when": "held('left')",   "do": "self.rot -= 4 * dt" },
    { "each": "ship", "when": "held('right')",  "do": "self.rot += 4 * dt" },
    { "each": "ship", "when": "held('thrust')", "do": "self.vx += cos(self.rot) * 300 * dt; self.vy += sin(self.rot) * 300 * dt" },
    { "do": "state.hud = 'SEEDS ' + str(state.score) + '   BEST ' + str(state.best)" }
  ]
}
```

- `sounds` are synth parameters; `sound('ding')` plays one.
- An `emitter` with `burst` sprays particles; `data.ttl` + `lifetime` removes things after N seconds.
- `goto('over')` swaps in the scene's entities and merges its `state` at the end of the step;
  a `scene` event arrives next step. `text` entities use the built-in vector font.

## 4. Test, share, go online

```js run
import { loadCartridge, Recorder, applyRecording, verifyReplay } from 'vertex-engine';
import { readFileSync } from 'node:fs';

const doc = JSON.parse(readFileSync(new URL('../examples/starfall/starfall.json', import.meta.url), 'utf8'));
const game = loadCartridge(doc, { seed: 1 });
const rec = new Recorder(game);
game.press('right');
game.step(600);                                   // 10 s of play, instantly
const run = rec.toJSON();                         // seed + input log + frame digest
verifyReplay(applyRecording(loadCartridge(doc, { seed: 1 }), run), run);   // throws on any difference
```

```bash
npx vertex link game.json                 # the whole game as a URL
npx vertex serve game.json --root .       # multiplayer: add a "multiplayer" block first
```

Next: [concepts](concepts.md) · [cookbook](cookbook.md) · [rules reference](reference/rules.md)
