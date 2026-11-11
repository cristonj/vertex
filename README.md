# Vertex

**A vector-native, agent-first game engine.** Every asset is an SVG path. Every scene is JSON.
Humans and AI agents drive it through the same API.

- 🪶 **Tiny** — zero dependencies, ~15 KB of readable source. Sprites are tens of bytes, not kilobytes.
- 📐 **Infinite resolution** — vector art renders crisp at any size or DPI.
- 🤖 **Agent-first** — run headless in Node, step the sim, read JSON snapshots, render frames as SVG text.
- 🎯 **Deterministic** — fixed timestep + seeded RNG. Same seed + inputs = same game, every time.

See [VISION.md](VISION.md) for the why and the roadmap. Agents: start with [AGENTS.md](AGENTS.md).

## Quick start

```bash
git clone https://github.com/cristonj/vertex && cd vertex
npm test                      # run the engine tests
npm run play:agent            # an AI-style policy plays Drift headless, writes last-frame.svg
npm run serve                 # then open http://localhost:3000/examples/drift/
```

## A whole game in one object

```js
import { Game, CanvasRenderer, bindKeys, systems } from 'vertex-engine';

const game = new Game({
  width: 800, height: 600, background: '#111',
  shapes: {
    ship: { d: 'M14 0 L-10 -9 L-5 0 L-10 9 Z', stroke: '#7df9ff', width: 2 },
  },
  entities: [{ id: 'ship', shape: 'ship', x: 400, y: 300, vr: 1, tags: ['wrap'] }],
});

game.use(systems.motion).use(systems.wrap);
game.run(new CanvasRenderer(document.querySelector('canvas')));  // browser
// or headless:  game.step(60); console.log(game.snapshot(), game.toSVG());
```

## Core concepts

| Concept    | What it is |
|------------|------------|
| **Shape**  | `{ d, fill?, stroke?, width? }` or `{ parts: [...] }` — raw SVG path data, parsed once. |
| **Entity** | `{ id, shape, x, y, rot, scale, vx, vy, vr, tags, data }` — plain data. |
| **World**  | Shapes + entities + `state`. Round-trips via `toJSON()`. |
| **System** | `(game, dt) => void`. Runs every fixed step, in order. |
| **Action** | Named input (`"fire"`). Keyboard binds to actions; agents call `game.press()`. |
| **Event**  | `game.emit(type, payload)`; `game.step()` returns the events that fired. |

## License

MIT
