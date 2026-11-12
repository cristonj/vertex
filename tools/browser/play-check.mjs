// Loads play.html with each example cartridge in headless Chrome and reports title/errors.
// Run: node tools/browser/play-check.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    res.writeHead(200, { 'content-type': types[extname(new URL(req.url, 'http://x').pathname)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const run = (url) => new Promise((done) => execFile(chrome, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--virtual-time-budget=8000', '--dump-dom', url], { timeout: 60000 }, (err, out) => done(out || String(err))));
let failed = 0;
for (const src of ['examples/starfall/starfall.json', 'examples/ascent/ascent.json', 'examples/skyline/skyline.json', 'examples/frontier/frontier.json', 'conformance/cartridges/physics.json']) {
  const dom = await run(`${base}/play.html?src=${src}`);
  const title = /<span id="title">([^<]*)<\/span>/.exec(dom)?.[1];
  const inspector = dom.includes('class="vx-dev"');
  const ok = title && !title.startsWith('error') && title !== 'loading…' && inspector;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${src}: title="${title}" inspector=${inspector}`);
}
server.close();
process.exitCode = failed ? 1 : 0;
