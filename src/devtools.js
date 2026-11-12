// In-browser inspector for any Vertex game running in a Timeline. Everything is data, so the
// inspector is just a view over it: scrub time, pick entities, edit their JSON live, and
// hot-reload the whole cartridge source while keeping the seed.
//
//   const tools = mountInspector({ timeline, canvas, getSource, reload, parent })
//   tools.toggle()  ·  tools.update() each frame  ·  tools.destroy()

import { pointQuery } from './physics.js';

const CSS = `
.vx-dev { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: #0d1017f2; color: #c8ccd4;
  font: 12px/1.45 ui-monospace, monospace; border-left: 1px solid #ffffff1f; display: flex; flex-direction: column; z-index: 20;
  backdrop-filter: blur(6px); }
.vx-dev[hidden] { display: none; }
.vx-dev header { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #ffffff1a; }
.vx-dev header b { color: #7df9ff; margin-right: auto; }
.vx-dev .row { display: flex; gap: 6px; align-items: center; padding: 6px 12px; flex-wrap: wrap; }
.vx-dev .stats span { color: #8b93a7; } .vx-dev .stats b { color: #fff; font-weight: 600; margin-right: 10px; }
.vx-dev input[type=range] { flex: 1; min-width: 120px; accent-color: #7df9ff; }
.vx-dev button { background: none; color: inherit; border: 1px solid #ffffff33; border-radius: 4px; padding: 2px 8px; font: inherit; cursor: pointer; }
.vx-dev button:hover { border-color: #7df9ff; }
.vx-dev .tabs { display: flex; gap: 0; padding: 0 12px; border-bottom: 1px solid #ffffff1a; }
.vx-dev .tabs button { border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 6px 10px; }
.vx-dev .tabs button.on { border-bottom-color: #7df9ff; color: #fff; }
.vx-dev .pane { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; }
.vx-dev .ents div { padding: 1px 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 3px; }
.vx-dev .ents div:hover { background: #ffffff12; } .vx-dev .ents div.sel { background: #7df9ff26; color: #fff; }
.vx-dev textarea { width: 100%; box-sizing: border-box; min-height: 220px; background: #05070b; color: #d6dae3; border: 1px solid #ffffff26;
  border-radius: 4px; font: 12px/1.4 ui-monospace, monospace; padding: 8px; resize: vertical; }
.vx-dev .err { color: #ff7b8a; white-space: pre-wrap; } .vx-dev .ok { color: #8f8; }
.vx-dev pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
`;

export function mountInspector({ timeline: initial, canvas, getSource, reload, parent = document.body }) {
  let timeline = initial;
  let selected = null, tab = 'entities', paused = false;
  const el = document.createElement('div');
  el.className = 'vx-dev'; el.hidden = true;
  el.innerHTML = `<style>${CSS}</style>
    <header><b>INSPECTOR</b><button data-a="pause">pause</button><button data-a="step">step</button><button data-a="close">×</button></header>
    <div class="row stats"></div>
    <div class="row"><span>frame</span><input type="range" min="0" value="0" data-a="scrub"><span class="fr"></span></div>
    <div class="tabs"><button data-t="entities" class="on">entities</button><button data-t="state">state</button><button data-t="source">source</button><button data-t="frame">frame</button></div>
    <div class="pane"></div>`;
  parent.append(el);
  const $ = (s) => el.querySelector(s);
  const pane = $('.pane'), scrub = $('[data-a=scrub]');
  let fps = 0, frames = 0, lastT = performance.now();

  const render = () => {
    const w = timeline.game.world;
    if (tab === 'entities') {
      const sel = selected && w.get(selected);
      pane.innerHTML = `<div class="ents">${w.entities.slice(0, 400).map((e) =>
        `<div data-id="${e.id}" class="${e.id === selected ? 'sel' : ''}">${e.id} <span style="color:#8b93a7">${e.shape ?? (e.text != null ? '“' + String(e.text).slice(0, 18) + '”' : e.d ? 'path' : '')} ${e.tags.join(' ')}</span></div>`).join('')}
        ${w.entities.length > 400 ? `<div>… ${w.entities.length - 400} more</div>` : ''}</div>
        ${sel ? `<p>edit <b>${sel.id}</b> (applies on blur; pause to edit safely)</p><textarea data-a="ent">${esc(JSON.stringify(sel, null, 1))}</textarea><div class="msg"></div>` : '<p style="color:#8b93a7">click an entity here or on the canvas (while paused)</p>'}`;
    } else if (tab === 'state') {
      pane.innerHTML = `<textarea data-a="state">${esc(JSON.stringify(w.state, null, 1))}</textarea><div class="msg"></div>
        <pre style="color:#8b93a7">camera ${JSON.stringify(w.camera ?? null)}\ntimers ${JSON.stringify(w.timers)}\ninput ${JSON.stringify([...timeline.game.input])} pointer ${JSON.stringify(timeline.game.pointer)}</pre>`;
    } else if (tab === 'source') {
      pane.innerHTML = `<p>The whole game. Edit and apply to hot-reload (same seed, frame 0).</p>
        <textarea data-a="src" style="min-height:55vh">${esc(getSource())}</textarea>
        <div class="row" style="padding:6px 0"><button data-a="apply">apply</button><span class="msg"></span></div>`;
    } else {
      const svg = timeline.game.toSVG();
      pane.innerHTML = `<p>canonical frame: ${svg.length} bytes · digest via replay.js</p><pre style="color:#8b93a7">${esc(svg.slice(0, 6000))}${svg.length > 6000 ? '…' : ''}</pre>`;
    }
  };
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const msg = (text, ok) => { const m = pane.querySelector('.msg'); if (m) { m.className = 'msg ' + (ok ? 'ok' : 'err'); m.textContent = text; } };

  el.addEventListener('click', (ev) => {
    const a = ev.target.dataset?.a, t = ev.target.dataset?.t, id = ev.target.closest?.('[data-id]')?.dataset.id;
    if (t) { tab = t; el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); render(); }
    else if (id && !a) { selected = id; render(); }
    else if (a === 'pause') api.setPaused(!paused);
    else if (a === 'step') { api.setPaused(true); timeline.step(1); render(); }
    else if (a === 'close') api.toggle(false);
    else if (a === 'apply') {
      try { reload(pane.querySelector('[data-a=src]').value); msg('reloaded', true); } catch (e) { msg(e.message); }
    }
  });
  el.addEventListener('focusout', (ev) => {
    const a = ev.target.dataset?.a;
    if (a !== 'ent' && a !== 'state') return;
    try {
      const v = JSON.parse(ev.target.value), w = timeline.game.world;
      if (a === 'state') { for (const k of Object.keys(w.state)) delete w.state[k]; Object.assign(w.state, v); }
      else { const e = w.get(selected); if (e) { Object.assign(e, v); if (v.id && v.id !== selected) selected = v.id; } }
      msg('applied', true);
    } catch (e) { msg(e.message); }
  });
  scrub.addEventListener('input', () => { api.setPaused(true); timeline.game.muted = true; timeline.seek(+scrub.value); timeline.game.muted = false; });
  const pick = (ev) => {
    if (el.hidden || !paused) return;
    const r = canvas.getBoundingClientRect(), w = timeline.game.world;
    const hit = pointQuery(w, ((ev.clientX - r.left) / r.width) * w.width, ((ev.clientY - r.top) / r.height) * w.height)[0];
    if (hit) { selected = hit.id; tab = 'entities'; render(); }
  };
  canvas.addEventListener('click', pick);

  const api = {
    get paused() { return paused; },
    get visible() { return !el.hidden; },
    setPaused(p) { paused = p; $('[data-a=pause]').textContent = p ? 'play' : 'pause'; if (p) render(); },
    setTimeline(t) { timeline = t; selected = null; render(); },
    toggle(v = el.hidden) { el.hidden = !v; if (v) render(); },
    /** Call once per animated frame. Cheap when hidden. */
    update(renderer) {
      frames++;
      const now = performance.now();
      if (now - lastT > 500) { fps = (frames * 1000) / (now - lastT); frames = 0; lastT = now; if (!el.hidden && !paused && tab !== 'source' && !el.contains(document.activeElement)) render(); }
      if (el.hidden) return;
      const w = timeline.game.world;
      scrub.max = String(timeline.head); if (document.activeElement !== scrub) scrub.value = String(timeline.frame);
      $('.fr').textContent = `${timeline.frame}/${timeline.head}`;
      $('.stats').innerHTML = `<span>fps</span><b>${fps.toFixed(0)}</b><span>entities</span><b>${w.entities.length}</b>` +
        (renderer?.stats ? `<span>draws</span><b>${renderer.stats.draws}</b>` : '') + `<span>t</span><b>${w.time.toFixed(2)}s</b>`;
    },
    destroy() { canvas.removeEventListener('click', pick); el.remove(); },
  };
  return api;
}
