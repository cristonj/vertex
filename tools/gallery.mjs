// The gallery and README sizes are generated from the actual UTF-8 game source.
import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
export const games = [
  ['apex','Apex','Coastal racing with smooth steering, near misses, boost and checkpoints.','Arrows drive · Space boosts','#ff5d73','M19 41L22 23L27 18H37L42 23L45 41ZM25 27H39M22 36H28M36 36H42M12 50L24 10M52 50L40 10'],
  ['drift','Drift','The original vector space shooter, with outline collisions and time rewind.','Arrows fly · Space fires · R rewinds','#7df9ff','M12 48L32 12L52 48L32 39ZM25 45L32 55L39 45M10 15L17 11L23 17L18 24L10 23Z'],
  ['breaker','Breaker','Clear a neon wall. Paddle placement controls the bounce. Three lives.','← → move · Space serves','#ff7b9c','M12 14H26V22H12ZM30 14H44V22H30ZM16 27H30V35H16ZM34 27H48V35H34ZM19 49H45M38 39L42 43'],
  ['pulse','Pulse','Four formations, diving attackers, return fire and escalating waves.','← → move · Hold Space to fire','#b79aff','M17 21L23 14L28 21H36L41 14L47 21V34H40V39H35V32H29V39H24V34H17ZM25 26H27M37 26H39M32 44V51'],
  ['serpent','Serpent','Grow a luminous snake. Each fruit speeds up the grid.','Arrows / WASD steer','#7ee081','M17 15H43V27H22V39H44V50H14M43 14V10M43 17H47M47 36L52 41L47 46L42 41Z'],
  ['rally','Rally','A paddle duel against a beatable CPU. First to seven takes the match.','↑ ↓ move · Space serves','#ffcf5a','M14 18V43M50 23V48M31 12V20M31 26V34M31 40V48M24 30H28V34H24Z'],
  ['lunar','Lunar','A fuel-limited lander. Control angle and velocity for a soft touchdown.','← → rotate · ↑ / Space thrust','#c5d5ff','M23 23L32 14L41 23V36H23ZM25 36L17 47M39 36L47 47M28 39L32 49L36 39M12 53H52'],
  ['starfall','Starfall','Catch gold, dodge red. Play here or use the full player; keys and drag both work.','← → move · Enter retries','#ffd166','M32 8L37 20L50 21L40 30L43 43L32 36L21 43L24 30L14 21L27 20ZM15 45L20 53H44L49 45'],
  ['ascent','Ascent','Two platforming stages with variable jumps, gems and a summit.','← → move · Space jumps','#ff9f43','M10 49H25M29 37H42M43 23H55M19 37V24H29V37ZM46 19V8L57 12L46 16M33 22L37 27L33 32L29 27Z'],
  ['skyline','Skyline','A connected 3D city grid with parks, six gems and a live minimap.','Arrows / WASD drive','#9ec4e8','M10 48V24L22 17L34 24V48M22 17V48M34 48V15L45 9L55 15V48M45 9V48M15 29L19 27M15 36L19 34M39 22L43 20'],
  ['frontier','Frontier','Explore an endless forest, gather gold and talk to wanderers. Solo or online.','WASD explore · E talks','#a6db9b','M18 11L7 32H14L9 42H27L22 32H29ZM44 20L33 41H40L35 50H53L48 41H55ZM18 42V52M30 53L35 45']
].map(([id,title,description,controls,color,d])=>({id,title,description,controls,color,d,source:`examples/${id}/${id}.${id==='drift'?'js':'json'}`}));
const size = n => `${(n/1024).toFixed(1)} KiB`;
export function buildGallery() {
  const rows=[], cards=[];
  for(const g of games) {
    // Normalize repository line endings so checkout settings cannot stale the numbers.
    const bytes=Buffer.from(readFileSync(g.source,'utf8').replace(/\r\n/g,'\n'));
    const raw=bytes.length, gz=gzipSync(bytes,{level:9}).length;
    const icon=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>${g.title}</title><rect width="64" height="64" rx="14" fill="#1a2132"/><path d="${g.d}" fill="none" stroke="${g.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
    writeFileSync(`examples/${g.id}/icon.svg`,icon);
    const href=g.id==='drift'?'examples/drift/':`play.html?src=${g.source}`;
    cards.push(`      <a class="card" href="${href}"><img src="examples/${g.id}/icon.svg" alt="" width="56" height="56" loading="lazy"><b>${g.title}</b><span>${g.description}</span><small>${g.controls}</small><span class="meta" title="${raw.toLocaleString('en-US')} source bytes; ${gz.toLocaleString('en-US')} gzip bytes">${size(raw)} source · ${size(gz)} gzip</span></a>`);
    rows.push(`| [${g.title}](${g.source}) | ${g.description} | ${size(raw)} | ${size(gz)} |`);
  }
  const p='index.html';let html=readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  html=html.replace(/<!-- GAMES:START -->[\s\S]*?<!-- GAMES:END -->/,`<!-- GAMES:START -->\n    <div class="games">\n${cards.join('\n')}\n    </div>\n    <!-- GAMES:END -->`);writeFileSync(p,html);
  const rp='README.md';let md=readFileSync(rp,'utf8').replace(/\r\n/g,'\n');
  md=md.replace(/<!-- GAMES:START -->[\s\S]*?<!-- GAMES:END -->/,`<!-- GAMES:START -->\n| Game | Gameplay | Source | Gzip |\n|---|---|---:|---:|\n${rows.join('\n')}\n\nSizes measure each complete game source with LF line endings. Gzip uses level 9; the shared engine, player and optional icon are excluded. Rebuild with \`node tools/gallery.mjs\`.\n<!-- GAMES:END -->`);writeFileSync(rp,md);
}
if(process.argv[1]?.replace(/\\/g,'/').endsWith('/gallery.mjs')) buildGallery();
