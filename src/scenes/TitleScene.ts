import Phaser from 'phaser';
import { gridToPixel, ZOOM } from '../iso';
import { World, TICK_MS, DEFAULT_STATS, type Body } from '../../shared/world';
import { CharacterView } from '../CharacterView';
import { TerrainView } from '../TerrainView';
import { preloadArt } from '../preload';
import { allSheets } from '../characterSheets';
import { CLASSES, RACES } from '../../shared/characters';
import { SEA_LEVEL } from '../../shared/terrain';

// The welcome screen's background: the camera drifts slowly over a real (offline) world while a few
// characters wander about. Nothing here talks to the server.
const SEED = 20261029;
const DRIFT = 0.45; // tiles per second, along the grid's x axis (screen down-right)
const WANDERERS = 6;
const LEASH = 12; // wanderers further than this from the camera (in tiles) reappear near it

type Wanderer = { view: CharacterView; body: Body; dir: { x: number; y: number }; nextTurn: number };

export class TitleScene extends Phaser.Scene {
  private world = new World(SEED);
  private terrain!: TerrainView;
  private camAt = { gx: 0, gy: 0 };
  private wanderers: Wanderer[] = [];
  private tickTime = 0;

  constructor() {
    super('title');
  }

  preload() {
    preloadArt(this);
  }

  create() {
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setRoundPixels(false);
    this.camAt = { gx: this.world.spawn.gx, gy: this.world.spawn.gy };
    this.terrain = new TerrainView(this, this.world);
    this.moveCamera();
    this.terrain.update(this.camAt.gx, this.camAt.gy, true);

    // Real art where it exists, otherwise a mix of races and classes in the placeholder.
    const looks = allSheets().filter((s) => s.key !== 'player').map((s) => {
      const [race, cls] = s.key.replace('char_', '').split('_');
      return { race, cls };
    });
    for (let i = 0; i < WANDERERS; i++) {
      const look = looks.length
        ? looks[i % looks.length]
        : { race: RACES[i % RACES.length].id, cls: CLASSES[i % CLASSES.length].id };
      const view = new CharacterView(this, { name: '', ...look });
      const w: Wanderer = { view, body: { ...this.world.spawn }, dir: { x: 0, y: 0 }, nextTurn: 0 };
      this.placeNearCamera(w, 0);
      this.wanderers.push(w);
    }
    this.game.events.emit('title-ready');
  }

  update(time: number, delta: number) {
    this.camAt.gx += (DRIFT * delta) / 1000;
    this.moveCamera();
    this.terrain.update(this.camAt.gx, this.camAt.gy);

    // Movement uses the game's own fixed-tick physics, so they walk, jump and collide like players.
    this.tickTime += Math.min(delta, 250);
    while (this.tickTime >= TICK_MS) {
      this.tickTime -= TICK_MS;
      for (const w of this.wanderers) {
        const before = w.body;
        const jump = Math.random() < 0.01;
        w.body = this.world.step(before, { ...w.dir, jump }, DEFAULT_STATS);
        // Bumped into something: stop and pick a new way soon.
        if ((w.dir.x || w.dir.y) && w.body.gx === before.gx && w.body.gy === before.gy) w.nextTurn = time;
      }
    }

    for (const w of this.wanderers) {
      if (time >= w.nextTurn) this.turn(w, time);
      const far = Math.max(Math.abs(w.body.gx - this.camAt.gx), Math.abs(w.body.gy - this.camAt.gy)) > LEASH;
      if (far) this.placeNearCamera(w, time);
      const ground = this.world.groundUnder(w.body.gx, w.body.gy);
      w.view.setPosition(w.body.gx, w.body.gy, w.body.z, ground);
      w.view.setMotion(w.dir, w.body.z > ground);
    }
  }

  // Walk somewhere new, or stand still for a bit.
  private turn(w: Wanderer, time: number) {
    const options = [-1, 0, 1];
    w.dir = Math.random() < 0.3
      ? { x: 0, y: 0 }
      : { x: options[Math.floor(Math.random() * 3)], y: options[Math.floor(Math.random() * 3)] };
    w.nextTurn = time + 1200 + Math.random() * 2500;
  }

  // Put a wanderer on dry, open ground somewhere ahead of the drifting camera.
  private placeNearCamera(w: Wanderer, time: number) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(this.camAt.gx + 2 + Math.random() * 8);
      const y = Math.floor(this.camAt.gy - 6 + Math.random() * 12);
      if (this.world.isWater(x, y) || this.world.propAt(x, y)) continue;
      w.body = { gx: x + 0.5, gy: y + 0.5, z: this.world.surface(x, y), vz: 0 };
      break;
    }
    this.turn(w, time);
  }

  // Same pixel snapping as the game camera (see WorldScene.centerCamera).
  private moveCamera() {
    const cam = this.cameras.main;
    const p = gridToPixel(this.camAt.gx, this.camAt.gy, SEA_LEVEL); // a fixed height, so hills don't jolt it
    const halfW = cam.width / 2;
    const halfH = cam.height / 2;
    cam.setScroll(p.x - halfW - (Math.floor(halfW) - halfW) / ZOOM, p.y - halfH - (Math.floor(halfH) - halfH) / ZOOM);
  }
}
