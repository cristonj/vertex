// Drift: a tiny vector space-shooter. Pure logic — runs in browser or headless.
import { Game, systems, collideOutline } from '../../src/index.js';

export const scene = {
  width: 800, height: 600, background: '#0b0d12',
  shapes: {
    ship: { parts: [
      { d: 'M14 0 L-10 -9 L-5 0 L-10 9 Z', fill: '#0b0d12', stroke: '#7df9ff', width: 2 },
      { d: 'M-6 -3 L-13 0 L-6 3', stroke: '#ff9f43', width: 1.5 },
    ] },
    rock: { d: 'M0 -22 L16 -14 L22 2 L12 18 L-6 21 L-20 10 L-19 -9 Z', fill: 'none', stroke: '#c8ccd4', width: 2 },
    bullet: { d: 'M-3 0 L3 0', stroke: '#fff', width: 3 },
  },
  entities: [{ id: 'ship', shape: 'ship', x: 400, y: 300, drag: 0.6, tags: ['ship', 'wrap'] }],
  state: { score: 0, lives: 3, hud: '' },
};

export function createGame(opts) {
  const game = new Game(scene, opts);
  const w = game.world;

  const spawnRock = (x, y, scale = 1.6) => w.spawn({
    shape: 'rock', x, y, scale, tags: ['rock', 'wrap'],
    vx: (game.random() - 0.5) * 120, vy: (game.random() - 0.5) * 120, vr: (game.random() - 0.5) * 2,
  });
  for (let i = 0; i < 5; i++) spawnRock(game.random() * 800, game.random() < 0.5 ? 40 : 560);

  let cooldown = 0;
  game
    .use((g, dt) => { // player control
      const s = w.get('ship'); if (!s) return;
      if (g.input.has('left')) s.rot -= 4 * dt;
      if (g.input.has('right')) s.rot += 4 * dt;
      if (g.input.has('thrust')) { s.vx += Math.cos(s.rot) * 300 * dt; s.vy += Math.sin(s.rot) * 300 * dt; }
      cooldown -= dt;
      if (g.input.has('fire') && cooldown <= 0) {
        cooldown = 0.18;
        w.spawn({ shape: 'bullet', x: s.x, y: s.y, rot: s.rot,
          vx: s.vx + Math.cos(s.rot) * 520, vy: s.vy + Math.sin(s.rot) * 520,
          tags: ['bullet', 'wrap'], data: { ttl: 0.9 } });
      }
    })
    .use(systems.motion)
    .use(systems.wrap)
    .use(systems.lifetime)
    .use(collideOutline([['bullet', 'rock'], ['ship', 'rock']])) // exact: the art is the hitbox
    .use((g) => { // resolve hits
      const dead = new Set();
      for (const ev of g.events) {
        if (ev.type !== 'hit' || dead.has(ev.a) || dead.has(ev.b)) continue;
        const rock = w.get(ev.b);
        if (ev.tags[0] === 'bullet') {
          dead.add(ev.a); dead.add(ev.b); w.state.score += 10;
          if (rock.scale > 0.6) for (let k = 0; k < 2; k++) spawnRock(rock.x, rock.y, rock.scale / 2);
        } else {
          const s = w.get('ship');
          w.state.lives--; s.x = 400; s.y = 300; s.vx = s.vy = 0;
          dead.add(ev.b);
          g.emit(w.state.lives <= 0 ? 'gameover' : 'died');
        }
      }
      for (const id of dead) w.despawn(id);
      if (!w.query('rock').length) for (let i = 0; i < 6; i++) spawnRock(game.random() * 800, 30);
      w.state.hud = `SCORE ${w.state.score}  LIVES ${w.state.lives}`;
    });
  return game;
}
