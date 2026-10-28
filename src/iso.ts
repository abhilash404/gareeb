// Isometric maths.
// Grid coordinates (gx, gy) are measured in tiles: gx runs down-right, gy runs down-left.
// z is height in blocks. Screen coordinates are pixels in the game world.

export const TILE_W = 32; // width of a tile's top face
export const TILE_H = 16; // height of a tile's top face
export const BLOCK_H = 16; // height of a block's side, on screen

export function gridToScreen(gx: number, gy: number, z = 0) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2) - z * BLOCK_H,
  };
}

// The art is drawn at 3x. Moving things are placed on a grid of *screen* pixels (1/ZOOM of an art
// pixel), so they glide in 1-screen-pixel steps instead of jumping 3 at a time.
export const ZOOM = 3;

// Like gridToScreen, but snapped to whole screen pixels along the isometric grid, for things that move.
// Rounding screen x and y separately makes diagonal movement wobble; rounding the grid position
// instead makes every move step in a clean "2 across, 1 down" pattern.
export function gridToPixel(gx: number, gy: number, z = 0) {
  const a = Math.round(gx * (TILE_W / 2) * ZOOM); // 1 unit = 1 screen pixel across
  const b = Math.round(gy * (TILE_W / 2) * ZOOM);
  return {
    x: (a - b) / ZOOM,
    y: (Math.floor((a + b) / 2) - Math.round(z * BLOCK_H * ZOOM)) / ZOOM,
  };
}

// The grid point under a screen position, assuming it lies at height z.
export function screenToGrid(x: number, y: number, z = 0) {
  const a = x / (TILE_W / 2);
  const b = (y + z * BLOCK_H) / (TILE_H / 2);
  return { gx: (a + b) / 2, gy: (b - a) / 2 };
}

// Draw order. The map is drawn in diagonal rows ("planes", gx + gy), back to front;
// within a plane, lower blocks first. Characters and props are drawn after every block
// in their own plane, so blocks in front of them (higher planes) can still cover them.
const PLANE = 64;
export const depth = {
  block: (x: number, y: number, z: number) => (x + y) * PLANE + z,
  // Marks drawn on top of a column's surface at height h (shadows, the mouse highlight).
  onSurface: (x: number, y: number, h: number) => (x + y) * PLANE + h - 0.5,
  prop: (x: number, y: number) => (x + y) * PLANE + PLANE - 2,
  character: (gx: number, gy: number) => (Math.floor(gx) + Math.floor(gy)) * PLANE + PLANE - 1,
  overlay: 1_000_000,
};
