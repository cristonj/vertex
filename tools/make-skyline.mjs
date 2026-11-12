import {readFileSync,writeFileSync} from 'node:fs';
import {box,plane} from '../src/space.js';
const doc=JSON.parse(readFileSync('examples/skyline/skyline.json','utf8'));
const shapes={car:doc.shapes.car,gem:doc.shapes.gem};
shapes.paving={mesh:plane(80,80),fill:'#313e50',shade:false};
shapes.park={mesh:plane(80,80),fill:'#456e5d',shade:false};
shapes.lane={mesh:plane(3,24),fill:'#efd9a2',shade:false};
shapes.crossing={mesh:plane(22,4),fill:'#bdc9cc',shade:false};
shapes.sidewalk={mesh:plane(80,12),fill:'#809293',shade:false};
const palettes=['#7394aa','#baa18c','#8a9faf','#72877c','#a99bb0'];
for(let n=0;n<5;n++){
  const h=50+n*24;shapes['building'+n]={mesh:box(100,h,110),fill:palettes[n],stroke:'#455564',width:.4};
  shapes['roof'+n]={mesh:box(90,4,100),fill:'#bfd6cc'};
}
shapes.trunk={mesh:box(5,20,5),fill:'#927865'};
shapes.tree={mesh:box(22,24,22),fill:'#3b8d6e'};
const entities=[{id:'player',shape:'car',x:0,y:0,z:0,ry:0,tags:['player'],data:{speed:0}},
  {id:'map-panel',d:'M374 174H472V290H374Z',fill:'#0e192b',stroke:'#7d9baf',width:1,layer:30},
  {id:'map-roads',d:'M392 188V276M418 188V276M444 188V276M380 200H462M380 222H462M380 244H462M380 266H462',stroke:'#526e82',width:4,layer:31},
  {id:'map-player',d:'M0 -4L3 3L0 1L-3 3Z',fill:'#ff5d73',layer:33,x:418,y:266},
  {id:'map-label',text:'CITY MAP',x:423,y:185,size:7,stroke:'#fff',width:1,layer:32},
  {id:'help',text:'ARROWS DRIVE   CYAN DOTS ARE GEMS',size:9,x:220,y:292,stroke:'#d3e4ef',width:1.2,layer:40}];
// Generate the city on scene entry: the published cartridge stays compact.
const buildCity = [
  "repeat (340) { let x = -640 + (i % 17)*80; let z = -160 + floor(i/17)*80; let road = abs(x)<=40 || abs(x-400)<=40 || abs(x+400)<=40 || abs(z)<=40 || abs(z-400)<=40 || abs(z-800)<=40 || abs(z-1200)<=40; spawn(road?'paving':'park',{x:x,y:1,z:z,layer:-10}); if(road && (x==0 || x==400 || x==-400) && z!=0 && z!=400 && z!=800 && z!=1200) spawn('lane',{x:x,y:0,z:z,layer:-9}); if(road && (z==0 || z==400 || z==800 || z==1200) && x!=0 && x!=400 && x!=-400) spawn('lane',{x:x,y:0,z:z,ry:PI/2,layer:-9}) }",
  "let xs=[-580,-220,220,580]; let zs=[180,580,980]; repeat(12) { let x=xs[i%4]; let z=zs[floor(i/4)]; let n=(abs(x/20)+z/20)%5; let h=50+n*24; spawn('building'+str(n),{x:x,y:-h/2,z:z,tags:['building']}); spawn('roof'+str(n),{x:x,y:-h-2,z:z}); spawn('trunk',{x:x-80,y:-10,z:z-35}); spawn('tree',{x:x-80,y:-30,z:z-35}); spawn('trunk',{x:x+80,y:-10,z:z-35}); spawn('tree',{x:x+80,y:-30,z:z-35}) }",
  "let gx=[0,0,400,400,-400,-400]; let gz=[180,650,800,400,400,0]; repeat(6) { spawn('gem',{id:'gem'+str(i),x:gx[i],y:-9,z:gz[i],vry:1.5,tags:['gem'],data:{map:'map-gem'+str(i)}}); spawn(null,{id:'map-gem'+str(i),d:'M0 -3L3 0L0 3L-3 0Z',fill:'#7df9ff',x:418+gx[i]*0.065,y:266-gz[i]*0.055,layer:32}) }"
];
doc.shapes=shapes;doc.scenes.drive.entities=entities;
doc.description='Drive a connected city grid with parks, blocks and six gems. Use the minimap to plan a route. Arrows/WASD drive, down reverses, space brakes. Collect all six before time runs out.';
doc.background='#aecbdf';doc.space.fog={color:'#aecbdf',near:650,far:1800};doc.space.camera={x:0,y:-70,z:-160,yaw:0,pitch:.3,fov:65,near:2,far:1900};
doc.keys[' ']='brake';doc.state={gems:0,time:120,over:false,hud:'',bump:0};doc.scenes.drive.state={...doc.state};
doc.rules=[
  {on:'start',do:"goto('drive')"},
  {on:'scene',when:"event.name == 'drive'",do:buildCity},
  {each:'player',when:'!state.over',do:[
    "let turn = (held('right') ? 1 : 0) - (held('left') ? 1 : 0); let throttle = (held('go') ? 1 : 0) - (held('back') ? 0.5 : 0)",
    "self.data.speed += (throttle * 180 - self.data.speed) * min(1, (held('brake') ? 9 : 2.5) * dt); if (held('brake')) self.data.speed *= max(0, 1 - 8 * dt)",
    "self.ry += turn * 1.7 * dt * clamp(self.data.speed / 100, -1, 1); self.vx = sin(self.ry) * self.data.speed; self.vz = cos(self.ry) * self.data.speed; self.rz = -turn * self.data.speed * 0.0002",
    "self.x = clamp(self.x, -625, 625); self.z = clamp(self.z, -140, 1340); state.bump = max(0, state.bump - dt)",
    "let m = get('map-player'); m.x = 418 + self.x * 0.065; m.y = 266 - self.z * 0.055; m.rot = self.ry"
  ]},
  {on:'hit',tags:['player','gem'],when:'!state.over',do:"despawn(b.data.map); despawn(b); state.gems += 1; sound('gem')"},
  {on:'hit',tags:['player','building'],when:'!state.over',do:"a.x -= a.vx * dt * 2; a.z -= a.vz * dt * 2; a.vx = 0; a.vz = 0; a.data.speed = -a.data.speed * 0.2; if (state.bump <= 0) { sound('bump'); state.bump = 0.5 }"},
  {when:'!state.over',do:"state.time = max(0, state.time - dt); if (state.time <= 0 || state.gems >= 6) { state.over = true; let p = get('player'); p.vx = 0; p.vz = 0; spawn(null, {text: state.gems >= 6 ? 'CITY CLEARED' : 'TIME UP', size: 28, x: 220, y: 120, stroke: '#ffcf5a', width: 2, layer: 50}); spawn(null, {text: 'ENTER TO DRIVE AGAIN', size: 11, x: 220, y: 155, stroke: '#fff', width: 1.5, layer: 50}) }"},
  {when:"state.over && pressed('start')",do:"goto('drive')"},
  {do:"state.hud = 'GEMS ' + str(state.gems) + '/6   TIME ' + str(ceil(state.time))"}
];
doc.sounds.bump={wave:'noise',freq:400,slide:-200,decay:.15,volume:.15};
// Keep vertex/face tuples on one line; whitespace should not dominate the cartridge.
const json=JSON.stringify(doc,null,2).replace(/\[\s*-?\d[\d.eE+,\s-]*\]/g, a=>JSON.stringify(JSON.parse(a)));
writeFileSync('examples/skyline/skyline.json',json+'\n');
