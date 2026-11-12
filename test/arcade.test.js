import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadCartridge, Recorder, applyRecording, verifyReplay, Game, box, collide3d} from '../src/index.js';
import {games, buildGallery} from '../tools/gallery.mjs';
const doc = id => JSON.parse(readFileSync(new URL(`../examples/${id}/${id}.json`,import.meta.url),'utf8'));
const load = id => {const g=loadCartridge(doc(id),{seed:4});g.step(2);return g};

for (const {id} of games.filter(g=>g.id!=='drift')) test(`${id}: varied input runs and replays exactly`,()=>{
  const d=doc(id), g=loadCartridge(d,{seed:7}), rec=new Recorder(g);
  const actions=[...new Set(Object.values(d.keys))];
  for(let f=0;f<900;f++) {
    if(f%45===0) {for(const a of actions) g.release(a);g.press(actions[(f/45)%actions.length]);}
    g.step();
    for(const e of g.world.entities) for(const k of ['x','y','vx','vy']) assert.ok(Number.isFinite(e[k]),`${e.id}.${k}`);
  }
  assert.ok(!/NaN|Infinity/.test(g.toSVG()));
  const recording=rec.toJSON();
  assert.ok(verifyReplay(applyRecording(loadCartridge(d,{seed:7}),recording),recording));
});

test('Frontier coins award gold on physical contact',()=>{
  const g=load('frontier'),p=g.world.get('solo'),gold=p.data.gold;
  const coin=g.world.spawn({shape:'coin',x:p.x,y:p.y,tags:['coin'],body:{sensor:true}});
  g.step();assert.equal(p.data.gold,gold+1);assert.equal(g.world.get(coin.id),undefined);
});

test('3D bounds: tall offset buildings, rotations, negative scale and flat meshes',()=>{
  const mesh=box(20,120,20);for(const p of mesh.v) p[1]-=60;
  const g=new Game({shapes:{tower:{mesh},car:{mesh:box(16,10,28)},flat:{mesh:box(100,0,100)}},entities:[
    {id:'p',shape:'car',x:0,y:-5,z:0,tags:['p']},
    {id:'tower',shape:'tower',x:40,y:0,z:0,tags:['b']}
  ]}).use(collide3d([['p','b']]));
  assert.equal(g.step().length,0,'no invisible sphere around a tower');
  const t=g.world.get('tower');t.x=15;assert.equal(g.step().length,1);
  g.world.get('p').y=-15;t.scale=-1;assert.equal(g.step().length,0,'offset center reflects with negative scale');
  g.world.get('p').y=-5;
  t.scale=1;t.x=25;t.ry=Math.PI/4;assert.equal(g.step().length,0);
  t.x=15;assert.equal(g.step().length,1);
  t.shape='flat';t.x=0;t.y=-5;assert.equal(g.step().length,1,'zero thickness retains face separating axes');
  t.y=-50;assert.equal(g.step().length,0);
});

test('Skyline: six reachable gems finish the trial and Enter restarts it',()=>{
  const g=load('skyline'), p=g.world.get('player');
  for(const gem of g.world.query('gem')) {p.x=gem.x;p.z=gem.z;g.step();}
  assert.equal(g.world.state.gems,6);assert.equal(g.world.state.over,true);
  g.press('start');g.step(2);assert.equal(g.world.state.over,false);assert.equal(g.world.query('gem').length,6);
});

test('Breaker: serve, brick score, paddle bounce and three-life loss',()=>{
  const g=load('breaker'),b=g.world.get('ball');g.press('fire');g.step();assert.ok(b.vy<0);
  const brick=g.world.query('brick')[0];b.x=brick.x;b.y=brick.y+10;b.vx=0;b.vy=-100;g.step();
  assert.equal(g.world.state.score,10);assert.equal(g.world.query('brick').length,34);
  b.x=g.world.get('paddle').x;b.y=314;b.vy=100;g.step();assert.ok(b.vy<0);
  for(let i=0;i<3;i++){b.y=380;b.data.ready=false;g.step()}
  assert.equal(g.world.state.over,true);g.press('start');g.step(2);assert.equal(g.world.state.lives,3);
});

test('Pulse: firing destroys aliens, shields absorb hits, a cleared wave repopulates',()=>{
  const g=load('pulse');g.press('fire');g.step();assert.ok(g.world.query('shot').length);
  const e=g.world.query('alien')[0];g.world.spawn({shape:'shot',x:e.x,y:e.y,tags:['shot']});g.step();assert.equal(g.world.state.score,20);
  const p=g.world.get('player');g.world.spawn({shape:'bolt',x:p.x,y:p.y,tags:['bolt']});g.step();assert.equal(g.world.state.lives,2);
  g.world.spawn({shape:'bolt',x:p.x,y:p.y,tags:['bolt']});g.step();assert.equal(g.world.state.lives,2);
  for(const alien of g.world.query('alien'))g.world.despawn(alien);g.step();assert.equal(g.world.state.wave,2);assert.equal(g.world.query('alien').length,24);
});

test('Serpent: fruit grows the tail, reverse input is rejected and walls end a run',()=>{
  const g=load('serpent'),h=g.world.get('head'),f=g.world.get('food');f.x=h.x+16;f.y=h.y;
  g.press('left');g.step(10);assert.equal(g.world.state.dx,1);assert.equal(g.world.state.score,10);assert.equal(g.world.query('tail').length,4);
  g.step(300);assert.equal(g.world.state.over,true);g.press('start');g.step(2);assert.equal(g.world.state.over,false);assert.equal(g.world.state.length,4);
});

test('Lunar: soft upright touchdown succeeds; a hard touchdown fails',()=>{
  for(const [speed,landed] of [[12,true],[70,false]]) {
    const g=load('lunar'),p=g.world.get('player');Object.assign(p,{x:350,y:300,vx:0,vy:speed,rot:0});g.step();
    assert.equal(g.world.state.landed,landed);assert.equal(g.world.state.over,true);
    assert.equal(g.world.state.score>0,landed);
  }
});

test('Rally: paddle reflects the ball, seven points wins and Enter resets',()=>{
  const g=load('rally'),b=g.world.get('ball');Object.assign(b,{x:34,y:180,vx:-200,vy:0});b.data.ready=false;g.step();assert.ok(b.vx>0);
  g.world.state.you=6;b.x=500;g.step();assert.equal(g.world.state.you,7);assert.equal(g.world.state.over,true);
  g.press('start');g.step(2);assert.equal(g.world.state.you,0);assert.equal(g.world.state.over,false);
});

test('Apex: boost, traffic crash, checkpoints, finish and retry',()=>{
  const g=load('apex');g.press('go');g.press('fire');g.step(120);
  assert.ok(g.world.state.speed>230);assert.ok(g.world.state.boost<100);
  const p=g.world.get('player');g.world.spawn({shape:'traffic',x:p.x,y:p.y,scale:1,tags:['traffic'],data:{q:.9,lane:0}});g.step();assert.ok(g.world.state.crash>0);
  const before=g.world.state.time;g.world.state.dist=4001;g.step();assert.ok(g.world.state.time>before+14);
  g.world.state.dist=12001;g.step();assert.equal(g.world.state.over,true);g.press('start');g.step(2);assert.equal(g.world.state.over,false);assert.ok(g.world.state.dist<10);
});

test('gallery icons and measured source sizes stay current',()=>{
  const paths=['index.html','README.md',...games.map(g=>`examples/${g.id}/icon.svg`)];
  const before=paths.map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'));
  buildGallery();
  for(let i=0;i<paths.length;i++)assert.equal(readFileSync(new URL('../'+paths[i],import.meta.url),'utf8'),before[i],`rebuild ${paths[i]}`);
});
