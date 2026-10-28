import Phaser from 'phaser';
import { CHUNK, BUILD_LIMIT, random, type PropKind } from '../shared/terrain';
import type { World } from '../shared/world';
import { gridToScreen, depth, TILE_W, TILE_H, BLOCK_H } from './iso';

const EXTRA_RADIUS = 6; // tiles loaded beyond the screen edge, so walking never shows a gap
const UNLOAD_MARGIN = 10; // chunks are kept this many tiles beyond the load radius before being dropped
const LOADS_PER_FRAME = 2; // spread loading out so walking stays smooth
const TREE_HEIGHT = 3; // in blocks: how far props can stick up above a chunk's highest ground

export type PropView = {
  kind: PropKind;
  x: number;
  y: number;
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  baseX: number;
  chunk: LoadedChunk;
};

type LoadedChunk = {
  cx: number;
  cy: number;
  objects: Phaser.GameObjects.Image[];
  props: Set<string>;
  bounds: Phaser.Geom.Rectangle; // area of the screen the chunk can cover
  visible: boolean;
};

// Draws the world chunk by chunk around the player, and only what's on screen.
export class TerrainView {
  readonly props = new Map<string, PropView>(); // loaded trees/rocks, keyed "x,y"
  private chunks = new Map<string, LoadedChunk>();

  constructor(
    private scene: Phaser.Scene,
    private world: World,
  ) {}

  // Load chunks near (gx, gy), nearest first, unload far ones, and hide chunks that are off screen.
  // `all` loads everything needed at once (on spawn).
  update(gx: number, gy: number, all = false) {
    const view = this.scene.cameras.main.worldView;
    // How many tiles from the player to the screen corners (screen x covers gx - gy, screen y gx + gy).
    const radius = Math.ceil((view.width / TILE_W + view.height / TILE_H) / 2) + EXTRA_RADIUS;

    const pcx = Math.floor(gx / CHUNK);
    const pcy = Math.floor(gy / CHUNK);
    const r = Math.ceil(radius / CHUNK) + 1;
    const wanted: { cx: number; cy: number; d: number }[] = [];
    for (let cy = pcy - r; cy <= pcy + r; cy++) {
      for (let cx = pcx - r; cx <= pcx + r; cx++) {
        const d = distanceToChunk(gx, gy, cx, cy);
        if (d <= radius && !this.chunks.has(`${cx},${cy}`)) wanted.push({ cx, cy, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const { cx, cy } of all ? wanted : wanted.slice(0, LOADS_PER_FRAME)) this.load(cx, cy);

    for (const [key, chunk] of this.chunks) {
      if (distanceToChunk(gx, gy, chunk.cx, chunk.cy) > radius + UNLOAD_MARGIN) {
        this.unload(key);
        continue;
      }
      // Hidden objects are skipped entirely when drawing.
      const visible = Phaser.Geom.Rectangle.Overlaps(chunk.bounds, view);
      if (visible !== chunk.visible) this.setChunkVisible(chunk, visible);
    }
  }

  // Free terrain data the world generated for chunks we no longer show.
  forgetFarTerrain(gx: number, gy: number) {
    const view = this.scene.cameras.main.worldView;
    const radius = Math.ceil((view.width / TILE_W + view.height / TILE_H) / 2) + EXTRA_RADIUS;
    this.world.forgetChunksAwayFrom([{ gx, gy }], radius + UNLOAD_MARGIN + CHUNK);
  }

  // A column changed (built on or dug into): redraw the chunks it and its neighbours are in.
  // Neighbours matter because their hidden faces and ledge rims depend on this column's height.
  columnChanged(x: number, y: number) {
    const keys = new Set<string>();
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      keys.add(`${Math.floor((x + dx) / CHUNK)},${Math.floor((y + dy) / CHUNK)}`);
    }
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      this.unload(key);
      this.load(chunk.cx, chunk.cy);
    }
  }

  removeProp(x: number, y: number) {
    const key = `${x},${y}`;
    const view = this.props.get(key);
    if (!view) return;
    view.image.destroy();
    view.shadow.destroy();
    view.chunk.props.delete(key);
    this.props.delete(key);
  }

  private load(cx: number, cy: number) {
    const w = this.world;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const chunk: LoadedChunk = { cx, cy, objects: [], props: new Set(), bounds: chunkBounds(cx, cy), visible: true };

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        const y = y0 + ly;
        const top = w.surface(x, y);
        for (let z = 0; z < top; z++) {
          // Skip blocks completely covered by the blocks above and in front of them.
          if (z + 1 < top && w.hasBlock(x + 1, y, z) && w.hasBlock(x, y + 1, z)) continue;
          const pos = gridToScreen(x + 0.5, y + 0.5, z + 1); // centre of the block's top face
          chunk.objects.push(
            this.scene.add
              .image(pos.x, pos.y, 'terrain', this.blockFrame(x, y, z, top))
              .setOrigin(0.5, 8 / 32)
              .setDepth(depth.block(x, y, z))
              .setTint(heightTint(z)),
          );
        }
        const kind = w.propAt(x, y);
        if (kind) this.addProp(chunk, kind, x, y, top);
      }
    }
    this.chunks.set(`${cx},${cy}`, chunk);
  }

  // Which atlas image a block uses. Top blocks get a light rim on each back edge where the
  // ground behind is lower, so ledges are visible even when their wall faces away.
  private blockFrame(x: number, y: number, z: number, top: number) {
    const type = this.world.blockAt(x, y, z)!;
    const name = type === 'grass' ? `grass_${Math.floor(random(x, y, 999) * 3)}` : type;
    if (z !== top - 1 || type === 'water') return name;
    const left = this.world.surface(x - 1, y) < top; // back-left neighbour
    const right = this.world.surface(x, y - 1) < top; // back-right neighbour
    if (left && right) return `${name}_rimLR`;
    if (left) return `${name}_rimL`;
    if (right) return `${name}_rimR`;
    return name;
  }

  private unload(key: string) {
    const chunk = this.chunks.get(key)!;
    for (const o of chunk.objects) o.destroy();
    for (const p of [...chunk.props]) {
      const [x, y] = p.split(',').map(Number);
      this.removeProp(x, y);
    }
    this.chunks.delete(key);
  }

  private setChunkVisible(chunk: LoadedChunk, visible: boolean) {
    chunk.visible = visible;
    for (const o of chunk.objects) o.setVisible(visible);
    for (const key of chunk.props) {
      const p = this.props.get(key)!;
      p.image.setVisible(visible);
      p.shadow.setVisible(visible);
    }
  }

  private addProp(chunk: LoadedChunk, kind: PropKind, x: number, y: number, z: number) {
    const pos = gridToScreen(x + 0.5, y + 0.5, z);
    const [footY, shadowScale] = kind === 'tree' ? [43 / 48, 1.1] : [10 / 12, 0.7];
    const shadow = this.scene.add
      .image(pos.x, pos.y, 'terrain', 'shadow')
      .setScale(shadowScale)
      .setDepth(depth.onSurface(x, y, z));
    const image = this.scene.add
      .image(pos.x, pos.y, 'terrain', kind)
      .setOrigin(0.5, footY)
      .setDepth(depth.prop(x, y))
      .setData('tile', { x, y, h: z })
      .setInteractive(this.scene.input.makePixelPerfect());
    const key = `${x},${y}`;
    chunk.props.add(key);
    this.props.set(key, { kind, x, y, image, shadow, baseX: pos.x, chunk });
  }
}

// Higher blocks are drawn a little brighter, which helps show the shape of the land.
function heightTint(z: number) {
  const v = Math.round(255 * Math.min(1, 0.8 + z * 0.025));
  return (v << 16) | (v << 8) | v;
}

// The rectangle of screen space a chunk's blocks and props can cover.
function chunkBounds(cx: number, cy: number) {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const left = (x0 - (y0 + CHUNK)) * (TILE_W / 2) - TILE_W / 2;
  const right = (x0 + CHUNK - y0) * (TILE_W / 2) + TILE_W / 2;
  const top = (x0 + y0) * (TILE_H / 2) - (BUILD_LIMIT + TREE_HEIGHT) * BLOCK_H;
  const bottom = (x0 + y0 + 2 * CHUNK) * (TILE_H / 2) + BLOCK_H;
  return new Phaser.Geom.Rectangle(left, top, right - left, bottom - top);
}

// How far (gx, gy) is from the nearest edge of a chunk, in tiles.
function distanceToChunk(gx: number, gy: number, cx: number, cy: number) {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const dx = Math.max(x0 - gx, 0, gx - (x0 + CHUNK));
  const dy = Math.max(y0 - gy, 0, gy - (y0 + CHUNK));
  return Math.max(dx, dy);
}
