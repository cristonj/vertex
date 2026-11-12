# CLI reference

`npx vertex <command>` inside a project (or `npx vertex-engine <command>` anywhere).

| Command | Does |
|---|---|
| `vertex new <name> [--template platformer\|topdown\|3d\|arcade]` | create a project |
| `vertex run <game> [--seed N] [--steps N] [--fps N] [--policy bot.js] [--svg f] [--png f] [--record r.json] [--json]` | run headless; `--json` prints the final snapshot |
| `vertex play <recording.json> [--at N] [--svg f] [--png f] [--width W]` | replay and verify (exit 1 on mismatch), or render frame N |
| `vertex diff <a.json> <b.json>` | first frame where two recordings diverge |
| `vertex link <game.json> [--base URL]` | print a URL containing the whole game |
| `vertex serve <game.json> [--port 8080] [--root DIR] [--seed N]` | multiplayer server; `/ws` WebSocket, `/status` JSON, static files from `--root` |
| `vertex schema [--out f]` | print the cartridge JSON Schema |
| `vertex mcp` | MCP server on stdio for AI clients |

`<game>` is a cartridge `.json` or a JS module exporting `createGame(opts)`.
A **policy** module default-exports `(game) => void`, called before each step to press/release actions.

```js
// bot.js: hold right, jump every second
export default (game) => {
  game.press('right');
  if (game.world.frame % 60 === 0) game.press('jump'); else game.release('jump');
};
```

Python runtime: `python py/vertex.py run <game.json> [--seed N] [--steps N] [--svg f]`,
`play <recording.json>`, `conform` (runs the conformance suite).
