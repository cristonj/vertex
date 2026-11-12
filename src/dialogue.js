// Dialogue and interaction, as data — single-player and multiplayer.
//
// Dialogue trees live in the cartridge:
//   dialogue: {
//     ana: { start: "hi", nodes: {
//       hi:   { speaker: "Ana", text: "Hello! You have {state.gold} gold.", do: "state.metAna = true",
//               choices: [ { text: "Buy a map (5g)", when: "state.gold >= 5", do: "state.gold -= 5", goto: "thanks" },
//                          { text: "Bye", goto: null } ] },
//       thanks: { speaker: "Ana", text: "Safe travels.", next: null } } } }
// - `text` / choice text support {expr} interpolation (rules expressions). Bindings: `npc` (the
//   entity spoken to), `actor` (the player entity, or null in single-player).
// - `do` runs on entering a node; a choice's `do` runs when picked; `when` hides choices.
// - `next` (no choices) advances on confirm; `goto: null` / `next: null` ends the conversation.
// - Conversation state is plain data: on the player entity (`actor.data.dialogue`) when there is an
//   actor, else in `state.dialogue`. It saves, rewinds, replays and syncs like everything else.
//
// Interactions: entities with `interact: { radius?: 48, prompt?: "Talk", dialogue?: "ana",
// do?: "rules program", once?: false, plane?: "xy"|"xz" }`. For every focus entity (players), the
// nearest one in reach is stored in `focus.data.interactTarget`; the "interact" action starts its
// dialogue or runs `do` (self = interactable, actor = focus) and emits `interact {a, b}`.
//
// Input: up/down choose; confirm / interact / pointer taps advance and pick. In multiplayer,
// input is read from the actor's own namespace (see `inputOwner` in rules.js).
// UI: drawn as fixed entities (tag "ui") by `dialogueUI` — locally only; a server (game.server)
// never spawns UI, and network clients draw their own player's dialogue.

import { compileProgram, compileExpression, runInGame, interpolate, withOwner } from './rules.js';
import { viewMatrix, apply } from './view.js';

const progCache = new Map(), exprCache = new Map();
const prog = (src) => { const k = Array.isArray(src) ? src.join(';') : src; let f = progCache.get(k); if (!f) progCache.set(k, (f = compileProgram(k))); return f; };
const expr = (src) => { let f = exprCache.get(src); if (!f) exprCache.set(src, (f = compileExpression(src))); return f; };

const DEFAULTS = { speed: 45, size: 10, margin: 12, height: 0.34, panel: '#0b0d12e6', border: '#7df9ff', textColor: '#e8ecf3', speakerColor: '#7df9ff', choiceColor: '#c8ccd4', activeColor: '#ffcf5a' };
const styleOf = (w) => ({ ...DEFAULTS, ...(w.dialogueStyle ?? {}) });

// ---- state holders (actor entity, or world.state for single-player) ----

const getD = (w, actor) => (actor ? actor.data.dialogue ?? null : w.state.dialogue ?? null);
const setD = (w, actor, d) => { if (actor) actor.data.dialogue = d; else w.state.dialogue = d; };
const ownerOf = (actor) => actor?.data?.player ?? null;
// `actor` is the player who is talking: the holder in multiplayer, or d.actor (single-player).
const bind = (game, actor, d) => ({
  npc: d?.who ? game.world.get(d.who) ?? null : null,
  actor: actor ?? (d?.actor ? game.world.get(d.actor) ?? null : null),
});

/** Start a conversation. `who`: the entity spoken to. `actor`: the player entity (multiplayer). */
export function talk(game, id, { who = null, actor = null, node = null, holder = undefined } = {}) {
  const tree = game.world.dialogue?.[id];
  if (!tree) throw new Error(`unknown dialogue "${id}"`);
  const a = typeof actor === 'string' ? game.world.get(actor) : actor;
  // multiplayer (actor owned by a player): state lives on the actor; single-player: in world.state
  const h = holder !== undefined ? holder : a?.data?.player != null ? a : null;
  enter(game, h, { id, node: node ?? tree.start ?? Object.keys(tree.nodes)[0], who, actor: a?.id ?? null, opened: game.world.frame });
}

function enter(game, actor, d) {
  const w = game.world, n = w.dialogue[d.id].nodes[d.node];
  if (!n) throw new Error(`dialogue "${d.id}" has no node "${d.node}"`);
  const next = { id: d.id, node: d.node, who: d.who ?? null, actor: d.actor ?? actor?.id ?? null, choice: 0, shown: 0, opened: d.opened ?? w.frame };
  setD(w, actor, next);
  game.emit('dialogue', { id: d.id, node: d.node, who: next.who, actor: actor?.id ?? null });
  if (n.do) runInGame(game, prog(n.do), bind(game, actor, next));
}

function end(game, actor) {
  const w = game.world, d = getD(w, actor);
  setD(w, actor, null);
  if (d) game.emit('dialogueEnd', { id: d.id, node: d.node, who: d.who, actor: actor?.id ?? null });
}

function visibleChoices(game, actor, d, n) {
  return (n.choices ?? []).map((c, i) => ({ ...c, i })).filter((c) => !c.when || runInGame(game, expr(c.when), bind(game, actor, d)));
}

/** Wrap text to lines of at most `cols` characters (the stroke font is monospace). */
export function wrap(text, cols) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + (line ? ' ' : '') + word).length > cols && line) { out.push(line); line = word; }
      else line += (line ? ' ' : '') + word;
    }
    out.push(line);
  }
  return out;
}

function layout(game, actor, d, n, choices) {
  const w = game.world, o = styleOf(w);
  const H = Math.round(w.height * o.height), y0 = w.height - H - o.margin, x0 = o.margin, W = w.width - o.margin * 2;
  const cols = Math.max(8, Math.floor((W - 24) / o.size));
  const b = bind(game, actor, d);
  const text = interpolate(game, n.text ?? '', b);
  return { o, x0, y0, W, H, text, lines: wrap(text, cols), lineH: o.size * 1.6, labels: choices.map((c) => interpolate(game, c.text ?? '...', b)) };
}

const screenPointer = (game, owner) => {
  const p = owner ? game.pointers?.[owner] ?? { x: 0, y: 0 } : game.pointer;
  return apply(viewMatrix(game.world, null), p.x, p.y);
};

function stepConversation(game, actor, dt) {
  const w = game.world, d = getD(w, actor);
  const n = w.dialogue?.[d.id]?.nodes?.[d.node];
  if (!n) { end(game, actor); return; }
  const owner = ownerOf(actor);
  const pressed = (a) => game.pressed.has(owner ? `${owner}:${a}` : a);
  const choices = visibleChoices(game, actor, d, n);
  const L = layout(game, actor, d, n, choices);
  const total = L.text.length;
  d.shown = Math.min(total, d.shown + L.o.speed * dt);
  const done = d.shown >= total;
  let tapped = -1, tapBox = false;
  if (pressed('pointer')) {
    const [px, py] = screenPointer(game, owner);
    if (px >= L.x0 && px <= L.x0 + L.W && py >= L.y0 && py <= L.y0 + L.H) {
      tapBox = true;
      const top = L.y0 + 30 + L.lines.length * L.lineH;
      choices.forEach((_, i) => { const cy = top + i * L.lineH; if (py >= cy - L.lineH * 0.8 && py <= cy + L.lineH * 0.3) tapped = i; });
    }
  }
  if (choices.length) {
    if (pressed('up')) d.choice = (d.choice + choices.length - 1) % choices.length;
    if (pressed('down')) d.choice = (d.choice + 1) % choices.length;
    if (tapped >= 0 && done) d.choice = tapped;
  }
  const confirm = pressed('confirm') || pressed('interact') || tapBox;
  if (!confirm || d.opened === w.frame) return;
  if (!done) { d.shown = total; return; } // first press reveals the whole line
  if (choices.length) {
    const c = choices[Math.min(d.choice, choices.length - 1)];
    if (c.do) runInGame(game, prog(c.do), bind(game, actor, d));
    game.emit('choice', { id: d.id, node: d.node, choice: c.i, who: d.who, actor: actor?.id ?? null });
    if (c.goto == null) end(game, actor); else enter(game, actor, { ...d, node: c.goto });
  } else if (n.next == null) end(game, actor);
  else enter(game, actor, { ...d, node: n.next });
}

/** System: advances every active conversation; draws the UI unless running on a server. */
export function dialogue(game, dt) {
  const w = game.world;
  if (w.state.dialogue) withOwner(game, null, () => stepConversation(game, null, dt));
  for (const e of w.entities) if (e.data?.dialogue) stepConversation(game, e, dt);
  if (!game.server) dialogueUI(game, w.state.dialogue ? null : w.query(w.interaction?.focus ?? 'player').find((p) => p.data?.dialogue) ?? null);
}

/** Draw (or clear) the dialogue box for one holder as fixed UI entities. */
export function dialogueUI(game, actor = null) {
  const w = game.world;
  for (const e of w.query('ui:dialogue')) w.despawn(e);
  const d = getD(w, actor);
  if (!d) return;
  const n = w.dialogue?.[d.id]?.nodes?.[d.node];
  if (!n) return;
  const choices = visibleChoices(game, actor, d, n);
  const L = layout(game, actor, d, n, choices), { o, x0, y0, W, H } = L;
  const done = d.shown >= L.text.length;
  const ui = (fields) => w.spawn({ fixed: true, layer: 1000, tags: ['ui', 'ui:dialogue'], ...fields });
  ui({ d: `M${x0} ${y0} H${x0 + W} V${y0 + H} H${x0} Z`, fill: o.panel, stroke: o.border, width: 1.5, x: 0, y: 0, layer: 999 });
  if (n.speaker) ui({ text: interpolate(game, String(n.speaker), bind(game, actor, d)).toUpperCase(), size: o.size, align: 'left', x: x0 + 12, y: y0 + 18, stroke: o.speakerColor });
  let left = Math.floor(d.shown);
  L.lines.forEach((line, i) => {
    const part = line.slice(0, Math.max(0, left));
    left -= line.length + 1;
    if (part) ui({ text: part, size: o.size, align: 'left', x: x0 + 12, y: y0 + 18 + (i + 1) * L.lineH, stroke: o.textColor });
  });
  if (!done) return;
  const top = y0 + 30 + L.lines.length * L.lineH;
  choices.forEach((c, i) => {
    const on = i === Math.min(d.choice, choices.length - 1);
    ui({ text: `${on ? '>' : ' '} ${L.labels[i]}`, size: o.size, align: 'left', x: x0 + 12, y: top + i * L.lineH, stroke: on ? o.activeColor : o.choiceColor });
  });
  if (!choices.length) ui({ text: n.next == null ? '[END]' : '[NEXT]', size: o.size * 0.8, align: 'right', x: x0 + W - 10, y: y0 + H - 8, stroke: o.choiceColor });
}

/** System: proximity interactions for every focus entity (all players). */
export function interact(game) {
  const w = game.world;
  const focusTag = w.interaction?.focus ?? 'player';
  const focuses = w.query(focusTag);
  const multi = focuses.some((f) => f.data?.player != null);
  const interactables = w.entities.filter((e) => e.interact && !e.interact.disabled);
  // grid the interactables (cell = largest radius) so N players x M NPCs stays ~O(N + M)
  let cell = 48;
  for (const e of interactables) cell = Math.max(cell, e.interact.radius ?? 48);
  const grid = new Map(), co = (e, it) => [e.x, it?.plane === 'xz' ? e.z ?? 0 : e.y];
  for (const e of interactables) {
    const [x, y] = co(e, e.interact), k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const l = grid.get(k); if (l) l.push(e); else grid.set(k, [e]);
  }
  const near = (f) => {
    const out = [];
    for (const plane of ['xy', 'xz']) {
      const x = f.x, y = plane === 'xz' ? f.z ?? 0 : f.y, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const e of grid.get(`${cx + dx},${cy + dy}`) ?? []) if ((e.interact.plane === 'xz') === (plane === 'xz')) out.push(e);
    }
    return out.sort((a, b) => interactables.indexOf(a) - interactables.indexOf(b));
  };
  for (const focus of focuses) {
    const owner = ownerOf(focus);
    const busy = multi ? focus.data.dialogue : w.state.dialogue;
    let best = null, bd = Infinity;
    if (!busy) for (const e of near(focus)) {
      const it = e.interact, r = it.radius ?? 48;
      const dx = e.x - focus.x, dy = it.plane === 'xz' ? (e.z ?? 0) - (focus.z ?? 0) : e.y - focus.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r && d2 < bd) { bd = d2; best = e; }
    }
    focus.data.interactTarget = best?.id ?? null;
    if (!best) continue;
    const pressed = (a) => game.pressed.has(owner ? `${owner}:${a}` : a);
    let tap = false;
    if (pressed('pointer')) {
      const o = styleOf(w), [px, py] = screenPointer(game, owner), label = promptLabel(best);
      tap = Math.abs(px - w.width / 2) < label.length * o.size * 0.6 && Math.abs(py - (w.height - 24)) < o.size * 1.5;
    }
    if (pressed('interact') || tap) {
      const it = best.interact;
      game.emit('interact', { a: focus.id, b: best.id });
      if (it.dialogue) talk(game, it.dialogue, { who: best.id, actor: focus, holder: multi ? focus : null });
      if (it.do) withOwner(game, owner, () => runInGame(game, prog(it.do), { self: best, actor: focus }));
      if (it.once) it.disabled = true;
    }
  }
  if (!game.server) promptUI(game, multi ? null : focuses[0] ?? null);
}

const promptLabel = (e) => `[E] ${e.interact.prompt ?? 'Interact'}`;

/** Draw (or clear) the interaction prompt for one focus entity as fixed UI. */
export function promptUI(game, focus) {
  const w = game.world;
  for (const e of w.query('ui:prompt')) w.despawn(e);
  const target = focus?.data?.interactTarget && w.get(focus.data.interactTarget);
  if (!target?.interact || (focus.data.dialogue ?? w.state.dialogue)) return;
  const o = styleOf(w);
  w.spawn({ fixed: true, layer: 1000, tags: ['ui', 'ui:prompt'], text: promptLabel(target), size: o.size, x: w.width / 2, y: w.height - 20, stroke: o.activeColor });
}
