// Node entry: everything in the browser-safe core, plus filesystem scene loading and
// zlib-compressed PNGs. `import 'vertex-engine/node'` (or src/node.js) in Node tools.
import { deflateSync } from 'node:zlib';
import { setDeflate } from './png.js';

setDeflate((raw) => deflateSync(raw, { level: 6 }));

export * from './index.js';
export { loadSceneModule, createFrom } from './load.js';
