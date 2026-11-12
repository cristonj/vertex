// Huge worlds: chunk streaming. The world is a grid of square chunks; only chunks near a
// "focus" entity (players, cameras) are awake. Everything else sleeps as plain JSON in
// `world.dormant`, costs nothing per step, and wakes up exactly as it was.
//
//   streaming: { chunk: 512, radius: 1, focus: "player", plane: "xy" | "xz", keep: ["ui"] }
//
// - Each step, chunks within `radius` (Chebyshev) of any entity tagged `focus` are active.
// - Entities outside active chunks are put to sleep (in entity order), except focus entities,
//   entities tagged with any `keep` tag, and `fixed` UI.
// - Sleeping chunks that become active wake (in ascending key order, entities in sleep order).
// - The first time a chunk becomes active, `chunkEnter {cx, cy, key, fresh: true}` fires so rules
//   can generate content; later visits fire `fresh: false`. Leaving fires `chunkLeave`.
// - Generation should use `hash(cx, cy, n)` / `noise(x, y, seed)`: pure arithmetic, so a world of
//   any size is reproducible from a seed in every implementation.
//
// All arithmetic is + - * / floor — core-level deterministic (SPEC.md §8).

export const chunkKey = (cx, cy) => `${cx},${cy}`;

function settings(w) {
  const s = w.streaming;
  return { chunk: s.chunk ?? 512, radius: s.radius ?? 1, focus: s.focus ?? 'player', plane: s.plane ?? 'xy', keep: s.keep ?? [] };
}

const coord = (e, plane) => (plane === 'xz' ? [e.x, e.z ?? 0] : [e.x, e.y]);

export function streaming(game) {
  const w = game.world;
  if (!w.streaming) return;
  const { chunk, radius, focus, plane, keep } = settings(w);
  w.dormant ??= {};
  w.seenChunks ??= [];
  w.activeChunks ??= [];
  const active = new Set();
  for (const f of w.query(focus)) {
    const [x, y] = coord(f, plane);
    const cx = Math.floor(x / chunk), cy = Math.floor(y / chunk);
    for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) active.add(chunkKey(cx + dx, cy + dy));
  }
  // sleep: everything outside the active set
  for (const e of [...w.entities]) {
    if (e.fixed || e.tags.includes(focus) || keep.some((t) => e.tags.includes(t))) continue;
    const [x, y] = coord(e, plane);
    const key = chunkKey(Math.floor(x / chunk), Math.floor(y / chunk));
    if (active.has(key)) continue;
    (w.dormant[key] ??= []).push(structuredClone({ ...e }));
    w.despawn(e);
  }
  // wake + enter/leave events
  const before = new Set(w.activeChunks), seen = new Set(w.seenChunks);
  const entering = [...active].filter((k) => !before.has(k)).sort(cmpKey);
  for (const key of entering) {
    const sleeping = w.dormant[key];
    if (sleeping) { for (const e of sleeping) w.spawn(e); delete w.dormant[key]; }
    const [cx, cy] = key.split(',').map(Number);
    game.emit('chunkEnter', { cx, cy, key, fresh: !seen.has(key), x: cx * chunk, y: cy * chunk, size: chunk });
    if (!seen.has(key)) { seen.add(key); w.seenChunks.push(key); }
  }
  for (const key of [...before].filter((k) => !active.has(k)).sort(cmpKey)) {
    const [cx, cy] = key.split(',').map(Number);
    game.emit('chunkLeave', { cx, cy, key });
  }
  if (entering.length || before.size !== active.size) w.activeChunks = [...active].sort(cmpKey); // re-sort only on change
}

const parsed = new Map();
const parseKey = (k) => { let v = parsed.get(k); if (!v) { const c = k.indexOf(','); v = [+k.slice(0, c), +k.slice(c + 1)]; if (parsed.size > 100000) parsed.clear(); parsed.set(k, v); } return v; };
function cmpKey(a, b) {
  const [ax, ay] = parseKey(a), [bx, by] = parseKey(b);
  return ax - bx || ay - by;
}

/** Deterministic hash of integers to [0, 1). Pure 32-bit arithmetic (xorshift-multiply). */
export function hash(a = 0, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1): bilinear with a smoothstep fade over integer lattice hashes. */
export function noise(x, y, seed = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Counts for dashboards and tests. */
export function streamingStats(world) {
  let sleeping = 0;
  for (const k in world.dormant ?? {}) sleeping += world.dormant[k].length;
  return { awake: world.entities.length, sleeping, activeChunks: world.activeChunks?.length ?? 0, seenChunks: world.seenChunks?.length ?? 0 };
}
