# Getting started

## Install

```bash
npx vertex-engine new mygame --template platformer
cd mygame
npm install
npm start          # http://localhost:8080
npm test           # headless checks: the game runs and replays exactly
```

Templates: `platformer` (physics, scenes, particles), `topdown` (endless streamed world, NPC
dialogue, multiplayer-ready), `3d` (meshes, chase camera), `arcade` (the smallest complete game).

Or add the engine to an existing project:

```bash
npm install vertex-engine
```

```js
import { createPlayer } from 'vertex-engine';
const cartridge = await (await fetch('game.json')).json();
await createPlayer({ canvas: document.querySelector('canvas'), cartridge });
```

Requirements: Node 20.11+ for tooling and servers; any modern browser (WebGL2, falling back to Canvas2D).

## The shape of a game

A game is one JSON document, a **cartridge**:

```jsonc
{
  "title": "My game", "width": 480, "height": 270,
  "shapes":   { "hero": { "d": "M-8 -12 H8 V12 H-8 Z", "fill": "#ffcf5a" } },   // SVG path data
  "entities": [{ "id": "player", "shape": "hero", "x": 60, "y": 200, "tags": ["player"], "body": {} }],
  "keys":     { "ArrowLeft": "left", "ArrowRight": "right", " ": "jump" },      // keys -> actions
  "systems":  ["motion", "physics", "rules"],                                    // order matters
  "rules": [                                                                     // game logic
    { "each": "player", "do": "self.vx = ((held('right') ? 1 : 0) - (held('left') ? 1 : 0)) * 200" },
    { "each": "player", "when": "pressed('jump') && self.body.ground", "do": "self.vy = -500" }
  ]
}
```

- **Shapes** are SVG paths (2D), meshes or extrusions (3D). Nothing is a bitmap.
- **Entities** are plain JSON objects: position, velocity, tags, `data` for your own fields.
- **Systems** are the built-in behaviors: `motion`, `physics`, `collide`, `streaming`, `particles`,
  `dialogue`, `interact`, `follow`, `motion3d`, `chase`, … and `rules` (your logic).
- **Rules** are a small sandboxed language (SPEC.md §6): `each` tag, `when` condition, `do`
  statements; `on` events such as `hit`, `contact`, `chunkEnter`, `scene`, timers.

## Workflow

| Task | Command |
|---|---|
| Play locally | `npm start` |
| Inspect / edit live | press <kbd>`</kbd> in the player: pause, scrub time, click entities, edit JSON, hot-reload |
| Rewind | hold <kbd>R</kbd> |
| Run headless | `npx vertex run game.json --steps 600 --svg frame.svg` |
| Record and replay | `npx vertex run game.json --policy bot.js --record run.json` · `npx vertex play run.json` |
| Compare two runs | `npx vertex diff a.json b.json` |
| Share | `npx vertex link game.json` (the whole game in a URL) |
| Multiplayer | `npm start`, then open `/?online` in several tabs (see multiplayer.md) |
| Let an AI play | `npx vertex mcp` (MCP server for Claude and other clients) |

## Guides

- [Multiplayer and MMO servers](multiplayer.md)
- [Huge worlds, dialogue and interactions](worlds.md)
- [3D](3d.md)
- The full format: [SPEC.md](../SPEC.md) · Agents: [AGENTS.md](../AGENTS.md)
