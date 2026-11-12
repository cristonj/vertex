# Multiplayer and MMO servers

Any cartridge can be served to many players. The server runs the authoritative simulation; clients
send only input and receive what is near them.

```bash
npx vertex serve game.json --port 8080 --root .
# players open http://host:8080/?online   (scaffolded projects)  or  /play.html?server=auto
# status: http://host:8080/status
```

## Make a cartridge multiplayer

Add a `multiplayer` block. Your single-player rules usually need no changes:

```jsonc
"multiplayer": {
  "player": { "shape": "hero", "tags": ["player"], "body": {}, "data": { "gold": 0 } },  // each joiner
  "spawn": { "x": 160, "y": 160, "spread": 60 },
  "interest": 480,              // each client receives only entities within this radius
  "publicData": ["name", "hp"], // data keys other players can see (own player sees everything)
  "sendRate": 20                // snapshots per second
}
```

How existing rules keep working: each player gets an id (`p1`, `p2`, …) and an entity with
`data.player`. When a rule runs for that entity (`each` → `self`, or `a` in `hit`/`contact`),
`held()`, `pressed()`, `axis()` and `pointer` read **that player's** input. So
`{ "each": "player", "when": "held('left')", ... }` moves every player by their own keys.

Things to keep per player: store them on the player entity's `data` (gold, inventory, quest
flags), not in global `state`. Show a per-player HUD by setting `self.data.hud`; clients display
their own. Dialogue state automatically lives on the player in multiplayer, and each client draws
only its own dialogue box.

Events: `{ "on": "join", "do": "..." }` / `"leave"` with `event.player`, `event.entity`.

## Scale

- **Interest management**: clients only receive entities within `interest` of their player.
- **Deltas**: only changed fields are sent; unchanged entities cost nothing.
- **Shared encoding**: each entity's change is encoded once per tick and reused for every client.
- **Dead reckoning**: moving things are re-sent only when they deviate from their predicted path
  (`epsilon`, default 0.5 units) or change velocity. Clients integrate velocities between snapshots.
- **Client-side cosmetics**: particles never cross the network; clients run emitters locally.
- **Streaming**: with `streaming`, only chunks near players are simulated at all.

Measured (one Node process, `test/net.test.js`): 500 players spread over an endless streamed
world, ~24,000 awake entities, physics and rules: ~54 ms per tick including all snapshots, ~300
bytes per player per snapshot. For more players, run the server at a lower `fps`, raise
`sendRate` intervals, or shard the world across processes by region (each `GameServer` is
independent; route players by position).

## Embedding the server

```js
import { serve, GameServer } from 'vertex-engine/node';
const { url, server, stop } = await serve({ cartridge, port: 8080, root: 'public' });

// or bring your own transport (anything with send(text) and on('message'|'close'))
const game = new GameServer(cartridge, { seed: 1, fps: 30 });
wss.on('connection', (socket) => game.connect(adapt(socket)));
setInterval(() => game.step(), 1000 / 30);
```

Clients: `createPlayer({ canvas, server: 'wss://host/ws' })` or the lower-level
`NetClient.connect(url)` which you can drive with `bindKeys`, `touchControls`, etc.

## Limits (honest)

- No client-side prediction of the local player yet: input round-trips (~1 RTT + up to one snapshot
  interval). Fine for exploration, social and RPG games; fast twitch shooters will feel latency.
- No built-in persistence or accounts: save `server.game.saveState()` / per-player `data` yourself.
- No lag compensation or anti-cheat beyond server authority and input validation.
- One process simulates one world; sharding across processes is up to you.
