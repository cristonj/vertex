// Headless-browser check of the WebGL2 renderer against Canvas2D. Run: node tools/browser/run.mjs
// Starts a throwaway static server on localhost, runs Chrome headless, prints the result.
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
    res.writeHead(200, { 'content-type': types[extname(req.url)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/tools/browser/check.html`;
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
execFile(chrome, ['--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--virtual-time-budget=20000', '--dump-dom', url], { timeout: 60000 }, (err, stdout) => {
  server.close();
  const m = /<pre id="out">([^<]*)<\/pre>/.exec(stdout);
  console.log(m ? m[1].replace(/&quot;/g, '"') : `no result${err ? ': ' + err.message : ''}`);
});
