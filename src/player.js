// Embeddable player: run a cartridge (or join a server) on a canvas with keyboard, pointer,
// gamepad, touch controls, audio, rewind and the inspector. play.html is a thin shell over this.
//
//   import { createPlayer } from 'vertex-engine'
//   const player = await createPlayer({ canvas, cartridge })            // local
//   const player = await createPlayer({ canvas, server: 'wss://…/ws' })  // online
//   player.pause(); player.restart(); player.setMuted(true); player.destroy()

import { loadCartridge } from './cartridge.js';
import { bindKeys, bindPointer, bindGamepad, touchControls, isTouchDevice } from './input.js';
import { attachAudio } from './audio.js';
import { Timeline } from './timeline.js';
import { autoRenderer } from './webgl.js';
import { mountInspector } from './devtools.js';
import { NetClient } from './net/client.js';

const DIRS = ['up', 'down', 'left', 'right', 'pointer'];

/** Map standard gamepad buttons onto whatever actions a cartridge uses. */
export function gamepadRename(actions) {
  const has = (a) => actions.includes(a);
  const primary = actions.find((a) => !DIRS.includes(a));
  return { up: has('up') ? 'up' : has('thrust') ? 'thrust' : has('jump') ? 'jump' : 'up', jump: primary ?? 'jump', fire: has('fire') ? 'fire' : primary ?? 'fire', action: has('interact') ? 'interact' : primary ?? 'action', start: has('confirm') ? 'confirm' : 'start' };
}

function fitCanvas(canvas, W, H, maxHeight = 'calc(100dvh - 96px)') {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.aspectRatio = `${W} / ${H}`;
  canvas.style.width = `min(100%, ${W * 2}px, calc(${maxHeight} * ${W / H}))`;
}

export async function createPlayer({ canvas, cartridge = null, server = null, name = null, seed = Date.now() >>> 0,
  inspector = true, touch = 'auto', audio = true, fit = true, keys: extraKeys = {}, onEvent = null } = {}) {
  const unbinds = [];
  let renderer = await autoRenderer(canvas);
  let raf = 0, muted = false, paused = false;

  if (server) {
    const client = await NetClient.connect(server, { name });
    const W = client.world.width, H = client.world.height;
    if (fit) fitCanvas(canvas, W, H);
    const keys = { ...client.keys, ...extraKeys }, actions = [...new Set(Object.values(keys))];
    unbinds.push(bindKeys(client, keys), bindPointer(client, canvas, () => client.world), bindGamepad(client, { rename: gamepadRename(actions) }));
    if (touch === true || (touch === 'auto' && isTouchDevice())) unbinds.push(touchControls(client, actions));
    let last = performance.now();
    const tick = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; renderer.draw(client.frame(dt)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return {
      mode: 'online', client, title: client.title, keys, get world() { return client.world; },
      pause() {}, restart() {}, setMuted() {},
      destroy() { cancelAnimationFrame(raf); unbinds.forEach((u) => u()); client.socket.close?.(); },
    };
  }

  const doc = cartridge;
  if (fit) fitCanvas(canvas, doc.width ?? 800, doc.height ?? 600);
  const keys = { ...(doc.keys ?? {}), ...extraKeys }, actions = [...new Set(Object.values(keys))];
  const timeline = new Timeline((o) => loadCartridge(doc, o), { seed, every: 30 });
  unbinds.push(bindKeys(timeline, keys), bindPointer(timeline, canvas, () => timeline.game.world), bindGamepad(timeline, { rename: gamepadRename(actions) }));
  if (audio) unbinds.push(attachAudio(timeline.game));
  if (touch === true || (touch === 'auto' && isTouchDevice())) unbinds.push(touchControls(timeline, actions));
  const tools = inspector ? mountInspector({ timeline, canvas, getSource: () => JSON.stringify(doc, null, 2), reload: () => {} }) : null;
  const gameKeys = new Set(Object.keys(keys).map((k) => k.toLowerCase()));
  let rewinding = false;
  const key = (e, down) => {
    if (e.target?.closest?.('textarea, input')) return;
    const k = e.key.toLowerCase();
    if (k === 'r' && !gameKeys.has('r')) rewinding = down;
    if (down && k === '`' && tools) tools.toggle();
  };
  const kd = (e) => key(e, true), ku = (e) => key(e, false);
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  unbinds.push(() => { removeEventListener('keydown', kd); removeEventListener('keyup', ku); });
  const dt = timeline.game.dt;
  let acc = 0, last = performance.now();
  const tick = (now) => {
    acc += Math.min(0.25, (now - last) / 1000); last = now;
    if (paused || tools?.paused) acc = 0;
    while (acc >= dt) {
      acc -= dt;
      timeline.game.muted = muted || rewinding;
      if (rewinding) timeline.seek(timeline.frame - 2);
      else { const evs = timeline.step(1); if (onEvent) for (const e of evs) onEvent(e); }
    }
    renderer.draw(timeline.game.world);
    tools?.update(renderer);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    mode: 'local', timeline, keys, title: doc.title, inspector: tools,
    get world() { return timeline.game.world; },
    get paused() { return paused || !!tools?.paused; },
    pause(p = !paused) { paused = p; tools?.setPaused(p); },
    restart() {
      timeline.seek(0);
      timeline.inputs = []; timeline.head = 0;
      for (const k of [...timeline.checkpoints.keys()]) if (k > 0) timeline.checkpoints.delete(k);
    },
    setMuted(m) { muted = m; },
    destroy() { cancelAnimationFrame(raf); unbinds.forEach((u) => u()); tools?.destroy(); },
  };
}
