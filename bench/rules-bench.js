// Rules-interpreter throughput: N entities each running `each` rules every step.
// Run: node bench/rules-bench.js
import { loadCartridge } from '../src/node.js';

for (const n of [100, 1000, 5000]) {
  const entities = [];
  for (let i = 0; i < n; i++) entities.push({ d: 'M-2 0 L2 0', x: (i * 37) % 800, y: (i * 91) % 600, vx: 10, tags: ['dot'], data: { hp: 3 } });
  const g = loadCartridge({
    width: 800, height: 600, entities, state: { total: 0 },
    systems: ['rules', 'motion', 'wrap'],
    rules: [
      { each: 'dot', do: 'self.vx = self.vx * 0.99 + (self.x < W / 2 ? 1 : -1); if (self.y > H) self.y = 0' },
      { each: 'dot', when: 'self.data.hp > 0 && frame % 10 == 0', do: 'state.total += self.data.hp' },
      { do: "state.n = count('dot')" },
    ],
  });
  g.step(5);
  const t = performance.now();
  g.step(50);
  console.log(`${String(n).padStart(5)} entities: ${((performance.now() - t) / 50).toFixed(3)} ms/step`);
}
