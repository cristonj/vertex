// Docs are tested: every example in docs/ runs, and every public export is documented.
//   ```json cartridge [play]  -> validated, loaded and run for 600 steps
//   ```json rules             -> a rule or rule array; must compile
//   ```js run                 -> executed against the real package
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCartridge, compileRules } from '../src/index.js';
import * as api from '../src/index.js';
import * as nodeApi from '../src/node.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = join(ROOT, 'docs');

function mdFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? mdFiles(p) : f.endsWith('.md') ? [p] : [];
  });
}

function blocks(file) {
  const src = readFileSync(file, 'utf8'), out = [];
  const re = /^```(\w+)([^\n]*)\n([\s\S]*?)^```/gm;
  let m;
  while ((m = re.exec(src))) out.push({ lang: m[1], info: m[2].trim().split(/\s+/), code: m[3], line: src.slice(0, m.index).split('\n').length });
  return out;
}

const files = mdFiles(DOCS);
const nodeEntry = pathToFileURL(join(ROOT, 'src', 'node.js')).href;

for (const file of files) {
  const rel = file.slice(ROOT.length).replace(/\\/g, '/');
  for (const b of blocks(file)) {
    const where = `${rel}:${b.line}`;
    if (b.lang === 'json' && b.info.includes('cartridge')) {
      test(`docs cartridge ${where}`, () => {
        const doc = JSON.parse(b.code);
        const g = loadCartridge(doc, { seed: 3 });
        const actions = [...new Set(Object.values(doc.keys ?? {}))];
        for (let f = 0; f < 600; f++) {
          if (actions.length && f % 40 === 0) g.press(actions[(f / 40) % actions.length]);
          if (actions.length && f % 40 === 20) for (const a of actions) g.release(a);
          g.step(1);
        }
        assert.ok(g.world.frame === 600);
      });
    } else if (b.lang === 'json' && b.info.includes('rules')) {
      test(`docs rules ${where}`, () => {
        const v = JSON.parse(b.code);
        compileRules(Array.isArray(v) ? v : [v]);
      });
    } else if (b.lang === 'js' && b.info.includes('run')) {
      test(`docs snippet ${where}`, async () => {
        const code = b.code.replace(/from 'vertex-engine(?:\/node)?'/g, `from '${nodeEntry}'`);
        const tmp = join(dirname(file), `.doctest-${b.line}.mjs`);
        writeFileSync(tmp, code);
        try { await import(pathToFileURL(tmp).href + `?t=${Date.now()}`); } finally { rmSync(tmp, { force: true }); }
      });
    }
  }
}

test('every public export is documented in docs/reference/api.md', () => {
  const doc = readFileSync(join(DOCS, 'reference', 'api.md'), 'utf8');
  const names = new Set([...Object.keys(api), ...Object.keys(nodeApi)]);
  const missing = [...names].filter((n) => !new RegExp('`(new )?' + n + '[`(.]').test(doc));
  assert.deepEqual(missing, [], `undocumented exports: ${missing.join(', ')}`);
});

test('internal doc links resolve', () => {
  const bad = [];
  for (const file of [...files, join(ROOT, 'README.md')]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\]\(((?!https?:|#|mailto:)[^)#\s]+)(#[^)]*)?\)/g)) {
      try { statSync(join(dirname(file), m[1])); } catch { bad.push(`${file.slice(ROOT.length)} -> ${m[1]}`); }
    }
  }
  assert.deepEqual(bad, []);
});
