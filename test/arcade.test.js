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
  const g=load('skyline');
  const route=[[0,180],[0,650],[0,800],[400,800],[400,400],[0,400],[-400,400],[-400,0]];let next=0;
  for(let f=0;f<7100&&!g.world.state.over;f++){
    for(const a of ['go','left','right'])g.release(a);
    const p=g.world.get('player');
    if(route[next]) {
      const [x,z]=route[next],dx=x-p.x,dz=z-p.z;
      let angle=Math.atan2(dx,dz)-p.ry;angle=Math.atan2(Math.sin(angle),Math.cos(angle));
      if(Math.hypot(dx,dz)<18)next++;
      if(Math.abs(angle)<.28||Math.abs(p.data.speed)<45)g.press('go');
      if(angle>.08)g.press('right');if(angle<-.08)g.press('left');
    }
    g.step();
  }
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
  for(const alien of g.world.query('alien'))g.world.despawn(alien);g.step();assert.equal(g.world.state.wave,2);assert.equal(g.world.query('alien').length,25);
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
  const p=g.world.get('player');g.world.spawn({shape:'traffic',x:p.x,y:p.y,scale:1,tags:['traffic'],data:{z:0,lane:0,v:0,passed:false}});g.step();assert.ok(g.world.state.crash>0);
  const before=g.world.state.time;g.world.state.dist=4001;g.step();assert.ok(g.world.state.time>before+14);
  g.world.state.dist=12001;g.step();assert.equal(g.world.state.over,true);g.press('start');g.step(2);assert.equal(g.world.state.over,false);assert.ok(g.world.state.dist<10);
});

test('Pulse formations have distinct slots, fit the playfield, and divers rejoin',()=>{
  const g=load('pulse'), layouts=[];
  for(let n=0;n<4;n++){
    if(n) {for(const e of g.world.query('alien'))g.world.despawn(e);g.step();}
    const es=g.world.query('alien');layouts.push(JSON.stringify(es.map(e=>[e.data.sx,e.data.sy])));
    assert.equal(new Set(es.map(e=>`${e.data.sx},${e.data.sy}`)).size,es.length,'distinct slots');
    for(const e of es)assert.ok(Math.abs(e.data.sx)<=145 && Math.abs(e.data.sy)<=80);
    for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++) {
      assert.ok(Math.abs(es[i].data.sx-es[j].data.sx)>=30-1e-8 || Math.abs(es[i].data.sy-es[j].data.sy)>=23-1e-8,'formation slots leave room for the ships');
    }
  }
  assert.equal(new Set(layouts).size,4);
  const e=g.world.query('alien')[0];e.data.mode=1;e.y=390;e.vy=120;g.step();
  assert.equal(e.data.mode,0);assert.equal(e.vy,0);
});

test('Starfall: keys and pointer move the basket, catches score, shields protect, and retry works',()=>{
  const g=load('starfall'),p=g.world.get('player');g.press('left');g.step(10);g.release('left');assert.ok(p.x<240);
  g.point(350,326);g.press('pointer');g.step();assert.equal(p.x,350);g.release('pointer');
  for(const kind of ['star','shield','shard']) {
    const e=g.world.spawn({shape:kind,x:p.x,y:p.y-13,vy:150,tags:[kind,'falling']});
    g.step();assert.equal(g.world.get(e.id),undefined);
  }
  assert.equal(g.world.state.score,10);assert.equal(g.world.state.lives,3);assert.equal(g.world.state.shield,0);
  for(let n=0;n<3;n++){g.world.spawn({shape:'shard',x:p.x,y:p.y-13,tags:['shard','falling']});g.step();}
  assert.equal(g.world.state.over,true);g.press('start');g.step(2);assert.equal(g.world.state.over,false);assert.equal(g.world.state.lives,3);
});

test('Skyline: streets stay clear of buildings, gems stay on streets, and the first leg is drivable',()=>{
  const g=load('skyline');
  for(const b of g.world.query('building')) {
    assert.ok(Math.abs(b.x)>90 && Math.abs(b.x-400)>90 && Math.abs(b.x+400)>90);
    for(const z of [0,400,800,1200])assert.ok(Math.abs(b.z-z)>90);
  }
  for(const gem of g.world.query('gem'))assert.ok([0,400,-400].includes(gem.x)||[0,400,800,1200].includes(gem.z));
  g.press('go');const events=g.step(110);assert.ok(g.world.state.gems>=1);assert.ok(g.world.get('player').z>180);
  assert.ok(!events.some(e=>e.type==='hit'&&e.tags?.[1]==='building'));
  assert.ok(g.world.get('map-player').y<266);
});

test('Apex: neutral steering stays centered, distant cars cannot hit, and close passes reward skill',()=>{
  const g=load('apex');g.press('go');g.step(180);assert.equal(g.world.state.pos,0);
  g.world.spawn({shape:'traffic',x:240,y:318,tags:['traffic'],data:{z:700,lane:0,v:80,passed:false}});g.step();assert.equal(g.world.state.crash,0);
  g.world.spawn({shape:'traffic',x:300,y:318,tags:['traffic'],data:{z:-33,lane:.3,v:80,passed:false}});g.step();
  assert.equal(g.world.state.near,1);assert.equal(g.world.state.bonus,125);
  g.press('right');g.step(30);assert.ok(g.world.state.pos>.3);g.release('right');g.step(90);
  const pos=g.world.state.pos;g.step(30);assert.ok(Math.abs(g.world.state.pos-pos)<.001,'steering settles after release');
});

test('Apex: a policy finishes a complete race using only normal inputs',()=>{
  const g=loadCartridge(doc('apex'),{seed:11});let boost=false;
  for(let f=0;f<6000&&!g.world.state.over;f++){
    g.release('left');g.release('right');g.press('go');
    const w=g.world,p=w.get('player');
    if(p){
      if(w.state.boost>60)boost=true;if(w.state.boost<3)boost=false;
      if(boost)g.press('fire');else g.release('fire');
      const threats=w.query('traffic').filter(e=>e.data.z<400&&e.data.z>-40),lanes=[-.67,0,.67];
      const costs=lanes.map(l=>threats.reduce((s,e)=>s+Math.max(0,.55-Math.abs(e.data.lane-l))*(1-e.data.z/600),0)+Math.abs(l-w.state.pos)*.03);
      const target=240+lanes[costs.indexOf(Math.min(...costs))]*222;
      if(target<p.x-7)g.press('left');if(target>p.x+7)g.press('right');
    }
    g.step();
  }
  assert.ok(g.world.state.dist>=12000);assert.ok(g.world.state.time>0);assert.ok(g.world.state.passes>10);
});

test('the Starfall hero starts a human player instead of an autopilot',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="hero-start"/);assert.match(html,/createPlayer\(\{ canvas, cartridge: doc/);
  assert.ok(!html.includes('policy(game)'));
});

test('gallery icons and measured source sizes stay current',()=>{
  const paths=['index.html','README.md',...games.map(g=>`examples/${g.id}/icon.svg`)];
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const before=paths.map(read);
  buildGallery();
  for(let i=0;i<paths.length;i++)assert.equal(read(paths[i]),before[i],`rebuild ${paths[i]}`);
});
