# JavaScript API reference

`import { … } from 'vertex-engine'` works in browsers and Node. `'vertex-engine/node'` adds
Node-only tools (marked **Node**). Full types: [`types/index.d.ts`](../../types/index.d.ts).
A CI test fails if any export is missing from this page.

## Run a game

| | |
|---|---|
| `loadCartridge(doc, {seed?, fps?})` → `Game` | build a game from a cartridge |
| `createPlayer({canvas, cartridge \| server, …})` → `Promise<Player>` | play in a page: input, touch, audio, rewind, inspector; or join a server |
| `isCartridge(doc)` | has `rules` or `systems` |
| `encodeCartridge(doc)` / `decodeCartridge(code)` → `Promise` | game ⇄ URL-safe string (`#c=` links) |
| `checkScene(doc)` → `[{path, message}]` · `assertValidScene(doc)` | validate a document |
| `createFrom(module, opts)` · `loadSceneModule(path)` | **Node** · load a `.json` cartridge or JS scene module |

## Game and world

| | |
|---|---|
| `new Game(doc \| world, {fps = 60, seed = 1})` | the simulation |
| `game.step(n = 1)` → events | advance fixed steps |
| `game.use(system)` | append `(game, dt) => void` |
| `game.press(a)` · `release(a)` · `point(x, y)` · `axis(name, v)` | input (recorded by `Recorder`/`Timeline`) |
| `game.emit(type, payload)` · `after(sec, type, payload)` · `goto(scene)` · `sound(name)` | events, timers, scenes, audio |
| `game.random()` | the seeded RNG; use it for all randomness |
| `game.snapshot()` · `toSVG()` · `toPNG({width, height})` | observe: JSON, SVG frame, PNG |
| `game.saveState()` / `loadState(s)` | full state as JSON, restored in place |
| `new World(doc)` | entities + shapes + state; `world.spawn(e)`, `despawn(e)`, `get(id)`, `query(tag)`, `radius(e)`, `toJSON()`, `restore(doc)` |
| `entityGeom(world, e)` | an entity's local polygons and bounds |
| `inlineD(e)` · `inlineStyle(e)` | an entity's own path (from `d` or `text`) and its paint |

## Built-in systems

| | |
|---|---|
| `systems.motion` · `systems.wrap` · `systems.lifetime` · `systems.collide(pairs)` | core behaviors (`systems` namespace) |
| `collideOutline(pairs)` | exact outline collision → `hit` |
| `physics` | bodies, gravity, contacts |
| `particles` | emitters |
| `streaming` | chunk sleep/wake |
| `interact` · `dialogue` | interactions, conversations |
| `motion3d` · `chaseCamera(id, opts)` · `collide3d(pairs)` | 3D |
| `follow(id, lerp)` | 2D camera follow |
| `animate.morph(dA, dB, t)` · `animate.morphAnim` · `animate.keyframes` | path morphing and keyframes (`animate` namespace) |

## Rules

| | |
|---|---|
| `compileRules(rules)` → system | compile a rules array |
| `parseRules(src)` | parse a program (syntax check) |
| `compileProgram(src)` · `compileExpression(src)` · `runInGame(game, fn, bindings)` | run rules code from JS |
| `interpolate(game, text, bindings)` | expand `{expr}` placeholders |
| `talk(game, id, {who, actor})` · `wrap(text, cols)` | start a dialogue · word-wrap |

## Queries and physics helpers

| | |
|---|---|
| `raycast(world, x, y, dx, dy, {max, tag, ignore})` | first outline hit → `{entity, x, y, distance}` |
| `pointQuery(world, x, y, {tag})` | entities under a point, topmost first |
| `nearest(world, x, y, tag)` | closest entity with a tag |
| `contact(a, b)` | collider contact `{nx, ny, depth}` |
| `outlinesOverlap(world, a, b)` · `outlinesTouch(polyA, polyB)` · `pointInPoly(p, poly)` · `entityPolys(world, e)` | geometry tests |
| `SpatialHash` · `forEachPair(world, tagA, tagB, fn)` | broadphase |
| `hash(a, b, c)` · `noise(x, y, seed)` | deterministic procedural values |
| `chunkKey(cx, cy)` · `streamingStats(world)` | streaming helpers |

## Rendering

| | |
|---|---|
| `autoRenderer(canvas)` → `Promise<Renderer>` | WebGL2, falling back to Canvas2D |
| `WebGLRenderer` · `CanvasRenderer` | `new X(canvas).draw(world)` |
| `toSVG(world, {hud, cull})` · `toPNG(world, {width, height})` | canonical SVG frame · PNG bytes |
| `encodePNG(rgb, w, h)` · `setDeflate(fn)` · `parseColor(css)` | PNG utilities |
| `view` | camera math namespace: `viewMatrix`, `fullMatrix`, `invert`, `apply`, `drawList`, … |
| `screenToWorld(world, x, y)` | screen → world coordinates |
| `projectSpace(world)` · `projectPoint(world, x, y, z)` · `meshOf(shape)` · `radius3d(world, e)` | 3D projection |
| `fanTriangles(polys)` · `strokeTriangles(polys, w)` · `coverQuad(polys)` | tessellation |

## Geometry and art

| | |
|---|---|
| `parsePath(d)` · `flatten(cmds)` · `bounds(polys)` | SVG path → commands → polygons → bounds |
| `textPath(str, size, {align})` · `textShape(str, size, style)` · `textWidth(str, size)` | vector text |
| `procedural.polygonShape` · `starShape` · `ringShape` · `blobShape(seed)` · `arrowShape` · `smoothClosed(pts)` | generated 2D shapes (`procedural` namespace) |
| `box` · `sphere` · `cylinder` · `plane` · `extrude(d, depth)` | 3D meshes |

## Input

| | |
|---|---|
| `bindKeys(target, map)` · `bindPointer(target, canvas, getWorld)` · `bindGamepad(target, opts)` | devices → actions; return an unbind function |
| `touchControls(target, actions)` · `isTouchDevice()` | on-screen d-pad/joystick and buttons |
| `GAMEPAD_DEFAULTS` · `gamepadRename(actions)` | gamepad mapping |

`target` is anything with `press`/`release` (and optionally `point`/`axis`): a `Game`, `Timeline`, `NetClient` or `Lockstep`.

## Time and replays

| | |
|---|---|
| `new Recorder(game)` → `.toJSON(extra)` | record inputs from a fresh game |
| `applyRecording(game, rec)` · `applyInput(game, input)` · `verifyReplay(game, rec)` | replay and verify |
| `digest(game)` · `hash64(str)` | frame digest |
| `new Timeline(factory, {seed, every})` | `step`, `seek`, `rewind`, `branch`, `toRecording` |
| `divergence(factory, recA, recB)` | first differing frame |

## Multiplayer

| | |
|---|---|
| `new GameServer(cartridge, {seed, fps})` | authoritative server: `connect(conn)`, `step()`, `stats` |
| `serve({cartridge, port, root})` | **Node** HTTP + WebSocket host with a fixed-rate loop |
| `NetClient.connect(url, {name})` | client: `frame(dt)` → world to draw, `press`/`release`/`point`/`axis`, `me` |
| `pipe()` | in-memory connection pair (tests, bots) |
| `acceptWebSockets(httpServer, onConnection)` · `connectWebSocket(url)` | **Node** zero-dependency WebSocket |
| `new Lockstep(game, {id, peers, transport})` · `memoryTransport()` · `broadcastTransport(name)` · `held(game, player, action)` | input-only lockstep for small peer groups |

## Audio

| | |
|---|---|
| `attachAudio(game)` | play `sound` events in the browser |
| `synth(params)` · `sequence(score, {bpm, voice})` · `noteFreq(note)` · `toWAV(samples)` · `SAMPLE_RATE` | synthesis to samples / WAV |

## Tools

| | |
|---|---|
| `scaffold(name, {template})` | **Node** create a project (`vertex new`) |
| `compileRules`, `checkScene`, `toSVG` | the building blocks agents use most |
