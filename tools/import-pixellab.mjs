// Turns a PixelLab character into a game sprite sheet (public/characters/<name>.png).
//
// Usage: npm run import-character -- <PixelLab character id | export folder | export .zip> <race_class>
//   e.g. npm run import-character -- a118c78d-2bbb-4b17-8253-8a0c8f1c9e0d human_knight
//
// The PixelLab character needs, for the south-east and north-east directions:
//   - its standing pose (always there), used as the idle frame
//   - an animation named "walk" (4 frames are used; other counts are spread out to 4)
//   - an animation named "attack" (3 frames are used: wind-up, strike, recover)
// Missing animations fall back to the standing pose, so the sheet still works.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const FRAME = 32; // frame size in the game's sheet
const FEET_ROW = 30; // feet stand on this pixel row in every frame
const DIRS = ['south-east', 'north-east']; // sheet row 1 faces down-right, row 2 up-right
const COLS = 8; // idle, walk x4, attack x3

const [source, name] = process.argv.slice(2);
if (!source || !/^[a-z]+_[a-z]+$/.test(name ?? '')) {
  console.error('Usage: npm run import-character -- <character id | export folder | .zip> <race_class>');
  process.exit(1);
}

// ---------- Get the export folder ----------

// Extract next to the zip using relative paths: some tar versions read "C:\..." as a network address.
function unzip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.relative(dir, zip);
  try {
    execFileSync('tar', ['-xf', rel], { cwd: dir, stdio: 'ignore' }); // Windows 10+ and macOS tar read zips
  } catch {
    execFileSync('unzip', ['-o', '-q', rel, '-d', '.'], { cwd: dir, stdio: 'ignore' });
  }
}

async function exportFolder() {
  if (fs.existsSync(source) && fs.statSync(source).isDirectory()) return source;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixellab-'));
  let zip = source;
  if (!fs.existsSync(source)) {
    const res = await fetch(`https://api.pixellab.ai/mcp/characters/${source}/download`);
    if (res.status === 423) throw new Error('PixelLab is still working on this character; try again when its jobs finish.');
    if (!res.ok) throw new Error(`Download failed (${res.status}). Is "${source}" a PixelLab character id?`);
    zip = path.join(tmp, 'export.zip');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }
  unzip(zip, path.join(tmp, 'export'));
  return path.join(tmp, 'export');
}

// ---------- Pixel helpers ----------

const read = (file) => PNG.sync.read(fs.readFileSync(file));
const alpha = (img, x, y) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3]);

function bottomRow(img) {
  for (let y = img.height - 1; y >= 0; y--) for (let x = 0; x < img.width; x++) if (alpha(img, x, y)) return y;
  return -1;
}

// Take `count` frames spread evenly through a list (keeps first and last).
function spread(list, count) {
  if (list.length <= count) return list;
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
}

// ---------- Build the sheet ----------

const folder = await exportFolder();
const meta = JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8'));
const state = meta.states.find((s) => Object.keys(s.frames.animations ?? {}).length) ?? meta.states[0];
const file = (rel) => path.join(folder, rel);

const sheet = new PNG({ width: COLS * FRAME, height: DIRS.length * FRAME });
sheet.data.fill(0);
let clipped = 0;
let soft = 0;
const notes = [];

DIRS.forEach((dir, row) => {
  const idle = read(file(state.frames.rotations[dir]));
  // PixelLab centres every canvas on the same point; animations may use a bigger canvas than the pose.
  const idleFeet = bottomRow(idle) - (idle.height - FRAME) / 2;
  const shift = FEET_ROW - Math.round(idleFeet); // moves the standing pose's feet onto FEET_ROW

  // Copy one PixelLab frame into a sheet cell, centred, with its feet lined up.
  const place = (img, col, feetFix) => {
    const ox = Math.floor((img.width - FRAME) / 2);
    const oy = Math.floor((img.height - FRAME) / 2) - shift - feetFix;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const a = alpha(img, x, y);
        if (!a) continue;
        const dx = x - ox;
        const dy = y - oy;
        if (dx < 0 || dy < 0 || dx >= FRAME || dy >= FRAME) {
          clipped++;
          continue;
        }
        if (a < 255) soft++;
        const si = (y * img.width + x) * 4;
        const di = ((row * FRAME + dy) * sheet.width + col * FRAME + dx) * 4;
        sheet.data.set(img.data.subarray(si, si + 4), di);
      }
    }
  };

  place(idle, 0, 0);

  const anim = (names, count, firstCol) => {
    const key = names.find((n) => state.frames.animations?.[n]?.[dir]);
    if (!key) {
      notes.push(`no "${names[0]}" animation facing ${dir}: using the standing pose`);
      for (let i = 0; i < count; i++) place(idle, firstCol + i, 0);
      return;
    }
    const frames = spread(state.frames.animations[key][dir], count).map((f) => read(file(f)));
    // Keep the animation standing at the same height as the pose (PixelLab sometimes redraws it
    // slightly smaller), judged by its first frame so jumps and bobs inside it are kept.
    const first = frames[0];
    const feet = bottomRow(first) - (first.height - FRAME) / 2;
    const feetFix = Math.round(idleFeet - feet);
    frames.forEach((img, i) => place(img, firstCol + i, feetFix));
  };
  anim(['walk', 'walking'], 4, 1);
  anim(['attack'], 3, 5);
});

const out = path.resolve('public/characters', `${name}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, PNG.sync.write(sheet));
console.log(`wrote ${path.relative(process.cwd(), out)} (${sheet.width}x${sheet.height})`);
for (const n of notes) console.log(`  note: ${n}`);
if (clipped) console.log(`  warning: ${clipped} pixels fell outside the 32x32 frames and were cut off`);
if (soft) console.log(`  warning: ${soft} semi-transparent pixels (blurry edges); the art may be anti-aliased`);
console.log('Restart `npm run dev` (or run `npm run atlas`) to use it in the game.');
