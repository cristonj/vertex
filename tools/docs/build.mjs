// Builds the docs website from docs/*.md: docs/**.html next to each page, with navigation,
// client-side search, and `json cartridge play` blocks turned into playable embeds.
// Zero dependencies. Run: node tools/docs/build.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOCS = join(ROOT, 'docs');

// navigation order (path relative to docs/, title)
const NAV = [
  ['Start', [['README.md', 'Overview'], ['philosophy.md', 'The Vertex way'], ['getting-started.md', 'Getting started'], ['tutorial.md', 'Tutorial'], ['concepts.md', 'Concepts']]],
  ['Build', [['cookbook.md', 'Cookbook'], ['multiplayer.md', 'Multiplayer'], ['worlds.md', 'Worlds & dialogue'], ['3d.md', '3D'], ['troubleshooting.md', 'Troubleshooting']]],
  ['Reference', [['reference/rules.md', 'Rules'], ['reference/cartridge.md', 'Cartridge'], ['reference/systems.md', 'Systems'], ['reference/api.md', 'JavaScript API'], ['reference/cli.md', 'CLI']]],
];

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/&lt;kbd&gt;(.*?)&lt;\/kbd&gt;/g, '<kbd>$1</kbd>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href.replace(/\.md(#|$)/, '.html$1').replace(/^\.\.\/(SPEC|AGENTS|README|CHANGELOG|VISION)\.html/, 'https://github.com/cristonj/vertex/blob/master/$1.md').replace(/^\.\.\/\.\.\/(SPEC|AGENTS)\.html/, 'https://github.com/cristonj/vertex/blob/master/$1.md')}">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

function highlight(code, lang) {
  let h = esc(code);
  if (lang === 'json' || lang === 'jsonc') h = h.replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2').replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="s">$2</span>');
  if (lang === 'js') h = h.replace(/\b(import|from|const|let|await|async|export|default|new|return|if|else|for|of)\b/g, '<span class="k">$1</span>').replace(/(\/\/[^\n]*)/g, '<span class="c">$1</span>');
  if (lang === 'bash') h = h.replace(/(#[^\n]*)/g, '<span class="c">$1</span>');
  return h;
}

let embedCount = 0;
function render(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [], toc = [];
  let i = 0, title = '';
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^```(\w*)\s*(.*)$/.exec(l);
    if (fence) {
      flush();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      const code = body.join('\n'), lang = fence[1], info = fence[2];
      if (lang === 'json' && /\bplay\b/.test(info)) {
        const id = `game${embedCount++}`;
        out.push(`<div class="play"><canvas id="${id}" tabindex="0"></canvas><button data-play="${id}">▶ Play</button><script type="application/json" data-cart="${id}">${code.replace(/</g, '\\u003c')}</script></div>`);
      }
      out.push(`<pre><code class="lang-${lang}">${highlight(code, lang)}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      const n = h[1].length, text = inline(h[2]), id = slug(h[2]);
      if (n === 1) title = h[2].replace(/`/g, '');
      if (n === 2 || n === 3) toc.push({ n, id, text: h[2].replace(/`/g, '') });
      out.push(`<h${n} id="${id}">${text}${n > 1 ? `<a class="anchor" href="#${id}">#</a>` : ''}</h${n}>`);
      i++; continue;
    }
    if (/^\|/.test(l)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
      const head = cells(rows[0]), bodyRows = rows.slice(2).map(cells);
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+\./.test(l), items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`); continue; }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return { html: out.join('\n'), toc, title };
}

function page({ title, html, toc, rel, navHTML }) {
  const up = '../'.repeat(rel.split('/').length - 1);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Vertex docs</title>
<link rel="stylesheet" href="${up}docs.css">
</head>
<body>
<header class="top"><a class="brand" href="${up}../index.html">VERTEX</a><a href="${up}README.html">Docs</a><span class="sp"></span><input id="q" type="search" placeholder="Search docs  /" aria-label="Search docs" autocomplete="off"><a href="https://github.com/cristonj/vertex">GitHub</a><button id="menu" aria-label="Menu">☰</button></header>
<div id="results" hidden></div>
<div class="layout">
<nav class="side">${navHTML}</nav>
<main>${html}
<p class="edit"><a href="https://github.com/cristonj/vertex/edit/master/docs/${rel}">Edit this page</a></p></main>
<aside class="toc">${toc.length > 2 ? `<b>On this page</b>${toc.map((t) => `<a class="l${t.n}" href="#${t.id}">${esc(t.text)}</a>`).join('')}` : ''}</aside>
</div>
<script type="module">
const up = ${JSON.stringify(up)};
// search
const q = document.getElementById('q'), box = document.getElementById('results');
let index = null;
const load = async () => (index ??= await (await fetch(up + 'search.json')).json());
q.addEventListener('input', async () => {
  const term = q.value.trim().toLowerCase();
  if (!term) { box.hidden = true; return; }
  const words = term.split(/\\s+/), hits = [];
  for (const d of await load()) {
    const hay = (d.title + ' ' + d.heading + ' ' + d.text).toLowerCase();
    if (words.every((w) => hay.includes(w))) hits.push(d);
    if (hits.length > 12) break;
  }
  box.innerHTML = hits.length ? hits.map((h) => '<a href="' + up + h.url + '"><b>' + h.heading + '</b><span>' + h.title + '</span></a>').join('') : '<p>No results</p>';
  box.hidden = false;
});
addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } if (e.key === 'Escape') box.hidden = true; });
document.getElementById('menu').onclick = () => document.body.classList.toggle('nav-open');
// playable embeds
for (const btn of document.querySelectorAll('[data-play]')) {
  btn.onclick = async () => {
    const id = btn.dataset.play, canvas = document.getElementById(id);
    const doc = JSON.parse(document.querySelector('[data-cart="' + id + '"]').textContent);
    const { createPlayer } = await import(up + '../src/index.js');
    btn.remove(); canvas.classList.add('on');
    canvas.width = (doc.width ?? 800) * 2; canvas.height = (doc.height ?? 600) * 2; canvas.style.aspectRatio = (doc.width ?? 800) + '/' + (doc.height ?? 600);
    await createPlayer({ canvas, cartridge: doc, inspector: false, fit: false });
    canvas.focus({ preventScroll: true });
  };
}
const auto = new URLSearchParams(location.search).get('play');
if (auto) { const b = document.querySelector('[data-play="' + auto + '"]'); b?.closest('.play').scrollIntoView({ block: 'center' }); b?.click(); }
</script>
</body>
</html>
`;
}

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.md')) files.push(p);
  }
})(DOCS);

const search = [];
const ordered = NAV.flatMap(([, items]) => items.map(([p]) => p));
for (const file of files) {
  const rel = relative(DOCS, file).replace(/\\/g, '/');
  if (!ordered.includes(rel)) throw new Error(`docs/${rel} is not in the docs navigation (tools/docs/build.mjs NAV)`);
}
for (const file of files) {
  const rel = relative(DOCS, file).replace(/\\/g, '/');
  const up = '../'.repeat(rel.split('/').length - 1);
  const md = readFileSync(file, 'utf8');
  embedCount = 0;
  const { html, toc, title } = render(md);
  const navHTML = NAV.map(([group, items]) => `<b>${group}</b>${items.map(([p, t]) => `<a href="${up}${p.replace(/\.md$/, '.html')}"${p === rel ? ' class="on"' : ''}>${t}</a>`).join('')}`).join('');
  writeFileSync(file.replace(/\.md$/, '.html'), page({ title: title || rel, html, toc, rel, navHTML }));
  // search entries per section
  let heading = title, buf = [];
  const push = () => { if (buf.length) search.push({ url: rel.replace(/\.md$/, '.html') + (heading === title ? '' : '#' + slug(heading)), title, heading, text: buf.join(' ').replace(/[`*#|]/g, ' ').replace(/\s+/g, ' ').slice(0, 600) }); buf = []; };
  for (const l of md.split('\n')) {
    const h = /^#{1,3}\s+(.*)$/.exec(l);
    if (h) { push(); heading = h[1].replace(/`/g, ''); } else if (l.trim() && !l.startsWith('```')) buf.push(l.trim());
  }
  push();
}
writeFileSync(join(DOCS, 'search.json'), JSON.stringify(search));
writeFileSync(join(DOCS, 'index.html'), readFileSync(join(DOCS, 'README.html')));
writeFileSync(join(DOCS, 'docs.css'), readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'docs.css')));
console.log(`docs: ${files.length} pages, ${search.length} search entries`);
