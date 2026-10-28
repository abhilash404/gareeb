import Phaser from 'phaser';
import { Callbacks, Client, type Room } from '@colyseus/sdk';
import { gridToScreen, screenToGrid, depth, ZOOM } from '../iso';
import { World, TICK_MS, DEFAULT_STATS, type Body, type Stats } from '../../shared/world';
import { MAX_HEIGHT } from '../../shared/terrain';
import {
  ROOM_NAME,
  SERVER_PORT,
  SCARF_COLORS,
  ACTION_COOLDOWN_MS,
  WorldState,
  type InputMessage,
  type PlayerState,
  type PropState,
} from '../../shared/protocol';
import { CharacterView } from '../CharacterView';
import { TerrainView } from '../TerrainView';
import { showStatus } from '../status';

type Remote = { view: CharacterView; state: PlayerState; shown: Body };

// Columns in front of a character that can cover them on screen: [dx, dy] offsets.
const IN_FRONT = [
  [1, 0], [0, 1], // 1 plane ahead
  [1, 1], // 2 planes ahead
  [2, 1], [1, 2], // 3 planes ahead
  [2, 2], // 4 planes ahead
];

const CHIP_COLORS: Record<string, number[]> = {
  tree: [0x4fae3f, 0x7fd65a, 0xa5532f],
  rock: [0xc9b1c2, 0xecdbe6, 0x9a8296],
};

const CURSOR_OK = 0xffffff;
const CURSOR_TOO_FAR = 0xff6b6b;

export class WorldScene extends Phaser.Scene {
  private room?: Room<any, WorldState>;
  private world?: World; // created once the server tells us the seed
  private terrain?: TerrainView;
  private cursor!: Phaser.GameObjects.Image;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  // Our own player: moved instantly on our screen ("prediction"), then checked against the server.
  private me?: CharacterView;
  private myState?: PlayerState;
  private myBody: Body = { gx: 0, gy: 0, z: 0, vz: 0 };
  private prevBody: Body = this.myBody; // position one tick earlier, for smoothing between ticks
  private pending: InputMessage[] = []; // inputs sent but not yet confirmed by the server
  private seq = 0;
  private wasMoving = false;
  private tickTime = 0;
  private lastAction = 0;

  private remotes = new Map<string, Remote>();

  constructor() {
    super('world');
  }

  preload() {
    // All world sprites come from one atlas (built by tools/pack-atlas.mjs), so they draw in one go.
    this.load.atlas('terrain', 'atlas/terrain.png', 'atlas/terrain.json');
    this.load.spritesheet('player', 'assets/player.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('player_scarf', 'assets/player_scarf.png', { frameWidth: 16, frameHeight: 24 });
  }

  create() {
    // A 2x2 white square, tinted per particle, for wood/stone chips.
    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(0, 0, 2, 2).generateTexture('chip', 2, 2).destroy();

    this.cursor = this.add.image(0, 0, 'terrain', 'tile_hover').setOrigin(0.5, 8 / 32).setVisible(false);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,LEFT,DOWN,RIGHT,SPACE') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.tryInteract(p);
    });

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setRoundPixels(false); // we snap the camera to screen pixels ourselves (see centerCamera)
    cam.centerOn(0, 0);

    this.connect();
  }

  update(_time: number, delta: number) {
    const world = this.world;
    if (!world || !this.me || !this.room) return;
    this.updateCursor();
    this.updateRemotes(delta);

    const k = this.keys;
    const input: InputMessage = {
      seq: 0,
      x: (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0),
      y: (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0),
      j: k.SPACE.isDown ? 1 : 0,
    };
    const moving = input.x !== 0 || input.y !== 0;

    // Movement runs in fixed ticks so it matches the server exactly.
    this.tickTime = Math.min(this.tickTime + delta, 250);
    while (this.tickTime >= TICK_MS) {
      this.tickTime -= TICK_MS;
      // Send while moving, jumping or in the air, plus one "stopped" input so others see us stop.
      this.prevBody = this.myBody;
      if (moving || this.wasMoving || input.j || !world.isOnGround(this.myBody)) {
        const msg = { ...input, seq: ++this.seq };
        this.myBody = this.stepMe(this.myBody, msg);
        this.pending.push(msg);
        this.room.send('input', msg);
      }
      this.wasMoving = moving;
    }

    // Screens refresh at 60, 75, 144Hz..., but movement ticks at 60Hz. Drawing the player part-way
    // between their last two tick positions keeps motion even at any refresh rate.
    const shown = blend(this.prevBody, this.myBody, this.tickTime / TICK_MS);
    this.showCharacter(this.me, shown);
    this.me.setMotion(input, !world.isOnGround(this.myBody));
    this.centerCamera(this.me);
    this.terrain!.update(shown.gx, shown.gy);
  }

  // Keep our character in the middle of the screen. The camera moves in whole screen pixels
  // (1/ZOOM of an art pixel): every art pixel stays exactly ZOOM x ZOOM screen pixels, so the art
  // stays sharp, while scrolling is ZOOM times smoother than moving in whole art pixels.
  private centerCamera(view: CharacterView) {
    const cam = this.cameras.main;
    const halfW = cam.width / 2;
    const halfH = cam.height / 2;
    // Phaser draws a world point at (point - scroll - half) * zoom + half; choose scroll so the
    // character lands on a whole screen pixel, which puts every whole-pixel world point on one too.
    cam.setScroll(
      view.sprite.x - halfW - (Math.floor(halfW) - halfW) / ZOOM,
      view.sprite.y - halfH - (Math.floor(halfH) - halfH) / ZOOM,
    );
  }

  private stepMe(body: Body, msg: InputMessage) {
    const stats: Stats = { jumpHeight: this.myState?.jumpHeight ?? DEFAULT_STATS.jumpHeight };
    return this.world!.step(body, { x: msg.x, y: msg.y, jump: msg.j === 1 }, stats);
  }

  private async connect() {
    showStatus('Connecting…');
    // Dev: Vite and the game server run on separate ports. Production: one server hosts both.
    const client = new Client(
      import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${SERVER_PORT}` : location.origin,
    );
    try {
      this.room = await client.joinOrCreate(ROOM_NAME, {}, WorldState);
    } catch (err) {
      console.error(err);
      showStatus("Can't reach the game server. Is it running? (npm run dev)");
      return;
    }
    showStatus(null);

    const room = this.room;
    room.onLeave(() => showStatus('Disconnected from the server. Refresh to rejoin.'));
    const callbacks = Callbacks.get(room);
    let started = false;
    callbacks.listen('seed', (seed) => {
      if (seed === undefined || started) return;
      started = true;
      // This runs in the middle of applying the server's first update. Wait until that update is
      // fully applied, or the players in it would be announced to startWorld twice.
      queueMicrotask(() => this.startWorld(room, seed));
    });
  }

  // Generate the world from the server's seed, then start showing players and props.
  private startWorld(room: Room<any, WorldState>, seed: number) {
    const world = new World(seed);
    this.world = world;
    this.terrain = new TerrainView(this, world);
    const callbacks = Callbacks.get(room);
    let live = false; // false while processing what already existed when we joined

    // Trees/rocks other players already damaged or destroyed, and new hits from now on.
    callbacks.onAdd('props', (prop) => {
      this.propChanged(prop, live);
      callbacks.listen(prop, 'hp', () => this.propChanged(prop, true), false);
    });

    callbacks.onAdd('players', (player, id) => {
      if (id === room.sessionId ? this.me : this.remotes.has(id)) return; // already shown
      const view = new CharacterView(this, SCARF_COLORS[player.color]);
      const body = bodyOf(player);
      if (id === room.sessionId) {
        this.me = view;
        this.myState = player;
        this.myBody = this.prevBody = body;
        this.showCharacter(view, body);
        this.centerCamera(view);
        this.terrain!.update(body.gx, body.gy, true);
        callbacks.onChange(player, () => this.reconcile(player));
      } else {
        this.remotes.set(id, { view, state: player, shown: body });
        // Another player struck something: play their animation.
        callbacks.listen(player, 'actions', () => view.playAction(), false);
      }
      this.showCharacter(view, body);
    });

    callbacks.onRemove('players', (_player, id) => {
      this.remotes.get(id)?.view.destroy();
      this.remotes.delete(id);
    });
    live = true;

    // Every few seconds, free terrain data far from us (it's regenerated from the seed if we return).
    this.time.addEvent({
      delay: 3000,
      loop: true,
      callback: () => this.terrain!.forgetFarTerrain(this.myBody.gx, this.myBody.gy),
    });
  }

  // A tree/rock was hit (hp went down) or destroyed (hp 0). `live` = it just happened, so show effects.
  private propChanged(prop: PropState, live: boolean) {
    const view = this.terrain!.props.get(`${prop.x},${prop.y}`);
    if (prop.hp === 0) {
      this.world!.removeProp(prop.x, prop.y);
      if (view && live) this.burst(view.baseX, view.image.y - 6, CHIP_COLORS[view.kind], 18);
      this.terrain!.removeProp(prop.x, prop.y);
      return;
    }
    if (!view || !live) return;
    this.burst(view.baseX, view.image.y - (view.kind === 'tree' ? 10 : 4), CHIP_COLORS[view.kind], 6);
    this.tweens.killTweensOf(view.image);
    view.image.x = view.baseX;
    this.tweens.add({ targets: view.image, x: view.baseX + 1, duration: 40, yoyo: true, repeat: 2 });
  }

  // The server says where we were after input #seq. Start from there and
  // re-apply the inputs it hasn't processed yet. Normally this lands exactly
  // where we already are; it only changes anything if the server disagreed.
  private reconcile(player: PlayerState) {
    this.pending = this.pending.filter((input) => input.seq > player.seq);
    let body = bodyOf(player);
    for (const input of this.pending) body = this.stepMe(body, input);
    this.myBody = body;
  }

  // Other players only update ~20 times a second, so glide towards their latest position.
  private updateRemotes(delta: number) {
    const t = 1 - Math.exp(-delta / 60);
    for (const r of this.remotes.values()) {
      r.shown.gx += (r.state.x - r.shown.gx) * t;
      r.shown.gy += (r.state.y - r.shown.gy) * t;
      r.shown.z += (r.state.z - r.shown.z) * t;
      this.showCharacter(r.view, r.shown);
      r.view.setMotion({ x: r.state.dirX, y: r.state.dirY }, !this.world!.isOnGround(bodyOf(r.state)));
    }
  }

  private showCharacter(view: CharacterView, b: Body) {
    view.setPosition(b.gx, b.gy, b.z, this.world!.groundUnder(b.gx, b.gy));
    view.setHidden(this.isBehindTerrain(b));
  }

  // Is a character covered by a column in front of them? A column n planes ahead
  // starts hiding them once it's more than about n/2 blocks taller than their feet.
  private isBehindTerrain(b: Body) {
    const x = Math.floor(b.gx);
    const y = Math.floor(b.gy);
    return IN_FRONT.some(([dx, dy]) => this.world!.surface(x + dx, y + dy) - b.z > (dx + dy) / 2 + 0.5);
  }

  // ---------- Interaction ----------

  private tryInteract(pointer: Phaser.Input.Pointer) {
    const world = this.world;
    const target = this.targetAt(pointer);
    if (!world || !target || !this.room || !this.me) return;
    if (!world.propAt(target.x, target.y)) return;
    if (!world.inReach(this.myBody, target.x, target.y)) return;
    const now = this.time.now;
    if (now - this.lastAction < ACTION_COOLDOWN_MS) return;
    this.lastAction = now;

    // Swing straight away (don't wait for the server), facing the target.
    const from = gridToScreen(this.myBody.gx, this.myBody.gy);
    const to = gridToScreen(target.x + 0.5, target.y + 0.5);
    this.me.playAction(Math.sign(to.x - from.x), Math.sign(to.y - from.y));
    this.room.send('interact', { x: target.x, y: target.y });
  }

  // The tile the pointer is on: a tree/rock sprite under it wins, otherwise the top face under it.
  private targetAt(pointer: Phaser.Input.Pointer): { x: number; y: number; h: number } | null {
    const world = this.world;
    if (!world) return null;
    for (const obj of this.input.hitTestPointer(pointer)) {
      const tile = obj.getData('tile') as { x: number; y: number; h: number } | undefined;
      if (tile) return tile;
    }
    const p = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    // Look from the highest possible surface downwards: the first top face found
    // there is the one nearest the camera.
    for (let h = MAX_HEIGHT; h >= 1; h--) {
      const g = screenToGrid(p.x, p.y, h);
      const x = Math.floor(g.gx);
      const y = Math.floor(g.gy);
      if (world.surface(x, y) === h) return { x, y, h };
    }
    return null;
  }

  // Highlight the tile under the mouse; red if there's something there that's out of reach.
  private updateCursor() {
    const t = this.targetAt(this.input.activePointer);
    if (!t) {
      this.cursor.setVisible(false);
      return;
    }
    const tooFar = !!this.world!.propAt(t.x, t.y) && !this.world!.inReach(this.myBody, t.x, t.y);
    const pos = gridToScreen(t.x + 0.5, t.y + 0.5, t.h);
    const d = depth.onSurface(t.x, t.y, t.h);
    if (this.cursor.depth !== d) this.cursor.setDepth(d); // re-sorting is costly; only when it changes
    this.cursor
      .setPosition(pos.x, pos.y)
      .setTint(tooFar ? CURSOR_TOO_FAR : CURSOR_OK)
      .setVisible(true);
  }

  private burst(x: number, y: number, colors: number[], count: number) {
    const emitter = this.add
      .particles(x, y, 'chip', {
        speed: { min: 30, max: 80 },
        angle: { min: 200, max: 340 },
        gravityY: 300,
        lifespan: 450,
        tint: colors,
        emitting: false,
      })
      .setDepth(depth.overlay - 1);
    emitter.explode(count);
    this.time.delayedCall(600, () => emitter.destroy());
  }
}

const bodyOf = (p: PlayerState): Body => ({ gx: p.x, gy: p.y, z: p.z, vz: p.vz });

// A position part-way (t = 0..1) from a to b.
const blend = (a: Body, b: Body, t: number): Body => ({
  gx: a.gx + (b.gx - a.gx) * t,
  gy: a.gy + (b.gy - a.gy) * t,
  z: a.z + (b.z - a.z) * t,
  vz: b.vz,
});
