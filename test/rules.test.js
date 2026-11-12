import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, compileRules, parseRules, loadCartridge, encodeCartridge, decodeCartridge, Recorder, applyRecording, verifyReplay } from '../src/index.js';

const starfall = JSON.parse(readFileSync(new URL('../examples/starfall/starfall.json', import.meta.url), 'utf8'));

const run = (rules, doc = {}, steps = 1) => {
  const g = new Game({ state: {}, ...doc }).use(compileRules(rules));
  g.step(steps);
  return g;
};

test('arithmetic, precedence, comparison, logic, ternary', () => {
  const g = run([{ do: [
    'state.a = 1 + 2 * 3 - 4 / 2', 'state.b = (1 + 2) * 3', 'state.c = 7 % 3', 'state.d = -2 * -3',
    'state.e = 1 < 2 && 3 >= 3', 'state.f = !true || false', 'state.g = 2 > 1 ? \'yes\' : \'no\'',
    'state.h = null || 5', 'state.i = 0 && 9',
  ] }]);
  assert.deepEqual(g.world.state, { a: 5, b: 9, c: 1, d: 6, e: true, f: false, g: 'yes', h: 5, i: 0 });
});

test('let, if/else, blocks, compound assignment, objects, arrays, strings', () => {
  const g = run([{ do: `
    let n = 3; let acc = 0;
    if (n > 2) { acc += 10; acc *= 2 } else acc = -1;
    if (n == 0) acc = 99;
    state.acc = acc;
    state.o = {x: 1, list: [1, 'two', n]};
    state.s = 'score ' + str(acc) + "!";
    state.len = len(state.o.list)
  ` }]);
  assert.equal(g.world.state.acc, 20);
  assert.deepEqual(g.world.state.o, { x: 1, list: [1, 'two', 3] });
  assert.equal(g.world.state.s, 'score 20!');
  assert.equal(g.world.state.len, 3);
});

test('each/when bind self; held() reads actions; spawn/despawn/count', () => {
  const g = new Game({ entities: [{ id: 'p', tags: ['p'] }, { id: 'q', tags: ['p'] }], state: {} }).use(compileRules([
    { each: 'p', when: "held('right')", do: 'self.x += 10' },
    { on: 'start', do: "spawn('dot', {id: 'd1', tags: ['dot']}); spawn('dot', {tags: ['dot']})" },
    { do: "state.dots = count('dot'); if (frame == 1) despawn('d1')" },
  ]));
  g.press('right');
  g.step(2);
  assert.equal(g.world.get('p').x, 20);
  assert.equal(g.world.get('q').x, 20);
  assert.equal(g.world.state.dots, 2);
  assert.equal(g.world.query('dot').length, 1);
});

test('hit rules bind a/b, filter by tags, and skip entities already removed', () => {
  const g = new Game({
    shapes: { s: { d: 'M-5 0 L5 0' } },
    entities: [{ id: 'a', shape: 's', tags: ['x'] }, { id: 'b', shape: 's', tags: ['y'] }, { id: 'c', shape: 's', tags: ['y'] }],
    state: { hits: 0 },
  });
  g.use((game) => { game.emit('hit', { a: 'a', b: 'b', tags: ['x', 'y'] }); game.emit('hit', { a: 'a', b: 'c', tags: ['x', 'y'] }); game.emit('hit', { a: 'a', b: 'b', tags: ['q', 'z'] }); });
  g.use(compileRules([{ on: 'hit', tags: ['x', 'y'], do: 'state.hits += 1; despawn(a)' }]));
  g.step(1);
  assert.equal(g.world.state.hits, 1, 'second hit skipped: a was despawned');
});

test('custom events and emit', () => {
  const g = run([
    { on: 'start', do: "emit('boom', {power: 3})" },
    { on: 'boom', do: 'state.p = event.power' },
  ]);
  assert.equal(g.world.state.p, 3);
});

test('sandbox: no host access, no prototype tricks, clear errors', () => {
  assert.throws(() => run([{ do: 'state.x = window' }]), /unknown name "window"/);
  assert.throws(() => run([{ do: "state['__proto__'] = 1" }]), /forbidden/);
  assert.throws(() => run([{ do: 'state.constructor' }]), /forbidden/);
  assert.throws(() => run([{ do: 'eval(1)' }]), /unknown function "eval"/);
  assert.throws(() => run([{ do: 'x = 1' }]), /declare it with let/);
  assert.throws(() => compileRules([{ do: 'state.a = (1 + ' }]), /rules\[0\]/);
  assert.throws(() => parseRules('1 +* 2'), SyntaxError);
});

test('rules are deterministic with the seeded RNG', () => {
  const r = [{ do: 'state.v = rand(0, 100) + random()' }];
  assert.equal(run(r, {}, 5).world.state.v, run(r, {}, 5).world.state.v);
});

test('cartridge: Starfall plays, records, and replays exactly', () => {
  const g = loadCartridge(starfall, { seed: 11 });
  assert.equal(g.cartridge.title, 'Starfall');
  const rec = new Recorder(g);
  for (let f = 0; f < 900; f++) {
    const p = g.world.get('player'), star = g.world.query('star')[0];
    g.release('left'); g.release('right');
    if (star && star.x < p.x - 5) g.press('left'); else if (star && star.x > p.x + 5) g.press('right');
    g.step(1);
  }
  assert.ok(g.world.state.score > 0, 'the chase policy catches stars');
  const doc = rec.toJSON();
  const g2 = applyRecording(loadCartridge(starfall, { seed: doc.seed }), doc);
  assert.ok(verifyReplay(g2, doc));
});

test('cartridge validation errors are precise', () => {
  assert.throws(() => loadCartridge({ systems: ['nope'] }), /unknown system "nope"/);
  assert.throws(() => loadCartridge({ systems: ['rules', 'rules'], rules: [] }), /only once/);
});

test('games as links: encode/decode round-trips and compresses', async () => {
  const code = await encodeCartridge(starfall);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.ok(code.length < JSON.stringify(starfall).length);
  assert.deepEqual(await decodeCartridge(code), starfall);
});
