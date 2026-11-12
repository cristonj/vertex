// Headless benchmark: simulation + render throughput at increasing entity counts.
// Run: node bench/bench.js
import { Game, systems, collideOutline, toSVG, toPNG } from '../src/node.js';

const time = (fn, n = 1) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n; };

function world(n) {
  const W = Math.sqrt(n) * 80, H = W * 0.75; // constant density: ~1 entity per 80x60 area
  const ents = [];
  let s = 7;
  const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < n; i++) ents.push({ shape: i % 2 ? 'rock' : 'dart', x: r() * W, y: r() * H, vx: (r() - 0.5) * 100, vy: (r() - 0.5) * 100, vr: r(), tags: [i % 2 ? 'rock' : 'dart', 'wrap'] });
  return new Game({
    width: W, height: H,
    shapes: {
      rock: { d: 'M0 -12 L9 -8 L12 1 L7 10 L-3 12 L-11 6 L-10 -5 Z', stroke: '#ccc', width: 1.5 },
      dart: { d: 'M8 0 L-6 -5 L-3 0 L-6 5 Z', fill: '#7df' },
    },
    entities: ents,
  }).use(systems.motion).use(systems.wrap).use(collideOutline([['dart', 'rock']]));
}

console.log('entities | hits/step | step (ms) | toSVG (ms) | SVG KB | toPNG 400x300 (ms) | heap MB');
for (const n of [100, 1000, 5000, 10000]) {
  const g = world(n);
  g.step(5); // warm up
  let hits = 0;
  const step = time(() => { hits += g.step(1).length; }, 20);
  const svgMs = time(() => toSVG(g.world), 5);
  const kb = (toSVG(g.world).length / 1024).toFixed(0);
  const png = time(() => toPNG(g.world, { width: 400, height: 300 }), 2);
  const heap = (process.memoryUsage().heapUsed / 1048576).toFixed(0);
  console.log(`${String(n).padStart(8)} | ${String(Math.round(hits / 20)).padStart(9)} | ${step.toFixed(2).padStart(9)} | ${svgMs.toFixed(2).padStart(10)} | ${kb.padStart(6)} | ${png.toFixed(1).padStart(18)} | ${heap}`);
}
