import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, loadCartridge, compileRules, streaming, streamingStats, hash, noise, talk, dialogue, interact, wrap, Recorder, applyRecording, verifyReplay, Timeline, digest } from '../src/index.js';

const frontier = () => JSON.parse(readFileSync(new URL('../examples/frontier/frontier.json', import.meta.url), 'utf8'));

test('hash and noise are deterministic, bounded and well spread', () => {
  assert.equal(hash(1, 2, 3), hash(1, 2, 3));
  assert.notEqual(hash(1, 2, 3), hash(1, 2, 4));
  let sum = 0;
  for (let i = 0; i < 10000; i++) { const h = hash(i, -i, 7); assert.ok(h >= 0 && h < 1); sum += h; }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02, 'uniform-ish');
  const a = noise(3.2, 4.7, 1), b = noise(3.21, 4.71, 1);
  assert.ok(Math.abs(a - b) < 0.05, 'noise is smooth');
  assert.equal(noise(5, 6, 2), hash(5, 6, 2), 'noise hits lattice values at integers');
});

test('streaming: far entities sleep, come back exactly, and memory stays bounded', () => {
  const g = new Game({
    streaming: { chunk: 100, radius: 1, focus: 'player' },
    entities: [{ id: 'p', x: 50, y: 50, tags: ['player'] }, { id: 'far', x: 1000, y: 50, data: { hp: 7 } }, { id: 'near', x: 120, y: 60 }],
  }).use(streaming);
  g.step(1);
  assert.ok(!g.world.get('far') && g.world.get('near'));
  assert.equal(g.world.dormant['10,0'][0].data.hp, 7);
  g.world.get('p').x = 990; g.step(1);
  assert.equal(g.world.get('far').data.hp, 7, 'woke with its data');
  assert.ok(!g.world.get('near'), 'the old area sleeps');
  const evs = g.step(0);
  assert.deepEqual(streamingStats(g.world).activeChunks, 9);
  void evs;
});

test('streaming: chunkEnter fires once fresh per chunk and generation is reproducible', () => {
  const make = () => new Game({
    streaming: { chunk: 100, radius: 1, focus: 'player' }, state: { fresh: 0, again: 0 },
    entities: [{ id: 'p', x: 50, y: 50, tags: ['player'] }],
  }).use(streaming).use(compileRules([
    { on: 'chunkEnter', when: 'event.fresh', do: "state.fresh += 1; repeat (3) spawn(null, {x: event.x + hash(event.cx, event.cy, i) * 100, y: event.y + 50, tags: ['thing']})" },
    { on: 'chunkEnter', when: '!event.fresh', do: 'state.again += 1' },
  ]));
  const g = make();
  g.step(1);
  assert.equal(g.world.state.fresh, 9);
  g.world.get('p').x = 650; g.step(1);
  g.world.get('p').x = 50; g.step(1);
  assert.equal(g.world.state.fresh, 18);
  assert.equal(g.world.state.again, 9, 'returning re-enters without regenerating');
  assert.equal(g.world.query('thing').length, 27, 'original things woke up, none duplicated');
  const h = make(); h.step(1); h.world.get('p').x = 650; h.step(1); h.world.get('p').x = 50; h.step(1);
  assert.equal(digest(g), digest(h));
});

test('Frontier: a long walk keeps the awake set bounded and replays exactly', () => {
  const doc = frontier();
  const g = loadCartridge(doc, { seed: 9 });
  const rec = new Recorder(g);
  g.press('right'); g.axis('y', 0.3);
  for (let i = 0; i < 1500; i++) g.step(1);
  const s = streamingStats(g.world);
  assert.ok(g.world.get('solo').x > 1500, 'walked far');
  assert.ok(s.awake < 250 && s.sleeping > 100, JSON.stringify(s));
  const r = rec.toJSON();
  assert.ok(r.inputs.some((i) => i[1] === 'a'), 'analog input recorded');
  assert.ok(verifyReplay(applyRecording(loadCartridge(doc, { seed: 9 }), r), r));
});

test('dialogue: interpolation, conditional choices, effects, typewriter, end', () => {
  const g = new Game({
    state: { gold: 7 },
    dialogue: { shop: { start: 'a', nodes: {
      a: { speaker: 'Mo', text: 'You have {state.gold} gold.', choices: [
        { text: 'Buy (5)', when: 'state.gold >= 5', do: 'state.gold -= 5', goto: 'b' },
        { text: 'Rich option', when: 'state.gold > 100', goto: 'b' },
        { text: 'Leave', goto: null }] },
      b: { speaker: 'Mo', text: 'Thanks!', do: 'state.thanked = true', next: null } } } },
  }).use(dialogue);
  talk(g, 'shop');
  g.step(1);
  const lines = () => g.world.query('ui:dialogue').map((e) => e.text).filter(Boolean);
  assert.ok(!lines().some((t) => t.includes('Buy')), 'choices hidden while typing');
  g.press('confirm'); g.step(1); g.release('confirm'); g.step(1); // reveal
  assert.ok(lines().includes('You have 7 gold.'));
  assert.deepEqual(lines().filter((t) => t.includes('Buy') || t.includes('Rich') || t.includes('Leave')), ['> Buy (5)', '  Leave']);
  g.press('confirm'); g.step(1); g.release('confirm');
  assert.equal(g.world.state.gold, 2);
  assert.equal(g.world.state.dialogue.node, 'b');
  assert.equal(g.world.state.thanked, true);
  g.step(40); g.press('confirm'); g.step(1); g.release('confirm'); g.step(1);
  assert.equal(g.world.state.dialogue, null);
  assert.equal(g.world.query('ui:dialogue').length, 0, 'UI cleared');
});

test('dialogue choices respond to up/down and pointer taps', () => {
  const g = new Game({ width: 400, height: 300, state: {},
    dialogue: { q: { nodes: { s: { text: 'Pick', choices: [{ text: 'one', do: 'state.p = 1', goto: null }, { text: 'two', do: 'state.p = 2', goto: null }] } } } } }).use(dialogue);
  talk(g, 'q'); g.step(30);
  g.press('down'); g.step(1); g.release('down');
  g.press('confirm'); g.step(1); g.release('confirm');
  assert.equal(g.world.state.p, 2);
  talk(g, 'q'); g.step(30);
  const one = g.world.query('ui:dialogue').find((e) => String(e.text).includes('one'));
  g.point(one.x + 20, one.y - 3); g.press('pointer'); g.step(1); g.release('pointer');
  assert.equal(g.world.state.p, 1);
});

test('interact: nearest in reach, prompt, dialogue start, once', () => {
  const g = new Game({
    state: { n: 0 },
    entities: [
      { id: 'hero', x: 0, y: 0, tags: ['player'] },
      { id: 'lever', x: 30, y: 0, interact: { prompt: 'Pull', do: 'state.n += 1; self.data.pulled = actor.id', once: true } },
      { id: 'far', x: 500, y: 0, interact: { prompt: 'Nope' } },
    ],
  }).use(interact);
  g.step(1);
  assert.equal(g.world.get('hero').data.interactTarget, 'lever');
  assert.deepEqual(g.world.query('ui:prompt').map((e) => e.text), ['[E] Pull']);
  g.press('interact'); const evs = g.step(1); g.release('interact');
  assert.equal(g.world.state.n, 1);
  assert.equal(g.world.get('lever').data.pulled, 'hero');
  assert.ok(evs.some((e) => e.type === 'interact' && e.b === 'lever'));
  g.press('interact'); g.step(1);
  assert.equal(g.world.state.n, 1, 'once: true');
});

test('wrap breaks on words', () => {
  assert.deepEqual(wrap('the quick brown fox jumps', 10), ['the quick', 'brown fox', 'jumps']);
});

test('repeat is bounded and binds i', () => {
  const g = new Game({ state: { s: 0 } }).use(compileRules([{ do: 'repeat (4) state.s += i' }]));
  g.step(1);
  assert.equal(g.world.state.s, 6);
  const bad = new Game({ state: {} }).use(compileRules([{ do: 'repeat (1e9) state.x = 1' }]));
  assert.throws(() => bad.step(1), /exceeds/);
});

test('timeline rewinds through analog input and streaming', () => {
  const doc = frontier();
  const t = new Timeline((o) => loadCartridge(doc, o), { seed: 4, every: 30 });
  t.axis('x', 1); t.step(200); t.axis('x', 0); t.step(100);
  const end = digest(t.game);
  t.seek(50); t.seek(300);
  assert.equal(digest(t.game), end);
});
