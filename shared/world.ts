// Rules shared by the browser and the server, so both agree on where players can go.
import { CHUNK, SEA_LEVEL, BUILD_LIMIT, PROP_KINDS, generateChunk, blockType, type BlockType, type Chunk, type PropKind } from './terrain';
import { ITEM_FROM_BLOCK } from './items';

export const TICK_MS = 1000 / 60; // one movement step; same on client and server
const DT = TICK_MS / 1000;
const SPEED = 3.45; // tiles per second
const RADIUS = 0.2; // half the player's width, in tiles
const GRAVITY = 40; // blocks per second²
const MAX_FALL = 20; // blocks per second
const JUMP_CLEARANCE = 0.25; // extra height above the ledge, so a 1-block jump clears a 1-block step
export const REACH = 1; // how far away (in tiles) you can hit trees and rocks, and place and break blocks
const CHARACTER_HEIGHT = 1.4; // in blocks

// A character's position. gx/gy are in tiles; z is the height of their feet in blocks;
// vz is their vertical speed (up is positive).
export type Body = { gx: number; gy: number; z: number; vz: number };
// What the player is pressing this tick. x/y are screen directions (right/down = +1), each -1, 0 or 1.
export type Input = { x: number; y: number; jump: boolean };
// Per-player numbers that can change later (potions, spells...).
export type Stats = { jumpHeight: number };

export const DEFAULT_STATS: Stats = { jumpHeight: 1 };

const key2 = (x: number, y: number) => `${x},${y}`;

export class World {
  readonly spawn: Body;
  private chunks = new Map<string, Chunk>(); // generated on demand and kept
  private removed = new Set<string>(); // props destroyed by players, keyed "x,y"
  private edits = new Map<string, BlockType[]>(); // columns players changed, bottom block first

  constructor(readonly seed: number) {
    this.spawn = this.findSpawn();
  }

  chunk(cx: number, cy: number) {
    const k = key2(cx, cy);
    let c = this.chunks.get(k);
    if (!c) {
      c = generateChunk(this.seed, cx, cy);
      this.chunks.set(k, c);
    }
    return c;
  }

  // Height of the land in the column at (x, y), not counting water.
  ground(gx: number, gy: number) {
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    return this.chunk(cx, cy).ground[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }

  // Height of the top of the column, including water.
  surface(gx: number, gy: number) {
    const edited = this.edits.get(key2(Math.floor(gx), Math.floor(gy)));
    if (edited) return edited.length;
    return Math.max(this.ground(gx, gy), SEA_LEVEL);
  }

  isWater(gx: number, gy: number) {
    const edited = this.edits.get(key2(Math.floor(gx), Math.floor(gy)));
    if (edited) return edited[edited.length - 1] === 'water';
    return this.ground(gx, gy) < SEA_LEVEL;
  }

  blockAt(x: number, y: number, z: number): BlockType | null {
    const edited = this.edits.get(key2(x, y));
    if (edited) return edited[z] ?? null;
    return blockType(this.ground(x, y), z);
  }

  // ---------- Building ----------

  // The blocks of a column, bottom first (a copy, safe to change).
  column(x: number, y: number): BlockType[] {
    const blocks: BlockType[] = [];
    const top = this.surface(x, y);
    for (let z = 0; z < top; z++) blocks.push(this.blockAt(x, y, z)!);
    return blocks;
  }

  // Replace a column's blocks (a player built or dug there).
  setColumn(x: number, y: number, blocks: BlockType[]) {
    this.edits.set(key2(x, y), blocks);
  }

  // Every column players have changed, as ["x,y", blocks].
  editedColumns() {
    return this.edits.entries();
  }

  // Can a block go on top of column (x, y)? Not on water, trees or rocks, or above the build limit.
  // (The server also checks nobody is standing in the way.)
  canPlaceOn(x: number, y: number) {
    return !this.isWater(x, y) && !this.propAt(x, y) && this.surface(x, y) < BUILD_LIMIT;
  }

  // The top block of column (x, y) if it can be broken: not water, nothing standing on it,
  // and never the bottom block (so there's no hole to fall out of the world through).
  breakableTop(x: number, y: number): BlockType | null {
    const top = this.surface(x, y);
    if (top <= 1 || this.propAt(x, y)) return null;
    const type = this.blockAt(x, y, top - 1);
    return type && ITEM_FROM_BLOCK[type] ? type : null;
  }

  // Is column (x, y) within building reach of a character? `slack` lets the server allow for lag.
  inBuildReach(b: Body, x: number, y: number, slack = 0) {
    const dx = Math.max(x - b.gx, 0, b.gx - (x + 1));
    const dy = Math.max(y - b.gy, 0, b.gy - (y + 1));
    return Math.max(dx, dy) <= REACH + slack && Math.abs(this.surface(x, y) - b.z) <= REACH + 1 + slack;
  }

  // Would a block at height z on column (x, y) be inside this character?
  overlapsBlock(b: Body, x: number, y: number, z: number) {
    if (b.z >= z + 1 || b.z + CHARACTER_HEIGHT <= z) return false;
    return corners(b.gx, b.gy).some(([cx, cy]) => Math.floor(cx) === x && Math.floor(cy) === y);
  }

  hasBlock(x: number, y: number, z: number) {
    return z >= 0 && z < this.surface(x, y);
  }

  // The tree/rock standing on (x, y), unless a player destroyed it.
  propAt(gx: number, gy: number): PropKind | null {
    const x = Math.floor(gx);
    const y = Math.floor(gy);
    if (this.removed.has(key2(x, y))) return null;
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    return PROP_KINDS[this.chunk(cx, cy).props[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)]];
  }

  // Free generated chunks further than `radius` tiles from all of these points. They're rebuilt
  // from the seed if needed again; players' changes are kept separately, so nothing is lost.
  forgetChunksAwayFrom(points: { gx: number; gy: number }[], radius: number) {
    for (const k of this.chunks.keys()) {
      const [cx, cy] = k.split(',').map(Number);
      const midX = (cx + 0.5) * CHUNK;
      const midY = (cy + 0.5) * CHUNK;
      const near = points.some((p) => Math.max(Math.abs(p.gx - midX), Math.abs(p.gy - midY)) <= radius + CHUNK);
      if (!near) this.chunks.delete(k);
    }
  }

  // A tree or rock was destroyed: it no longer exists or blocks movement.
  removeProp(x: number, y: number) {
    this.removed.add(key2(x, y));
  }

  // The highest ground under a character's feet (they're RADIUS wide, so check all four corners).
  groundUnder(gx: number, gy: number) {
    let ground = -Infinity;
    for (const [cx, cy] of corners(gx, gy)) ground = Math.max(ground, this.surface(cx, cy));
    return ground;
  }

  isOnGround(b: Body) {
    return b.vz === 0 && b.z === this.groundUnder(b.gx, b.gy);
  }

  // Is the tile (x, y) within reach of a character? `slack` lets the server allow for lag.
  inReach(b: Body, x: number, y: number, slack = 0) {
    // Distance from the character to the nearest edge of the tile, along each axis.
    const dx = Math.max(x - b.gx, 0, b.gx - (x + 1));
    const dy = Math.max(y - b.gy, 0, b.gy - (y + 1));
    return Math.max(dx, dy) <= REACH + slack && Math.abs(this.surface(x, y) - b.z) <= 1.5 + slack;
  }

  // Advance one tick. Must give identical results on client and server.
  step(b: Body, input: Input, stats: Stats): Body {
    let { gx, gy, z, vz } = b;

    if (input.x !== 0 || input.y !== 0) {
      // Screen right = grid (+1, -1), screen down = grid (+1, +1).
      let vx = input.x + input.y;
      let vy = input.y - input.x;
      const len = Math.hypot(vx, vy);
      vx = (vx / len) * SPEED * DT;
      vy = (vy / len) * SPEED * DT;
      // One axis at a time so you slide along walls instead of sticking.
      if (this.canStand(gx + vx, gy, z)) gx += vx;
      if (this.canStand(gx, gy + vy, z)) gy += vy;
    }

    const ground = this.groundUnder(gx, gy);
    // Jump: launch fast enough to rise jumpHeight blocks (plus a little clearance).
    if (input.jump && vz === 0 && z === ground) {
      vz = Math.sqrt(2 * GRAVITY * (stats.jumpHeight + JUMP_CLEARANCE));
    }

    if (z > ground || vz !== 0) {
      vz = Math.max(vz - GRAVITY * DT, -MAX_FALL);
      z += vz * DT;
      if (z <= ground) {
        z = ground; // landed
        vz = 0;
      }
    } else if (z < ground) {
      z = ground; // shouldn't happen, but never sink into the ground
    }
    return { gx, gy, z, vz };
  }

  // Can a character with feet at height z move to (gx, gy)? Not into water, trees, rocks,
  // or anything above their feet.
  private canStand(gx: number, gy: number, z: number) {
    for (const [cx, cy] of corners(gx, gy)) {
      if (this.isWater(cx, cy) || this.propAt(cx, cy)) return false;
      if (this.surface(cx, cy) > z + 1e-9) return false; // a wall or ledge: jump onto it
    }
    return true;
  }

  // Spiral out from (0, 0) to the first dry, open, fairly flat spot.
  private findSpawn(): Body {
    const ok = (x: number, y: number) => {
      if (this.isWater(x, y) || this.propAt(x, y)) return false;
      const h = this.ground(x, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (this.isWater(x + dx, y + dy) || Math.abs(this.ground(x + dx, y + dy) - h) > 1) return false;
        }
      }
      return true;
    };
    for (let r = 0; r < 256; r++) {
      for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
          if (Math.max(Math.abs(x), Math.abs(y)) !== r) continue; // only the ring at distance r
          if (ok(x, y)) return { gx: x + 0.5, gy: y + 0.5, z: this.ground(x, y), vz: 0 };
        }
      }
    }
    return { gx: 0.5, gy: 0.5, z: this.surface(0, 0), vz: 0 };
  }
}

function corners(gx: number, gy: number) {
  const r = RADIUS;
  return [
    [gx - r, gy - r],
    [gx + r, gy - r],
    [gx - r, gy + r],
    [gx + r, gy + r],
  ];
}
