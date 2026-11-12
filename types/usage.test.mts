import { Game, loadCartridge, Timeline, raycast, type Cartridge } from 'vertex-engine';
const doc: Cartridge = { title: 'x', rules: [{ each: 'p', when: "held('left')", do: 'self.x -= 1' }], systems: ['rules', { collide: [['a', 'b']] }] };
const g: Game = loadCartridge(doc, { seed: 1 });
g.press('left'); const evs = g.step(2); evs[0]?.type.toUpperCase();
const t = new Timeline((o) => loadCartridge(doc, o)); t.seek(1);
const hit = raycast(g.world, 0, 0, 1, 0, { max: 10 }); hit?.entity.id;

import { GameServer, NetClient, createPlayer, box, hash, type Shape } from 'vertex-engine';
const cube: Shape = { mesh: box(10, 10, 10), fill: '#fff' };
const srv = new GameServer({ title: 'mp', rules: [], multiplayer: { interest: 500 } }); srv.step();
const hv: number = hash(1, 2, 3);
async function online(canvas: HTMLCanvasElement) { const p = await createPlayer({ canvas, server: 'ws://x/ws' }); p.destroy(); const c = await NetClient.connect('ws://x'); c.press('left'); }
void cube; void hv; void online;
