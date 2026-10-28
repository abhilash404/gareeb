// Packs the world sprites from public/assets into one image + index (public/atlas/terrain.*), so the
// graphics card can draw the whole world from a single texture. Ground tiles are also combined with
// their ledge rims here, so rims don't need sprites of their own.
// Runs automatically on `npm run dev`; edit the individual PNGs in public/assets, not the atlas.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SRC = path.resolve('public/assets');
const OUT = path.resolve('public/atlas');
const SPRITES = [
  'grass_0', 'grass_1', 'grass_2', 'dirt', 'stone', 'sand', 'water', 'planks',
  'tile_hover', 'face_left', 'face_right', 'tree', 'rock', 'shadow',
];
const CAN_HAVE_RIMS = ['grass_0', 'grass_1', 'grass_2', 'dirt', 'stone', 'sand', 'planks']; // can be the top of a ledge
const ATLAS_WIDTH = 256;
const PAD = 2; // empty pixels between sprites so they never bleed into each other

const read = (name) => PNG.sync.read(fs.readFileSync(path.join(SRC, `${name}.png`)));

// Draw `top` over `base` (normal alpha blending), returning a new image.
function over(base, top) {
  const out = new PNG({ width: base.width, height: base.height });
  base.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) {
    const a = top.data[i + 3] / 255;
    if (a === 0) continue;
    for (let k = 0; k < 3; k++) out.data[i + k] = Math.round(top.data[i + k] * a + out.data[i + k] * (1 - a));
    out.data[i + 3] = Math.max(out.data[i + 3], top.data[i + 3]);
  }
  return out;
}

const frames = SPRITES.map((name) => ({ name, png: read(name) }));
const rimLeft = read('rim_left');
const rimRight = read('rim_right');
for (const name of CAN_HAVE_RIMS) {
  const base = frames.find((f) => f.name === name).png;
  frames.push({ name: `${name}_rimL`, png: over(base, rimLeft) });
  frames.push({ name: `${name}_rimR`, png: over(base, rimRight) });
  frames.push({ name: `${name}_rimLR`, png: over(over(base, rimLeft), rimRight) });
}

// Simple shelf packing: left to right, starting a new row when full.
let x = 0;
let y = 0;
let rowHeight = 0;
for (const f of frames) {
  if (x + f.png.width > ATLAS_WIDTH) {
    x = 0;
    y += rowHeight + PAD;
    rowHeight = 0;
  }
  f.x = x;
  f.y = y;
  x += f.png.width + PAD;
  rowHeight = Math.max(rowHeight, f.png.height);
}
const height = y + rowHeight;

const atlas = new PNG({ width: ATLAS_WIDTH, height });
atlas.data.fill(0);
const json = { frames: {}, meta: { image: 'terrain.png', size: { w: ATLAS_WIDTH, h: height }, scale: '1' } };
for (const f of frames) {
  PNG.bitblt(f.png, atlas, 0, 0, f.png.width, f.png.height, f.x, f.y);
  const size = { w: f.png.width, h: f.png.height };
  json.frames[f.name] = {
    frame: { x: f.x, y: f.y, ...size },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, ...size },
    sourceSize: size,
  };
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'terrain.png'), PNG.sync.write(atlas));
fs.writeFileSync(path.join(OUT, 'terrain.json'), JSON.stringify(json, null, 1));
console.log(`packed ${frames.length} sprites into atlas/terrain.png (${ATLAS_WIDTH}x${height})`);
