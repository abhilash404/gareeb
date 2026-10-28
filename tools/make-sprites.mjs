// Generates placeholder pixel-art sprites into public/assets.
// These are starting points: open the PNGs in Piskel/Aseprite and repaint them,
// keeping the same image sizes and anchor points (see README.md).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const OUT = path.resolve('public/assets');
fs.mkdirSync(OUT, { recursive: true });

const hex = (h, a = 255) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};

// Seeded random numbers so every run produces the same art.
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.png = new PNG({ width: w, height: h });
    this.png.data.fill(0);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    for (let k = 0; k < 4; k++) this.png.data[i + k] = c[k];
  }
  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.png.data[(y * this.w + x) * 4 + 3];
  }
  // 1px outline around every opaque shape.
  outline(c) {
    const pts = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y)) continue;
        if (this.alpha(x - 1, y) || this.alpha(x + 1, y) || this.alpha(x, y - 1) || this.alpha(x, y + 1)) {
          pts.push([x, y]);
        }
      }
    }
    for (const [x, y] of pts) this.set(x, y, c);
  }
  save(name) {
    fs.writeFileSync(path.join(OUT, name), PNG.sync.write(this.png));
    console.log('wrote', name);
  }
}

// ---------- Ground tile: a 32x32 cube (32x16 top face + 16px sides) ----------

const SIDE = 16;

// Which face of the cube a pixel belongs to.
function cubeFace(x, y) {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const d = Math.abs(cx - 16) / 16 + Math.abs(cy - 8) / 8;
  if (d <= 1) return { face: 'top', d };
  const edge = cx < 16 ? 8 + cx / 2 : 16 - (cx - 16) / 2;
  const down = cy - edge;
  if (down > 0 && down <= SIDE) return { face: cx < 16 ? 'left' : 'right', down };
  return null;
}

const C = {
  grass: hex('#5cbf45'),
  grassLight: hex('#6acb4f'),
  grassEdge: hex('#4aa63a'),
  tuft: hex('#3f9334'),
  tuftLight: hex('#7ad85c'),
  grassSideL: hex('#4aa63a'),
  grassSideR: hex('#3c8a30'),
  dirtL: hex('#8b5a3c'),
  dirtR: hex('#6b432c'),
  dirtSpeckL: hex('#9e6a48'),
  dirtSpeckR: hex('#5a3824'),
  pebble: hex('#9a9aa6'),
  pebbleLight: hex('#c4c4cf'),
};

function grassTile(seed) {
  const r = rng(seed);
  const img = new Img(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const f = cubeFace(x, y);
      if (!f) continue;
      if (f.face === 'top') {
        img.set(x, y, f.d > 0.88 ? C.grassEdge : r() < 0.1 ? C.grassLight : C.grass);
      } else {
        const left = f.face === 'left';
        if (f.down <= 3) img.set(x, y, left ? C.grassSideL : C.grassSideR);
        else if (r() < 0.12) img.set(x, y, left ? C.dirtSpeckL : C.dirtSpeckR);
        else img.set(x, y, left ? C.dirtL : C.dirtR);
      }
    }
  }
  // Random point well inside the top face.
  const spot = () => {
    for (;;) {
      const x = 4 + Math.floor(r() * 24);
      const y = 2 + Math.floor(r() * 12);
      const f = cubeFace(x, y);
      if (f && f.face === 'top' && f.d < 0.6) return [x, y];
    }
  };
  // Grass tufts: little "v" marks.
  for (let i = 0; i < 3; i++) {
    const [x, y] = spot();
    img.set(x - 1, y - 1, C.tuft);
    img.set(x, y, C.tuft);
    img.set(x + 1, y - 1, C.tuft);
    img.set(x, y - 1, C.tuftLight);
  }
  // Occasional pebble.
  if (r() < 0.6) {
    const [x, y] = spot();
    img.set(x, y, C.pebble);
    img.set(x + 1, y, C.pebble);
    img.set(x, y - 1, C.pebbleLight);
  }
  return img;
}

// A block with no grass: speckled top and sides, plus a darker seam where it meets the block above.
function plainBlock(seed, c) {
  const r = rng(seed);
  const img = new Img(32, 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const f = cubeFace(x, y);
      if (!f) continue;
      if (f.face === 'top') {
        img.set(x, y, f.d > 0.88 ? c.edge : r() < 0.15 ? c.topSpeck : c.top);
      } else {
        const left = f.face === 'left';
        if (f.down <= 1) img.set(x, y, c.seam);
        else if (r() < 0.15) img.set(x, y, left ? c.leftSpeck : c.rightSpeck);
        else img.set(x, y, left ? c.left : c.right);
      }
    }
  }
  return img;
}

const dirtBlock = () =>
  plainBlock(2001, {
    top: hex('#9a6644'),
    topSpeck: hex('#b07a52'),
    edge: hex('#835437'),
    left: C.dirtL,
    leftSpeck: C.dirtSpeckL,
    right: C.dirtR,
    rightSpeck: C.dirtSpeckR,
    seam: hex('#5a3824'),
  });

const stoneBlock = () =>
  plainBlock(3001, {
    top: hex('#a3a3ae'),
    topSpeck: hex('#b9b9c4'),
    edge: hex('#8c8c97'),
    left: hex('#85858f'),
    leftSpeck: hex('#71717b'),
    right: hex('#696972'),
    rightSpeck: hex('#5a5a62'),
    seam: hex('#4c4c54'),
  });

const sandBlock = () =>
  plainBlock(4001, {
    top: hex('#e6d39a'),
    topSpeck: hex('#f2e3b3'),
    edge: hex('#d4bf84'),
    left: hex('#d2bb7e'),
    leftSpeck: hex('#c2aa6c'),
    right: hex('#b9a165'),
    rightSpeck: hex('#a99158'),
    seam: hex('#9e8750'),
  });

const waterBlock = () =>
  plainBlock(5001, {
    top: hex('#4a9fdc'),
    topSpeck: hex('#7cc0ee'),
    edge: hex('#3f8ccb'),
    left: hex('#3a82c0'),
    leftSpeck: hex('#4a92cf'),
    right: hex('#2f6ea6'),
    rightSpeck: hex('#3a7bb3'),
    seam: hex('#3f8ccb'),
  });

// Wooden planks (placed from wood): boards on top, horizontal boards on the sides.
function planksBlock() {
  const r = rng(6001);
  const img = new Img(32, 32);
  const c = {
    top: hex('#c19358'),
    topSpeck: hex('#cfa266'),
    left: hex('#a87a46'),
    right: hex('#8c6237'),
    speck: hex('#9a6e3e'),
    seam: hex('#6e4a28'),
  };
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const f = cubeFace(x, y);
      if (!f) continue;
      if (f.face === 'top') {
        // Boards run parallel to the top face's back-left edge.
        const board = Math.floor(y + 0.5 + (x + 0.5) / 2);
        img.set(x, y, f.d > 0.88 || board % 6 === 0 ? c.seam : r() < 0.1 ? c.topSpeck : c.top);
      } else {
        const seam = Math.floor(f.down) % 5 === 0;
        img.set(x, y, seam ? c.seam : r() < 0.1 ? c.speck : f.face === 'left' ? c.left : c.right);
      }
    }
  }
  return img;
}

// Outline of a block's left (front-left) or right (front-right) side, for aiming at walls.
function faceOutline(side) {
  const img = new Img(32, 32);
  const white = hex('#ffffff', 220);
  const on = (x, y) => cubeFace(x, y)?.face === side;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (on(x, y) && !(on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1))) img.set(x, y, white);
    }
  }
  return img;
}

// A light line along one back edge of a block's top face, drawn where the ground
// behind it is lower, so ledges stay visible even when their wall faces away from the camera.
function rimTile(side) {
  const img = new Img(32, 32);
  const light = hex('#ffffff', 120);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const f = cubeFace(x, y);
      if (!f || f.face !== 'top' || f.d <= 0.86 || y + 0.5 > 8) continue;
      if (side === 'left' ? x < 16 : x >= 16) img.set(x, y, light);
    }
  }
  return img;
}

function hoverTile() {
  const img = new Img(32, 32);
  const white = hex('#ffffff', 220);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const f = cubeFace(x, y);
      if (f && f.face === 'top' && f.d > 0.86) img.set(x, y, white);
    }
  }
  return img;
}

// ---------- Props ----------

// Fill an ellipse; shadeFn(nx, ny) picks the colour from the normalised position.
function ellipse(img, cx, cy, rx, ry, shadeFn) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) img.set(x, y, shadeFn(nx, ny));
    }
  }
}

// Light comes from the top-left: lighter up-left, darker down-right.
const shade3 = (light, mid, dark) => (nx, ny) => {
  const s = nx * 0.6 + ny * 0.8;
  return s < -0.35 ? light : s > 0.45 ? dark : mid;
};

function tree() {
  const img = new Img(32, 48);
  const trunk = hex('#a5532f');
  const trunkLight = hex('#c46a3d');
  const trunkDark = hex('#7e3d22');
  for (let y = 34; y <= 43; y++) {
    for (let x = 14; x <= 17; x++) img.set(x, y, x === 14 ? trunkLight : x === 17 ? trunkDark : trunk);
  }
  // Roots
  for (const x of [12, 13, 18, 19]) img.set(x, 43, trunkDark);
  img.set(13, 42, trunk);
  img.set(18, 42, trunk);

  const leaves = shade3(hex('#7fd65a'), hex('#4fae3f'), hex('#2f7d33'));
  // Tiers from bottom to top so upper tiers overlap lower ones.
  const tiers = [
    [16, 31, 13, 8],
    [16, 23, 11, 7],
    [16, 15, 8, 6],
    [16, 8, 5, 4.5],
  ];
  for (const [cx, cy, rx, ry] of tiers) {
    ellipse(img, cx, cy, rx, ry, (nx, ny) => (ny > 0.7 ? hex('#2a6e2e') : leaves(nx, ny)));
  }
  img.outline(hex('#1c4423'));
  return img;
}

function rock() {
  const img = new Img(16, 12);
  const s = shade3(hex('#ecdbe6'), hex('#c9b1c2'), hex('#9a8296'));
  ellipse(img, 8, 7, 7, 4.5, s);
  ellipse(img, 7, 5, 4, 3, s);
  img.outline(hex('#5c475a'));
  return img;
}

function shadow() {
  const img = new Img(24, 12);
  ellipse(img, 12, 6, 12, 6, () => hex('#000000', 70));
  return img;
}

// ---------- Player: 12 frames of 16x24 ----------
// Frames 0-2:  facing front (down-right): idle, step A, step B
// Frames 3-5:  facing back  (up-right):  idle, step A, step B
// Frames 6-8:  facing front, action: wind-up, strike, recover
// Frames 9-11: facing back,  action: wind-up, strike, recover
// Left-facing directions are made by flipping these in the game.
// The scarf goes in a separate white sheet (player_scarf.png, same frames) so the game can tint it per player.

const PLAYER_FRAMES = [
  // back: facing up-right; step: which foot is lifted; lean: body shift; fist: [x, y] of a 2x2 fist
  { back: false, step: 0 },
  { back: false, step: 1 },
  { back: false, step: 2 },
  { back: true, step: 0 },
  { back: true, step: 1 },
  { back: true, step: 2 },
  { back: false, step: 0, lean: -1, fist: [2, 14] },
  { back: false, step: 2, lean: 1, fist: [13, 15] },
  { back: false, step: 0, lean: 0, fist: [12, 16] },
  { back: true, step: 0, lean: -1, fist: [2, 12] },
  { back: true, step: 1, lean: 1, fist: [13, 10] },
  { back: true, step: 0, lean: 0, fist: [12, 12] },
];

function playerSheets() {
  const FW = 16;
  const img = new Img(FW * PLAYER_FRAMES.length, 24);
  const scarfImg = new Img(FW * PLAYER_FRAMES.length, 24);
  const hood = hex('#2e2a3a');
  const hoodLight = hex('#433d55');
  const scarf = hex('#ffffff');
  const scarfShade = hex('#c4c4c4');
  const eye = hex('#f4f1ff');
  const feet = hex('#1c1a24');
  const glove = hex('#7a7196');
  const glovelight = hex('#a39bc0');

  PLAYER_FRAMES.forEach(({ back, step, lean = 0, fist }, frame) => {
    const ox = frame * FW;
    const bob = step === 0 ? 0 : -1;
    const bx = ox + lean; // body and head shift; feet stay planted

    // Body
    for (let y = 13; y <= 19; y++) {
      for (let x = 4; x <= 11; x++) img.set(bx + x, y + bob, x === 4 ? hoodLight : hood);
    }
    // Head (hood)
    for (let y = 2; y <= 14; y++) {
      for (let x = 2; x <= 14; x++) {
        const dx = x + 0.5 - 8.5;
        const dy = y + 0.5 - 8.5;
        if (dx * dx + dy * dy <= 31) img.set(bx + x, y + bob, dx + dy < -5 ? hoodLight : hood);
      }
    }
    // Scarf
    for (let x = 4; x <= 12; x++) scarfImg.set(bx + x, 14 + bob, scarf);
    if (!back) scarfImg.set(bx + 12, 15 + bob, scarfShade);
    else scarfImg.set(bx + 4, 15 + bob, scarfShade);
    // Eyes (front only, shifted right because the front frame faces down-right)
    if (!back) {
      for (const x of [9, 12]) {
        img.set(bx + x, 8 + bob, eye);
        img.set(bx + x, 9 + bob, eye);
      }
    }
    // Fist
    if (fist) {
      const [fx, fy] = fist;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        img.set(ox + fx + dx, fy + dy, dx === 0 && dy === 0 ? glovelight : glove);
      }
    }
    // Feet
    const leftUp = step === 1 ? -1 : 0;
    const rightUp = step === 2 ? -1 : 0;
    for (const x of [5, 6]) {
      img.set(ox + x, 20 + leftUp, feet);
      img.set(ox + x, 21 + leftUp, feet);
    }
    for (const x of [9, 10]) {
      img.set(ox + x, 20 + rightUp, feet);
      img.set(ox + x, 21 + rightUp, feet);
    }
  });
  img.outline(hex('#121016'));
  return [img, scarfImg];
}

for (let i = 0; i < 3; i++) grassTile(1000 + i * 77).save(`grass_${i}.png`);
dirtBlock().save('dirt.png');
stoneBlock().save('stone.png');
sandBlock().save('sand.png');
waterBlock().save('water.png');
planksBlock().save('planks.png');
hoverTile().save('tile_hover.png');
faceOutline('left').save('face_left.png');
faceOutline('right').save('face_right.png');
rimTile('left').save('rim_left.png');
rimTile('right').save('rim_right.png');
tree().save('tree.png');
rock().save('rock.png');
shadow().save('shadow.png');
const [player, playerScarf] = playerSheets();
player.save('player.png');
playerScarf.save('player_scarf.png');
