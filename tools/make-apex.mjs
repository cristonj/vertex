import { writeFileSync } from 'node:fs';
const r = (code, extra = {}) => ({...extra, do:code});
const each = (tag, code, when = '!state.over') => r(code,{each:tag,when});
const initial = {score:0,over:false,hud:'',speed:130,time:60,dist:0,pos:0,boost:100,crash:0,st:0.8,check:1,curve:0};
const car = (color) => ({parts:[
  {d:'M-25 0L-21 -20L-13 -29H13L21 -20L25 0Z',fill:color,stroke:'#192238',width:1.5},
  {d:'M-15 -20L-10 -27H10L15 -20Z',fill:'#192d50'},
  {d:'M-24 -7H24V0H-24Z',fill:color},
  {d:'M-22 -5H-12M12 -5H22',stroke:'#ffcf5a',width:3},
  {d:'M-7 -4H7V0H-7Z',fill:'#131a2a'}]});
const entities = [
  {d:'M0 0H480V112H0Z',x:0,y:0,fill:{type:'linear',x1:0,y1:0,x2:0,y2:112,stops:[[0,'#302151'],[1,'#ff9670']]},layer:-5},
  {shape:'sun',x:350,y:75,layer:-4},
  {d:'M0 112V85L60 60L110 99L170 76L240 110L310 86L370 100L420 70L480 96V112Z',x:0,y:0,fill:'#392c54',layer:-3},
  {d:'M0 112H480V360H0Z',x:0,y:0,fill:'#234339',layer:-2},
  {id:'player',shape:'car',x:240,y:318,layer:10,tags:['player']},
  {id:'info',text:'ARROWS DRIVE   SPACE BOOST',x:240,y:351,size:11,stroke:'#fff',width:1.4,layer:20},
  {id:'dash',text:'TIME 60   KMH 130',x:240,y:23,size:13,stroke:'#ffcf5a',width:1.5,layer:20}
];
const doc = {vertex:1,title:'Apex',description:'A cabinet-style sunset racer. Left/right steer, up accelerates, down brakes, space boosts. Pass traffic and reach 12 km before time runs out. Checkpoints add time.',width:480,height:360,background:'#302151',
  shapes:{car:car('#ff3b5c'),traffic:car('#7df9ff'),post:{d:'M-2 0V-25H2V0Z',fill:'#fff'},sun:{d:'M-28 0A28 28 0 1 0 28 0A28 28 0 1 0 -28 0Z',fill:'#ffcf5a'}},
  sounds:{hit:{wave:'triangle',freq:660,slide:900,decay:.15,volume:.2},lose:{wave:'noise',freq:900,slide:-600,decay:.35,volume:.3}},state:initial,
  keys:{ArrowLeft:'left',ArrowRight:'right',ArrowUp:'go',ArrowDown:'brake',a:'left',d:'right',w:'go',s:'brake',' ':'fire',Shift:'fire',Enter:'start'},
  systems:[{collideOutline:[['player','traffic']]},'rules'],scenes:{race:{state:initial,entities}},rules:[
    r("goto('race')",{on:'start'}),
    r("repeat (30) { spawn(null, {d: 'M0 0', x: 0, y: 0, tags: ['road'], layer: -1, data: {n: i}}); spawn(null, {id: 'lane' + str(i), d: 'M0 0', x: 0, y: 0, layer: 0, fill: '#e2c4b2'}) }; repeat (16) spawn('post', {x: 0, y: 0, tags: ['post'], layer: 1, data: {q: floor(i / 2) / 8, side: i % 2 == 0 ? -1 : 1}})",{on:'scene',when:"event.name == 'race'"}),
    each('player',[
      "let steer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0); state.curve = sin(state.dist / 1400) * 95",
      "state.pos = clamp(state.pos + steer * 1.5 * dt - sin(state.dist / 1400) * state.speed * 0.0007 * dt, -1.05, 1.05); self.x = 240 + state.pos * 170; self.rot = steer * 0.06",
      "let boosting = held('fire') && state.boost > 0; let target = (held('go') ? 230 : 155) - (held('brake') ? 100 : 0) + (boosting ? 110 : 0); if (abs(state.pos) > 0.9) target *= 0.55; if (boosting) { state.boost = max(0, state.boost - 30 * dt) } else { state.boost = min(100, state.boost + 9 * dt) }",
      "state.crash = max(0, state.crash - dt); if (state.crash > 0) target = 55; self.opacity = state.crash > 0 && floor(time * 14) % 2 == 0 ? 0.4 : 1; state.speed += (target - state.speed) * min(1, 2.5 * dt); state.dist += state.speed * dt; state.time -= dt; state.score = floor(state.dist)",
      "if (state.dist > state.check * 4000 && state.check < 3) { state.check += 1; state.time += 15; sound('hit') }; if (state.time <= 0 || state.dist >= 12000) { state.time = max(0, state.time); state.over = true; spawn(null, {text: state.dist >= 12000 ? 'FINISH LINE' : 'TIME UP', size: 28, x: 240, y: 180, layer: 30, stroke: '#ffcf5a', width: 2}) }"
    ]),
    each('road',[
      "let t = self.data.n / 30; let u = (self.data.n + 1) / 30; let y = 112 + t * t * 248; let z = 112 + u * u * 248; let c = 240 + state.curve * (1 - t) * (1 - t); let d = 240 + state.curve * (1 - u) * (1 - u); let a = 12 + t * t * 250; let b = 12 + u * u * 250; let band = floor(t * 30 + state.dist / 55) % 2 == 0",
      "self.d = 'M' + str(c - a) + ' ' + str(y) + 'H' + str(c + a) + 'L' + str(d + b) + ' ' + str(z) + 'H' + str(d - b) + 'Z'; self.fill = band ? '#363247' : '#302d40'; let lane = get('lane' + str(self.data.n)); lane.d = 'M0 0'",
      "if (band) { let w = max(1, t * 2); lane.d += 'M' + str(c - a / 3 - w) + ' ' + str(y) + 'H' + str(c - a / 3 + w) + 'L' + str(d - b / 3 + w) + ' ' + str(z) + 'H' + str(d - b / 3 - w) + 'Z'; lane.d += 'M' + str(c + a / 3 - w) + ' ' + str(y) + 'H' + str(c + a / 3 + w) + 'L' + str(d + b / 3 + w) + ' ' + str(z) + 'H' + str(d + b / 3 - w) + 'Z' }"
    ],'true'),
    each('post',"self.data.q = (self.data.q + state.speed * dt / 2200) % 1; let q = self.data.q; self.x = 240 + state.curve * (1 - q) * (1 - q) + self.data.side * (18 + q * q * 265); self.y = 112 + q * q * 248; self.scale = 0.1 + q * 1.2"),
    r("if (!state.over && state.scene == 'race') { state.st -= dt; if (state.st <= 0) { spawn('traffic', {x: 240, y: 112, scale: 0.1, layer: 2, tags: ['traffic'], data: {q: 0, lane: (floor(rand(0, 3)) - 1) * 0.63}}); state.st = rand(1.1, 1.9) } }"),
    each('traffic',"self.data.q += max(30, state.speed - 65) * dt / 1500; let q = self.data.q; self.x = 240 + state.curve * (1 - q) * (1 - q) + self.data.lane * (12 + q * q * 250); self.y = 112 + q * q * 248; self.scale = 0.1 + q * 1.4; self.layer = 2 + q * 7; if (q > 1.1) despawn(self)"),
    r("state.crash = 1.2; state.time = max(0, state.time - 3); state.speed = 45; despawn(b); sound('lose')",{on:'hit',tags:['player','traffic'],when:'!state.over && state.crash <= 0'}),
    r("if (state.over && pressed('start')) goto('race'); let t = get('dash'); if (t) t.text = 'TIME ' + str(ceil(state.time)) + '   KMH ' + str(floor(state.speed)); t = get('info'); if (t) t.text = state.over ? 'ENTER TO RACE AGAIN' : str(floor(state.dist)) + '/12000 M   BOOST ' + str(floor(state.boost))")
  ]};
writeFileSync('examples/apex/apex.json', JSON.stringify(doc,null,2)+'\n');
