import { BUILD_LIMIT } from '../shared/terrain';
import type { World } from '../shared/world';
import { screenToGrid } from './iso';

// Which face of a block the pointer is on: its top, or its front-left / front-right side.
export type Face = 'top' | 'left' | 'right';
export type BlockHit = { x: number; y: number; z: number; face: Face };

// The block under a point on the screen (world pixels), and which face of it.
//
// Every point on the screen covers a line of grid points going straight away from the camera:
// (gx + t, gy + t, t) for all heights t. We walk that line from above the build limit downwards,
// cell by cell, and the first block we enter is the one you see. The side we entered it through
// is the face under the pointer.
export function pickBlock(world: World, sx: number, sy: number): BlockHit | null {
  const start = BUILD_LIMIT + 1;
  const g = screenToGrid(sx, sy, 0);
  const px = g.gx + start;
  const py = g.gy + start;
  let x = Math.floor(px);
  let y = Math.floor(py);
  // We start exactly on the boundary at height `start`, so we're already in the cell below it.
  let z = start - 1;
  // How far (in t) until the line crosses into the next lower cell on each axis.
  let tx = px - x;
  let ty = py - y;
  let tz = 1;
  for (let i = 0; i < (start + 1) * 3; i++) {
    let face: Face;
    if (tx <= ty && tx <= tz) {
      ty -= tx;
      tz -= tx;
      tx = 1;
      x--;
      face = 'right'; // entered through the block's +x side, which faces down-right on screen
    } else if (ty <= tz) {
      tx -= ty;
      tz -= ty;
      ty = 1;
      y--;
      face = 'left'; // entered through the +y side, which faces down-left
    } else {
      tx -= tz;
      ty -= tz;
      tz = 1;
      z--;
      face = 'top';
    }
    if (z < 0) return null;
    if (world.hasBlock(x, y, z)) return { x, y, z, face };
  }
  return null;
}

// Which column a new block goes on when placing against a face: on top of the block itself,
// or on the neighbouring column on the side you clicked.
export function placeTarget(hit: BlockHit) {
  if (hit.face === 'left') return { x: hit.x, y: hit.y + 1 };
  if (hit.face === 'right') return { x: hit.x + 1, y: hit.y };
  return { x: hit.x, y: hit.y };
}
