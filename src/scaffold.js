// `vertex new <name>`: scaffold a game project that depends on the vertex-engine package.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const TEMPLATES = {
  platformer: 'examples/ascent/ascent.json',
  topdown: 'examples/frontier/frontier.json',
  multiplayer: 'examples/frontier/frontier.json',
  '3d': 'examples/skyline/skyline.json',
  arcade: 'examples/starfall/starfall.json',
};

export function scaffold(name, { template = 'platformer', dir = process.cwd(), version = null } = {}) {
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error('usage: vertex new <name>  (letters, digits, . _ -)');
  const src = TEMPLATES[template];
  if (!src) throw new Error(`unknown template "${template}" (choose: ${Object.keys(TEMPLATES).join(', ')})`);
  const out = resolve(dir, name);
  if (existsSync(out)) throw new Error(`${out} already exists`);
  const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
  const cart = JSON.parse(readFileSync(new URL(src, ROOT), 'utf8'));
  cart.title = basename(name);
  mkdirSync(join(out, 'test'), { recursive: true });
  const files = {
    'package.json': JSON.stringify({
      name, version: '0.1.0', private: true, type: 'module',
      scripts: {
        start: 'vertex serve game.json --root . --port 8080',
        test: 'node --test',
        check: 'vertex run game.json --steps 600 --svg frame.svg',
        link: 'vertex link game.json',
      },
      dependencies: { 'vertex-engine': `^${version ?? pkg.version}` },
    }, null, 2) + '\n',
    'game.json': JSON.stringify(cart, null, 2) + '\n',
    'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${cart.title}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0b0d12; color: #c8ccd4; font: 13px ui-monospace, monospace; }
    body { display: grid; place-items: center; }
    canvas { max-width: 100%; outline: none; }
  </style>
  <script type="importmap">{ "imports": { "vertex-engine": "./node_modules/vertex-engine/src/index.js" } }</script>
</head>
<body>
  <canvas id="game" tabindex="0"></canvas>
  <script type="module">
    import { createPlayer } from 'vertex-engine';
    const params = new URLSearchParams(location.search);
    const canvas = document.getElementById('game');
    // ?online joins the server started by \`npm start\` (multiplayer); otherwise play locally.
    if (params.has('online')) {
      await createPlayer({ canvas, server: \`\${location.protocol === 'https:' ? 'wss' : 'ws'}://\${location.host}/ws\`, name: params.get('name') });
    } else {
      const cartridge = await (await fetch('game.json')).json();
      await createPlayer({ canvas, cartridge });
    }
    canvas.focus();
  </script>
</body>
</html>
`,
    'test/game.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCartridge, Recorder, applyRecording, verifyReplay } from 'vertex-engine';

const doc = JSON.parse(readFileSync(new URL('../game.json', import.meta.url), 'utf8'));

test('the game loads and runs headless', () => {
  const game = loadCartridge(doc, { seed: 1 });
  game.step(600);
  assert.ok(game.world.entities.length > 0);
});

test('a scripted run replays exactly', () => {
  const game = loadCartridge(doc, { seed: 2 });
  const rec = new Recorder(game);
  const actions = [...new Set(Object.values(doc.keys ?? {}))];
  for (let f = 0; f < 600; f++) {
    if (f % 30 === 0 && actions.length) game.press(actions[(f / 30) % actions.length]);
    if (f % 30 === 15 && actions.length) game.release(actions[((f - 15) / 30) % actions.length]);
    game.step(1);
  }
  const r = rec.toJSON();
  assert.ok(verifyReplay(applyRecording(loadCartridge(doc, { seed: 2 }), r), r));
});
`,
    'AGENTS.md': `# ${cart.title}: notes for AI agents

The whole game is \`game.json\`, a Vertex cartridge: vector shapes (SVG path data), entities,
\`systems\` and \`rules\` (a small sandboxed language). Reference: node_modules/vertex-engine/AGENTS.md
and node_modules/vertex-engine/SPEC.md.

- Run headless: \`npx vertex run game.json --steps 600 --svg frame.svg\` and read the SVG.
- Test: \`npm test\` (loads the game, checks an exact replay).
- Play: \`npm start\`, then open http://localhost:8080 (add ?online for multiplayer).
- Share: \`npm run link\` prints a URL containing the whole game.
`,
    'README.md': `# ${cart.title}

A [Vertex](https://github.com/cristonj/vertex) game. Everything is in \`game.json\`.

\`\`\`bash
npm install
npm start        # http://localhost:8080  (local)   ·  http://localhost:8080/?online  (multiplayer)
npm test         # headless checks
\`\`\`
`,
    '.gitignore': 'node_modules/\nframe.svg\n',
  };
  for (const [f, body] of Object.entries(files)) writeFileSync(join(out, f), body);
  return out;
}
