import { Game, loadCartridge, Timeline, raycast, type Cartridge } from 'vertex-engine';
const doc: Cartridge = { title: 'x', rules: [{ each: 'p', when: "held('left')", do: 'self.x -= 1' }], systems: ['rules', { collide: [['a', 'b']] }] };
const g: Game = loadCartridge(doc, { seed: 1 });
g.press('left'); const evs = g.step(2); evs[0]?.type.toUpperCase();
const t = new Timeline((o) => loadCartridge(doc, o)); t.seek(1);
const hit = raycast(g.world, 0, 0, 1, 0, { max: 10 }); hit?.entity.id;
