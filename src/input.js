// Input adapters. Games read named actions (and one world-space pointer), never raw devices,
// so keyboard, mouse, touch, gamepad, an agent and a replay all drive the same interface.
// `target` is anything with press/release/point: a Game, a Timeline, or a Lockstep peer.

import { screenToWorld } from './view.js';

/**
 * Map keyboard keys to named actions.
 * @param {Record<string,string>} map e.g. { ArrowLeft: "left", " ": "fire" }
 */
export function bindKeys(target, map, el = globalThis) {
  const down = (ev) => {
    const a = map[ev.key] ?? map[ev.key.toLowerCase?.()];
    if (a && !ev.repeat) target.press(a);
    if (a) ev.preventDefault();
  };
  const up = (ev) => { const a = map[ev.key] ?? map[ev.key.toLowerCase?.()]; if (a) target.release(a); };
  const blur = () => { for (const a of new Set(Object.values(map))) target.release(a); }; // no stuck keys
  el.addEventListener('keydown', down);
  el.addEventListener('keyup', up);
  globalThis.addEventListener?.('blur', blur);
  return () => {
    el.removeEventListener('keydown', down); el.removeEventListener('keyup', up);
    globalThis.removeEventListener?.('blur', blur);
  };
}

/**
 * Mouse / touch / pen on a canvas -> world-space pointer + the "pointer" action.
 * `getWorld` returns the current world (worlds can be swapped by rewinds and scene loads).
 */
export function bindPointer(target, canvas, getWorld, { action = 'pointer' } = {}) {
  const toWorld = (ev) => {
    const r = canvas.getBoundingClientRect(), w = getWorld();
    const sx = ((ev.clientX - r.left) / r.width) * w.width, sy = ((ev.clientY - r.top) / r.height) * w.height;
    const [x, y] = screenToWorld(w, sx, sy);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; // compact replay logs
  };
  const move = (ev) => { const [x, y] = toWorld(ev); target.point(x, y); };
  const down = (ev) => { move(ev); canvas.setPointerCapture?.(ev.pointerId); target.press(action); ev.preventDefault(); };
  const up = (ev) => { move(ev); target.release(action); };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  return () => {
    canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
  };
}

/** Standard-mapping gamepad defaults: d-pad + left stick -> directions, face buttons -> actions. */
export const GAMEPAD_DEFAULTS = {
  buttons: { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'jump', 1: 'fire', 2: 'fire', 3: 'action', 9: 'start' },
  axes: { 0: ['left', 'right'], 1: ['up', 'down'] },
  deadzone: 0.35,
};

/**
 * Poll gamepads each animation frame and translate them into actions. Directions map onto
 * whatever the game already uses: pass `rename` (e.g. { jump: 'thrust' }) to fit a cartridge.
 */
export function bindGamepad(target, { buttons = GAMEPAD_DEFAULTS.buttons, axes = GAMEPAD_DEFAULTS.axes,
  deadzone = GAMEPAD_DEFAULTS.deadzone, rename = {} } = {}) {
  const held = new Set();
  let raf = 0;
  const name = (a) => rename[a] ?? a;
  const poll = () => {
    const want = new Set();
    let ax = 0, ay = 0;
    for (const pad of globalThis.navigator?.getGamepads?.() ?? []) {
      if (!pad) continue;
      if (Math.abs(pad.axes[0] ?? 0) > 0.12) ax = pad.axes[0];
      if (Math.abs(pad.axes[1] ?? 0) > 0.12) ay = pad.axes[1];
      for (const [i, a] of Object.entries(buttons)) if (pad.buttons[i]?.pressed) want.add(name(a));
      for (const [i, [neg, pos]] of Object.entries(axes)) {
        const v = pad.axes[i] ?? 0;
        if (v < -deadzone) want.add(name(neg)); else if (v > deadzone) want.add(name(pos));
      }
    }
    const q = (v) => Math.round(v * 20) / 20; // quantized: compact replays, no jitter spam
    target.axis?.('x', q(ax)); target.axis?.('y', q(ay));
    for (const a of want) if (!held.has(a)) { held.add(a); target.press(a); }
    for (const a of [...held]) if (!want.has(a)) { held.delete(a); target.release(a); }
    raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);
  return () => { cancelAnimationFrame(raf); for (const a of held) target.release(a); };
}

const DIRS = ['up', 'left', 'right', 'down'];
const GLYPH = { up: '▲', down: '▼', left: '◀', right: '▶' };

/**
 * On-screen touch controls generated from a cartridge's actions: a d-pad for direction
 * actions, round buttons for the rest. Returns a remove function. Uses pointer events, so
 * multi-touch works (hold left + jump).
 */
export function touchControls(target, actions, parent = document.body, { stick = true } = {}) {
  const uniq = [...new Set(actions)].filter((a) => a !== 'pointer');
  const dirs = DIRS.filter((d) => uniq.includes(d));
  const rest = uniq.filter((a) => !DIRS.includes(a)).slice(0, 4);
  const root = document.createElement('div');
  root.className = 'vx-touch';
  root.innerHTML = `<style>
    .vx-touch { position: fixed; inset: auto 0 0 0; display: flex; justify-content: space-between; align-items: flex-end;
      padding: 16px max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      pointer-events: none; user-select: none; -webkit-user-select: none; z-index: 10; }
    .vx-touch .pad { display: grid; grid-template: repeat(3, 52px) / repeat(3, 52px); gap: 4px; }
    .vx-touch .btns { display: flex; gap: 12px; flex-wrap: wrap-reverse; justify-content: flex-end; max-width: 50vw; }
    .vx-touch button { pointer-events: auto; touch-action: none; border: 1.5px solid #ffffff55; background: #ffffff14;
      color: #fff; font: 600 13px ui-monospace, monospace; border-radius: 12px; }
    .vx-touch button.on { background: #ffffff40; }
    .vx-touch .btns button { width: 68px; height: 68px; border-radius: 50%; }
  </style>`;
  const make = (action, label, style = '') => {
    const b = document.createElement('button');
    b.textContent = label; b.style.cssText = style; b.setAttribute('aria-label', action);
    const on = (ev) => { ev.preventDefault(); b.setPointerCapture?.(ev.pointerId); b.classList.add('on'); target.press(action); };
    const off = () => { b.classList.remove('on'); target.release(action); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    return b;
  };
  let pad;
  if (stick && (dirs.includes('left') || dirs.includes('right'))) pad = joystick(target, dirs);
  else {
    pad = document.createElement('div');
    pad.className = 'pad';
    const pos = { up: '1 / 2', left: '2 / 1', right: '2 / 3', down: '3 / 2' };
    for (const d of dirs) pad.append(make(d, GLYPH[d], `grid-area: ${pos[d]}`));
  }
  const btns = document.createElement('div');
  btns.className = 'btns';
  for (const a of rest) btns.append(make(a, a.slice(0, 5).toUpperCase()));
  root.append(pad, btns);
  parent.append(root);
  return () => root.remove();
}

/**
 * Analog virtual joystick: sets axes x/y in [-1, 1] and presses the matching direction actions
 * past a threshold, so analog and digital games both just work.
 */
function joystick(target, dirs, { size = 128, threshold = 0.4 } = {}) {
  const el = document.createElement('div');
  el.style.cssText = `pointer-events:auto;touch-action:none;width:${size}px;height:${size}px;border-radius:50%;border:1.5px solid #ffffff55;background:#ffffff10;position:relative`;
  const knob = document.createElement('div');
  knob.style.cssText = `position:absolute;left:50%;top:50%;width:${size * 0.42}px;height:${size * 0.42}px;margin:-${size * 0.21}px 0 0 -${size * 0.21}px;border-radius:50%;background:#ffffff40;border:1.5px solid #ffffff88`;
  el.append(knob);
  const held = new Set();
  const set = (x, y) => {
    const q = (v) => Math.round(v * 20) / 20;
    target.axis?.('x', q(x)); target.axis?.('y', q(y));
    knob.style.transform = `translate(${x * size * 0.3}px, ${y * size * 0.3}px)`;
    const want = new Set();
    if (x < -threshold && dirs.includes('left')) want.add('left');
    if (x > threshold && dirs.includes('right')) want.add('right');
    if (y < -threshold && dirs.includes('up')) want.add('up');
    if (y > threshold && dirs.includes('down')) want.add('down');
    for (const a of want) if (!held.has(a)) { held.add(a); target.press(a); }
    for (const a of [...held]) if (!want.has(a)) { held.delete(a); target.release(a); }
  };
  const move = (ev) => {
    const r = el.getBoundingClientRect();
    let x = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    set(x, y);
  };
  el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); el.setPointerCapture?.(ev.pointerId); move(ev); });
  el.addEventListener('pointermove', (ev) => { if (el.hasPointerCapture?.(ev.pointerId)) move(ev); });
  const stop = () => set(0, 0);
  el.addEventListener('pointerup', stop); el.addEventListener('pointercancel', stop); el.addEventListener('lostpointercapture', stop);
  return el;
}

/** True on devices whose primary input is touch. */
export const isTouchDevice = () => !!globalThis.matchMedia?.('(pointer: coarse)').matches;
