import {readFileSync,writeFileSync} from 'node:fs';
const d=JSON.parse(readFileSync('examples/starfall/starfall.json','utf8'));
d.description='Catch gold stars, avoid red shards. Move with arrows/A-D or drag the basket with mouse/touch. Collect shields and hearts. Enter or space retries.';
d.keys={'ArrowLeft':'left','ArrowRight':'right',a:'left',d:'right',Enter:'start',' ':'start'};
d.shapes.aura={d:'M-35 0Q-35 -20 0 -20Q35 -20 35 0Q35 22 0 22Q-35 22 -35 0Z',fill:'none',stroke:'#7df9ff',width:2};
d.systems=['motion','wrap','particles','lifetime','rules'];
const initial={score:0,lives:3,combo:1,comboT:0,speed:145,st:.45,over:false,shield:0,elapsed:0,hud:''};
d.state={...initial,best:0};d.scenes.play.state={...initial};
d.scenes.play.entities=[{id:'player',shape:'cup',x:240,y:326,tags:['player'],layer:5},
  {id:'aura',shape:'aura',x:240,y:326,opacity:0,layer:4},
  {id:'score',text:'SCORE 0',x:12,y:22,size:11,align:'left',stroke:'#ffcf5a',width:1.5,layer:10},
  {id:'status',text:'LIVES 3',x:468,y:22,size:11,align:'right',stroke:'#7df9ff',width:1.5,layer:10},
  {id:'help',text:'ARROWS MOVE   OR DRAG THE BASKET',x:240,y:355,size:9,stroke:'#7e759d',width:1.1,layer:10}];
const spawn=d.rules.find(r=>Array.isArray(r.do)&&r.do.includes('state.elapsed += dt'));
spawn.when="!state.over && state.scene == 'play'";
spawn.do=[
  'state.elapsed += dt; state.st -= dt; state.comboT = max(0,state.comboT-dt)',
  'if (state.comboT <= 0) state.combo = 1; state.shield = max(0,state.shield-dt)',
  "if (state.st <= 0) { let kind = random() < max(0.5,0.78-state.elapsed*0.002) ? 'star' : 'shard'; spawn(kind, {x:rand(30,W-30),y:-16,vy:state.speed*rand(0.9,1.1),vr:rand(-1.8,1.8),tags:[kind,'falling']}); state.st = max(0.45,0.85-state.elapsed*0.004) * rand(0.85,1.15) }",
  "if (random() < 0.0009) spawn('heart',{x:rand(30,W-30),y:-16,vy:state.speed,tags:['heart','falling']})",
  "if (random() < 0.0014) spawn('shield',{x:rand(30,W-30),y:-16,vy:state.speed,tags:['shield','falling']})",
  'state.speed = min(240,145+state.elapsed*1.2)'
];
d.rules.find(r=>r.each==='player'&&!r.when.includes('pressed')).do=[
  "let dir = clamp(axis('x') + (held('right') ? 1 : 0) - (held('left') ? 1 : 0),-1,1); self.x = clamp(self.x + dir * 360 * dt,30,W-30)",
  "if (held('pointer')) self.x = clamp(pointer.x,30,W-30); self.rot += (dir * 0.08-self.rot) * min(1,15*dt)",
  "let a = get('aura'); a.x = self.x; a.opacity = state.shield > 0 ? 0.7+sin(time*8)*0.3 : 0"
];
const falling=d.rules.find(r=>r.each==='falling');
falling.when='true';falling.do=[
  "if (state.over) { self.vy=0; self.vr=0 } else { let p = get('player'); if (p && self.y >= p.y-15 && self.y <= p.y+14 && abs(self.x-p.x) <= 30 && !self.data.caught) { self.data.caught = true; emit('hit',{a:p.id,b:self.id,tags:['player',has(self,'star') ? 'star' : (has(self,'shard') ? 'shard' : (has(self,'heart') ? 'heart' : 'shield'))]}) } }; if (self.y > H+24) despawn(self)"
];
const catchStar=d.rules.find(r=>r.on==='hit'&&r.tags[1]==='star');
catchStar.do[0]="despawn(b); state.score += 10 * state.combo; state.combo = min(5,state.combo+1); state.comboT = 4.5; sound('ding')";
catchStar.do[3]="spawn(null,{text:'NICE',size:10,x:b.x,y:b.y-12,stroke:'#ffd166',width:1.5,vy:-40,data:{ttl:0.5}})";
d.rules[d.rules.length-1]={do:"state.hud = ''; let s = get('score'); if (s) s.text = 'SCORE ' + str(state.score) + '  BEST ' + str(max(state.best,state.score)); s = get('status'); if (s) s.text = 'LIVES ' + str(state.lives) + (state.shield > 0 ? '  SHIELD' : (state.combo > 1 ? '  X' + str(state.combo) : '')); s = get('help'); if (s) s.text = state.over ? 'ENTER OR SPACE TO RETRY' : 'ARROWS MOVE   OR DRAG THE BASKET'"};
writeFileSync('examples/starfall/starfall.json',JSON.stringify(d,null,2)+'\n');
