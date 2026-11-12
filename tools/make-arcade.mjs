// Rebuild the original arcade cartridges from compact, editable definitions.
import { mkdirSync, writeFileSync } from 'node:fs';
const rect = (w, h, fill, stroke) => ({d: `M${-w/2} ${-h/2}h${w}v${h}h${-w}Z`, fill, ...(stroke ? {stroke, width: 1.5} : {})});
const path = (d, fill, stroke) => ({d, fill, ...(stroke ? {stroke, width: 2} : {})});
const r = (do_, extra = {}) => ({...extra, do: do_});
const each = (tag, code, when = '!state.over') => r(code, {each: tag, when});
const on = (event, code, extra = {}) => r(code, {on: event, ...extra});
const text = (id, value, y, color = '#7df9ff', size = 12) => ({id, text: value, x: 240, y, size, stroke: color, width: 1.5});
const keys = {ArrowLeft:'left', ArrowRight:'right', a:'left', d:'right', ' ':'fire', Enter:'start'};
const sounds = {hit:{wave:'triangle',freq:660,slide:900,decay:.12,volume:.2}, lose:{wave:'saw',freq:180,slide:-120,decay:.4,volume:.2}};
function game(id, title, description, shapes, state, entities, init, rules, systems = ['motion','lifetime','rules'], extraKeys = {}) {
  const initial = {score:0, over:false, hud:'', ...state};
  const doc = {vertex:1,title,description,width:480,height:360,background:'#0b0e1a',shapes,sounds,
    state:initial, keys:{...keys,...extraKeys}, systems,
    scenes:{play:{state:initial,entities}}, rules:[on('start',"goto('play')"), on('scene',init,{when:"event.name == 'play'"}),
      ...rules, r("if (state.over && pressed('start')) goto('play')"),
      r("state.hud = 'SCORE ' + str(state.score) + (state.over ? '   ENTER TO RESTART' : '')") ]};
  mkdirSync(`examples/${id}`,{recursive:true});
  writeFileSync(`examples/${id}/${id}.json`, JSON.stringify(doc,null,2)+'\n');
}

game('breaker','Breaker','Clear the neon wall. Move with arrows or A/D; space serves. Angle the ball with the edge of your paddle. Three lives.',
  {paddle:rect(72,10,'#7df9ff'),ball:path('M-5 0A5 5 0 1 0 5 0A5 5 0 1 0 -5 0Z','#fff'), brick:rect(52,15,'#ff5d73','#ffabc0')},
  {lives:3,level:1},[{id:'paddle',shape:'paddle',x:240,y:324,tags:['paddle']},{id:'ball',shape:'ball',x:240,y:311,tags:['ball'],data:{ready:true}},text('info','SPACE TO SERVE   3 LIVES',352)],
  "repeat (35) { spawn('brick', {x: 54 + (i % 7) * 62, y: 60 + floor(i / 7) * 25, fill: ['#ff5d73','#ff9f43','#ffcf5a','#7ee081','#7df9ff'][floor(i / 7)], tags: ['brick']}) }",
  [each('paddle',"self.x = clamp(self.x + ((held('right') ? 1 : 0) - (held('left') ? 1 : 0)) * 360 * dt, 38, W - 38)"),
   each('ball',[
     "let p = get('paddle')",
     "if (self.data.ready) { self.x = p.x; self.y = 311; if (pressed('fire')) { self.data.ready = false; self.vx = 125; self.vy = -220 } }",
     "if (self.x < 6) { self.x = 6; self.vx = abs(self.vx) }; if (self.x > W - 6) { self.x = W - 6; self.vx = -abs(self.vx) }; if (self.y < 30) { self.y = 30; self.vy = abs(self.vy) }",
     "if (self.vy > 0 && self.y >= 314 && self.y <= 330 && abs(self.x - p.x) < 41) { self.y = 313; self.vx = (self.x - p.x) * 6; self.vy = -max(180, 270 - abs(self.vx) * 0.25); sound('hit') }",
     "if (self.y > H + 8) { state.lives -= 1; self.vx = 0; self.vy = 0; self.data.ready = true; sound('lose'); if (state.lives <= 0) state.over = true }"
   ]),
   on('hit',"if (alive(b)) { despawn(b); a.y = a.vy < 0 ? b.y + 14 : b.y - 14; a.vy = -a.vy; state.score += 10; sound('hit') }",{tags:['ball','brick'],when:'!state.over'}),
   r("if (!state.over && state.scene == 'play' && count('brick') == 0 && frame > 1) { state.over = true; get('ball').vx = 0; get('ball').vy = 0; spawn(null, {text: 'WALL CLEARED', size: 26, x: 240, y: 180, stroke: '#7ee081', width: 2}) }"),
   r("let t = get('info'); if (t) t.text = 'LIVES ' + str(state.lives) + '   SPACE SERVES   ARROWS MOVE'")],
  ['motion','lifetime',{collideOutline:[['ball','brick']]},'rules']);

game('pulse','Pulse','A formation shooter. Arrows or A/D move; hold space to fire. Clear waves, dodge return fire, protect three shields.',
  {ship:path('M0 -14L15 10H5L0 5L-5 10H-15Z','#7df9ff'),alien:path('M-13 -6L-7 -12L-3 -6H3L7 -12L13 -6V6H8V11H3V5H-3V11H-8V6H-13Z','#b79aff'),shot:rect(3,12,'#ffcf5a'),bolt:rect(5,10,'#ff5d73'),spark:path('M-3 0H3M0 -3V3','none','#ffcf5a')},
  {lives:3,wave:0,dir:1,inv:0,cool:0,fireT:1},[{id:'player',shape:'ship',x:240,y:320,tags:['player']},text('info','HOLD SPACE TO FIRE',352)], '',
  [r("if (!state.over && count('alien') == 0 && state.scene == 'play') { state.wave += 1; state.dir = 1; repeat (24) { spawn('alien', {x: 70 + (i % 8) * 46, y: 60 + floor(i / 8) * 34, tags: ['alien'], fill: ['#b79aff','#ff7b9c','#7ee081'][floor(i / 8)]}) } }"),
   each('player',[
     "self.x = clamp(self.x + ((held('right') ? 1 : 0) - (held('left') ? 1 : 0)) * 270 * dt, 20, W - 20)",
     "state.cool -= dt; state.inv = max(0, state.inv - dt); self.opacity = state.inv > 0 && floor(time * 14) % 2 == 0 ? 0.3 : 1",
     "if (held('fire') && state.cool <= 0) { spawn('shot', {x: self.x, y: self.y - 18, vy: -420, tags: ['shot'], data: {ttl: 1}}); state.cool = 0.2 }"
   ]),
   r("if (!state.over) { let edge = false; let enemies = all('alien'); repeat (count('alien')) { let e = enemies[i]; if ((e.x > W - 25 && state.dir > 0) || (e.x < 25 && state.dir < 0)) edge = true }; if (edge) { state.dir = -state.dir; repeat (count('alien')) enemies[i].y += 12 }; state.fireT -= dt; if (state.fireT <= 0 && count('alien') > 0) { let e = enemies[floor(rand(0, count('alien')))]; spawn('bolt', {x: e.x, y: e.y + 14, vy: 155 + state.wave * 12, tags: ['bolt'], data: {ttl: 3}}); state.fireT = max(0.22, 0.9 - state.wave * 0.08) } }"),
   each('alien',"self.x += state.dir * (22 + state.wave * 7) * dt; if (self.y > 286) state.over = true"),
   on('hit',"despawn(a); despawn(b); state.score += 20; sound('hit'); repeat (4) spawn('spark', {x: b.x, y: b.y, vx: rand(-80,80), vy: rand(-80,80), data: {ttl: 0.25}})",{tags:['shot','alien'],when:'!state.over'}),
   on('hit',"despawn(b); state.lives -= 1; state.inv = 1.2; sound('lose'); if (state.lives <= 0) state.over = true",{tags:['player','bolt'],when:'!state.over && state.inv <= 0'}),
   r("if (state.over) { let e = all('shot'); repeat (count('shot')) e[i].vy = 0; e = all('bolt'); repeat (count('bolt')) e[i].vy = 0 }; let t = get('info'); if (t) t.text = 'WAVE ' + str(state.wave) + '   SHIELDS ' + str(state.lives)")],
  ['motion','lifetime',{collideOutline:[['shot','alien'],['player','bolt']]},'rules']);

game('serpent','Serpent','A grid arcade snake. Arrows or WASD steer. Eat amber fruit, avoid the walls and your tail. Enter restarts.',
  {head:rect(14,14,'#7df9ff','#c8fcff'),tail:rect(12,12,'#348d95'),food:path('M0 -7L7 0L0 7L-7 0Z','#ffcf5a')},
  {dx:1,dy:0,tick:0,length:4,seq:0,nextX:1,nextY:0},
  [{id:'head',shape:'head',x:168,y:184,tags:['head']},{id:'food',shape:'food',x:328,y:184},text('info','EAT GOLD   AVOID YOUR TAIL',350),{d:'M15 39H465V329H15Z',x:0,y:0,stroke:'#263652',fill:'none',width:2}],
  "repeat (3) spawn('tail', {x: 152 - i * 16, y: 184, tags: ['tail'], data: {seq: -i}})",
  [r("if (!state.over) { if (pressed('left') && state.dx != 1) { state.nextX = -1; state.nextY = 0 }; if (pressed('right') && state.dx != -1) { state.nextX = 1; state.nextY = 0 }; if (pressed('up') && state.dy != 1) { state.nextX = 0; state.nextY = -1 }; if (pressed('down') && state.dy != -1) { state.nextX = 0; state.nextY = 1 } }"),
   each('head',[
     "state.tick += dt",
     "if (state.tick >= max(0.065, 0.16 - state.score * 0.0005)) { state.tick = 0; state.dx = state.nextX; state.dy = state.nextY; state.seq += 1; spawn('tail', {x: self.x, y: self.y, tags: ['tail'], data: {seq: state.seq}}); self.x += state.dx * 16; self.y += state.dy * 16; let f = get('food'); if (self.x == f.x && self.y == f.y) { state.length += 1; state.score += 10; sound('hit'); state.foodNeeded = true }; let parts = all('tail'); repeat (count('tail')) { let p = parts[i]; if (p.data.seq <= state.seq - state.length + 1) despawn(p) }; parts = all('tail'); repeat (count('tail')) { if (parts[i].x == self.x && parts[i].y == self.y) state.over = true }; if (self.x < 24 || self.x > 456 || self.y < 56 || self.y > 312) state.over = true }"
   ]),
   r("if (state.foodNeeded && !state.over) { let f = get('food'); let done = false; let offset = floor(rand(0, 476)); repeat (476) { if (!done) { let n = (offset + i) % 476; let x = 24 + (n % 28) * 16; let y = 56 + floor(n / 28) * 16; let h = get('head'); let free = x != h.x || y != h.y; let parts = all('tail'); repeat (count('tail')) { if (parts[i].x == x && parts[i].y == y) free = false }; if (free) { f.x = x; f.y = y; done = true } } }; if (!done) state.over = true; state.foodNeeded = false }")],
  ['rules'],{ArrowUp:'up',ArrowDown:'down',w:'up',s:'down'});

game('lunar','Lunar','Land upright on the amber pad. Left/right rotate, up or space fires the thruster. Watch fuel and descent speed; enter retries.',
  {lander:{parts:[path('M-8 -5L0 -12L8 -5V4H-8Z','#d9e5ff','#7df9ff'),path('M-6 4L-12 12M6 4L12 12M-15 12H-8M8 12H15','none','#ffcf5a')]},flame:path('M-4 5L0 20L4 5Z','#ff9f43'),pad:rect(80,5,'#ffcf5a'),star:rect(1.5,1.5,'#586786')},
  {fuel:100,landed:false},[{id:'player',shape:'lander',x:80,y:80,vx:30,tags:['lander']},{id:'flame',shape:'flame',x:80,y:80,opacity:0},{id:'pad',shape:'pad',x:350,y:314},text('info','ARROWS TURN   SPACE THRUST',350),{d:'M0 314H480V360H0Z',x:0,y:0,fill:'#1e2940'}],
  "repeat (35) spawn('star', {x: rand(10, W - 10), y: rand(36, 240)})",
  [each('lander',[
     "self.rot += ((held('right') ? 1 : 0) - (held('left') ? 1 : 0)) * 2.3 * dt",
     "self.vy += 42 * dt; let thrust = (held('fire') || held('up')) && state.fuel > 0",
     "if (thrust) { self.vx += sin(self.rot) * 100 * dt; self.vy -= cos(self.rot) * 100 * dt; state.fuel = max(0, state.fuel - 12 * dt) }",
     "let f = get('flame'); f.x = self.x; f.y = self.y; f.rot = self.rot; f.opacity = thrust ? 1 : 0",
     "if (self.y >= 300 || self.x < 12 || self.x > W - 12 || self.y < 28) { state.landed = self.y >= 300 && abs(self.x - 350) < 30 && abs(self.vx) < 20 && abs(self.vy) < 35 && abs(sin(self.rot)) < 0.2 && cos(self.rot) > 0; state.over = true; if (state.landed) { state.score = 100 + floor(state.fuel * 5); sound('hit') } else sound('lose'); self.vx = 0; self.vy = 0; f.opacity = 0; spawn(null, {text: state.landed ? 'TOUCHDOWN' : 'HARD LANDING', size: 26, x: 240, y: 170, stroke: state.landed ? '#7ee081' : '#ff5d73', width: 2}) }"
   ]),
   r("let p = get('player'); let t = get('info'); if (t && p) t.text = 'FUEL ' + str(floor(state.fuel)) + '   VX ' + str(round(p.vx)) + '   VY ' + str(round(p.vy))")],
  ['motion','rules'],{ArrowUp:'up',w:'up'});

game('rally','Rally','First to seven wins this paddle duel. Up/down or W/S moves. Space serves. Hit near the paddle edge to change the angle.',
  {paddle:rect(10,66,'#7df9ff'),ball:rect(9,9,'#ffcf5a')},
  {you:0,cpu:0,serve:1},[{id:'player',shape:'paddle',x:24,y:180,tags:['paddle']},{id:'cpu',shape:'paddle',x:456,y:180,tags:['cpu']},{id:'ball',shape:'ball',x:240,y:180,tags:['ball'],data:{ready:true}},text('score','0 : 0',65,'#7df9ff',28),text('info','UP/DOWN MOVE   SPACE SERVES',350),{d:'M240 80V320',x:0,y:0,stroke:'#263652',width:2}], '',
  [each('paddle',"self.y = clamp(self.y + ((held('down') ? 1 : 0) - (held('up') ? 1 : 0)) * 300 * dt, 62, 316)"),
   each('cpu',"let b = get('ball'); self.y += clamp(b.y - self.y, -185 * dt, 185 * dt); self.y = clamp(self.y, 62, 316)"),
   each('ball',[
     "if (self.data.ready && pressed('fire')) { self.data.ready = false; self.vx = 230 * state.serve; self.vy = rand(-110,110) }",
     "if (self.y < 32) { self.y = 32; self.vy = abs(self.vy) }; if (self.y > 342) { self.y = 342; self.vy = -abs(self.vy) }",
     "let p = get('player'); let c = get('cpu'); if (self.vx < 0 && self.x <= 34 && self.x >= 18 && abs(self.y - p.y) < 38) { self.x = 35; self.vx = min(430, abs(self.vx) + 18); self.vy = (self.y - p.y) * 6; sound('hit') }; if (self.vx > 0 && self.x >= 446 && self.x <= 462 && abs(self.y - c.y) < 38) { self.x = 445; self.vx = -min(430, abs(self.vx) + 18); self.vy = (self.y - c.y) * 6; sound('hit') }",
     "if (self.x < -10 || self.x > W + 10) { if (self.x < 0) { state.cpu += 1; state.serve = -1 } else { state.you += 1; state.serve = 1 }; self.x = 240; self.y = 180; self.vx = 0; self.vy = 0; self.data.ready = true; state.score = state.you; sound('lose'); if (state.you >= 7 || state.cpu >= 7) { state.over = true; spawn(null, {text: state.you >= 7 ? 'YOU WIN' : 'CPU WINS', size: 28, x: 240, y: 180, stroke: '#ffcf5a', width: 2}) } }"
   ]), r("let s = get('score'); if (s) s.text = str(state.you) + ' : ' + str(state.cpu)")],
  ['motion','rules'],{ArrowUp:'up',ArrowDown:'down',w:'up',s:'down'});
