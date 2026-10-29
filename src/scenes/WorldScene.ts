import Phaser from 'phaser';
import { Callbacks, Client, type Room } from '@colyseus/sdk';
import { gridToScreen, depth, ZOOM } from '../iso';
import { World, TICK_MS, DEFAULT_STATS, type Body, type Stats } from '../../shared/world';
import { decodeColumn } from '../../shared/terrain';
import { ITEMS, type ItemType } from '../../shared/items';
import {
  ROOM_NAME,
  ACTION_COOLDOWN_MS,
  BUILD_COOLDOWN_MS,
  PATCH_MS,
  HEARTBEAT_MS,
  TAKEN_OVER,
  WorldState,
  type InputMessage,
  type JoinOptions,
  type PlayerState,
  type PropState,
  type ColumnState,
} from '../../shared/protocol';
import { CharacterView } from '../CharacterView';
import { TerrainView } from '../TerrainView';
import { Hotbar } from '../hotbar';
import { pickBlock, placeTarget, type BlockHit } from '../picking';
import { showStatus, showPing, showCoords, showToast } from '../status';
import { currentToken, SERVER_URL } from '../auth';
import { allSheets } from '../characterSheets';

// What the pointer is on: a tree/rock, or a face of a block.
type Target = { kind: 'prop'; x: number; y: number; h: number } | ({ kind: 'block' } & BlockHit);

// Where another player was when an update about them arrived (t = performance.now()).
type Snapshot = { t: number; x: number; y: number; z: number; dirX: number; dirY: number };
type Remote = { view: CharacterView; snaps: Snapshot[] };

const DEAD_AFTER_MS = 6000; // no reply from the server for this long: the connection is gone
const RETRY_MS = 3000; // wait between attempts to reach the server

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
  private lastAction = 0; // this.time.now of our last hit on a tree/rock
  private lastBuild = 0; // ... and of our last block placed or broken
  private hotbar!: Hotbar;
  private carried: Partial<Record<ItemType, number>> = {}; // last known inventory, to spot pickups

  private remotes = new Map<string, Remote>();
  // Other players are drawn this far in the past, gliding between the updates the server sent.
  // That hides updates arriving unevenly; it grows when the connection is jittery.
  private interpDelay = PATCH_MS * 2;
  private jitter = 0; // how unevenly updates arrive, in ms
  private lastPatchAt = 0;

  private lastPingAt = 0;
  private lastPongAt = 0;
  private rejoining = false;

  constructor() {
    super('world');
  }

  preload() {
    // All world sprites come from one atlas (built by tools/pack-atlas.mjs), so they draw in one go.
    this.load.atlas('terrain', 'atlas/terrain.png', 'atlas/terrain.json');
    // Every race/class sheet that exists (they're small), plus the placeholder and its scarf layer.
    for (const sheet of allSheets()) {
      const size = { frameWidth: sheet.frameW, frameHeight: sheet.frameH };
      this.load.spritesheet(sheet.key, sheet.url, size);
      if (sheet.scarf) this.load.spritesheet(`${sheet.key}_scarf`, sheet.scarf, size);
    }
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
    // Left click: hit trees/rocks, break blocks. Right click: place the selected item.
    this.input.mouse!.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.tryPlace(p);
      else if (p.leftButtonDown()) this.tryHit(p);
    });

    // Hotbar: number keys or the mouse wheel pick an item.
    const atlas = this.textures.get('terrain');
    const sheet = atlas.getSourceImage() as HTMLImageElement;
    this.hotbar = new Hotbar('atlas/terrain.png', (name) => {
      const f = atlas.get(name);
      return { x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight, sheetW: sheet.width, sheetH: sheet.height };
    });
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= ITEMS.length) this.hotbar.select(n - 1);
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.hotbar.scroll(Math.sign(dy));
    });

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setRoundPixels(false); // we snap the camera to screen pixels ourselves (see centerCamera)
    cam.centerOn(0, 0);

    this.connect();
  }

  update(_time: number, delta: number) {
    if (!this.world || !this.me || !this.room) return;
    // Phaser stops for good if a frame throws. Log it and carry on; if it keeps failing, the
    // heartbeat below stops and the server drops us, which reloads the game (see rejoin).
    try {
      this.frame(delta);
    } catch (err) {
      console.error(err);
      return;
    }
    this.heartbeat();
  }

  private frame(delta: number) {
    const world = this.world!;
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
        this.room!.send('input', msg);
      }
      this.wasMoving = moving;
    }

    // Screens refresh at 60, 75, 144Hz..., but movement ticks at 60Hz. Drawing the player part-way
    // between their last two tick positions keeps motion even at any refresh rate.
    const shown = blend(this.prevBody, this.myBody, this.tickTime / TICK_MS);
    this.showCharacter(this.me!, shown);
    this.me!.setMotion(input, !world.isOnGround(this.myBody));
    this.centerCamera(this.me!);
    this.terrain!.update(shown.gx, shown.gy);
    showCoords(shown.gx, shown.gy, shown.z);
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

  // Tell the server our game is still running, and check it still answers.
  private heartbeat() {
    const now = performance.now();
    if (now - this.lastPingAt >= HEARTBEAT_MS) {
      this.lastPingAt = now;
      this.room!.send('ping', { t: now });
    }
    if (now - this.lastPongAt > DEAD_AFTER_MS) this.rejoin();
  }

  private async connect() {
    showStatus('Connecting…');
    const client = new Client(SERVER_URL);
    const token = await currentToken();
    if (!token) return location.reload(); // signed out meanwhile: back to the sign-in screen
    const options: JoinOptions = { token };
    try {
      this.room = await client.joinOrCreate(ROOM_NAME, options, WorldState);
    } catch (err) {
      console.error(err);
      // Refused because of the login (expired, or no character): start over from sign-in.
      if (/sign in|character/i.test(String((err as Error)?.message))) return location.reload();
      showStatus("Can't reach the game server. Retrying…");
      this.time.delayedCall(RETRY_MS, () => this.connect());
      return;
    }
    showStatus(null);

    const room = this.room;
    // The SDK's own reconnect can't succeed (the server lets go of dropped players straight away)
    // and would leave us frozen while it retries for about a minute. We rejoin ourselves instead.
    room.reconnection.enabled = false;
    room.onLeave((code) => {
      if (code === TAKEN_OVER) showStatus('You started playing in another tab or device. This one is closed.');
      else this.rejoin();
    });
    this.lastPongAt = performance.now();
    room.onMessage('pong', (t: number) => {
      this.lastPongAt = performance.now();
      showPing(this.lastPongAt - t);
    });
    // A background tab sends nothing, so don't count that time as the server being silent.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.lastPongAt = performance.now();
    });
    room.onStateChange(() => this.measureJitter());
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

    // Columns players built on or dug into. These come before players, so the terrain we draw
    // around ourselves on arrival already includes them.
    callbacks.onAdd('columns', (column) => {
      this.columnChanged(column);
      callbacks.listen(column, 'blocks', () => this.columnChanged(column), false);
    });

    callbacks.onAdd('players', (player, id) => {
      if (id === room.sessionId ? this.me : this.remotes.has(id)) return; // already shown
      const view = new CharacterView(this, { name: player.name, race: player.race, cls: player.cls });
      const body = bodyOf(player);
      if (id === room.sessionId) {
        this.me = view;
        this.myState = player;
        this.myBody = this.prevBody = body;
        this.showCharacter(view, body);
        this.centerCamera(view);
        this.terrain!.update(body.gx, body.gy, true);
        callbacks.onChange(player, () => this.reconcile(player));
        // Our inventory: refresh the hotbar whenever an item count changes.
        const refresh = () => this.inventoryChanged(player);
        callbacks.onAdd(player, 'inventory', refresh);
        callbacks.onChange(player, 'inventory', refresh);
        callbacks.onRemove(player, 'inventory', refresh);
        this.carried = {}; // so items we already had when (re)joining don't pop up as pickups
        for (const item of ITEMS) this.carried[item.type] = player.inventory.get(item.type) ?? 0;
        refresh();
      } else {
        const remote: Remote = { view, snaps: [snapshotOf(player, performance.now())] };
        this.remotes.set(id, remote);
        callbacks.onChange(player, () => this.addSnapshot(remote, player));
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
      if (view) this.tweens.killTweensOf(view.image);
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

  // A column was built on or dug into: update the world (so collisions match) and redraw it.
  private columnChanged(column: ColumnState) {
    this.world!.setColumn(column.x, column.y, decodeColumn(column.blocks));
    this.terrain!.columnChanged(column.x, column.y);
  }

  // Our item counts changed: update the hotbar and announce pickups.
  private inventoryChanged(player: PlayerState) {
    const countOf = (item: ItemType) => player.inventory.get(item) ?? 0;
    this.hotbar.setCounts(countOf);
    for (const item of ITEMS) {
      const gained = countOf(item.type) - (this.carried[item.type] ?? 0);
      if (gained > 0) showToast(`+${gained} ${item.name}`);
      this.carried[item.type] = countOf(item.type);
    }
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

  // Lost the server: reload to join again. The server keeps our spot (see JoinOptions.key).
  // In a background tab, wait until the player is back, or we'd rejoin only to be dropped again.
  private rejoin() {
    if (this.rejoining) return;
    this.rejoining = true;
    showStatus('Connection lost. Reconnecting…');
    if (!document.hidden) {
      setTimeout(() => location.reload(), 500);
      return;
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) location.reload();
    });
  }

  // Updates should arrive every PATCH_MS; track how far off they are.
  private measureJitter() {
    const now = performance.now();
    const gap = now - this.lastPatchAt;
    this.lastPatchAt = now;
    if (gap < 500) this.jitter += (Math.abs(gap - PATCH_MS) - this.jitter) * 0.1; // ignore quiet spells
  }

  private addSnapshot(r: Remote, player: PlayerState) {
    const now = performance.now();
    const last = r.snaps[r.snaps.length - 1];
    // Nothing is sent while a player stands still. Start their next move from just before this
    // update, not from when they stopped, or they'd crawl through the first part.
    if (last && now - last.t > PATCH_MS * 3) r.snaps.push({ ...last, t: now - PATCH_MS });
    r.snaps.push(snapshotOf(player, now));
  }

  // Draw each other player where they were interpDelay ms ago, between the two updates around then.
  private updateRemotes(delta: number) {
    const target = Phaser.Math.Clamp(PATCH_MS * 1.5 + this.jitter * 3, 80, 300);
    this.interpDelay += (target - this.interpDelay) * Math.min(1, delta / 1000); // change it gently
    const t = performance.now() - this.interpDelay;
    for (const r of this.remotes.values()) {
      const s = r.snaps;
      while (s.length > 2 && s[1].t <= t) s.shift();
      const a = s[0];
      const b = s[1] ?? a;
      const f = b.t > a.t ? Phaser.Math.Clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
      const shown: Body = {
        gx: a.x + (b.x - a.x) * f,
        gy: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        vz: 0,
      };
      const dir = f > 0 ? b : a;
      this.showCharacter(r.view, shown);
      r.view.setMotion({ x: dir.dirX, y: dir.dirY }, shown.z > this.world!.groundUnder(shown.gx, shown.gy) + 0.01);
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

  // Left click: hit the tree/rock, or break the block, under the pointer.
  private tryHit(pointer: Phaser.Input.Pointer) {
    const world = this.world;
    const t = this.targetAt(pointer);
    if (!world || !t || !this.room || !this.me) return;
    const now = this.time.now;

    if (t.kind === 'prop') {
      if (!world.inReach(this.myBody, t.x, t.y) || now - this.lastAction < ACTION_COOLDOWN_MS) return;
      this.lastAction = now;
      this.swingAt(t.x, t.y);
      this.room.send('interact', { x: t.x, y: t.y });
      return;
    }
    if (!this.canBreak(t) || now - this.lastBuild < BUILD_COOLDOWN_MS) return;
    this.lastBuild = now;
    this.swingAt(t.x, t.y);
    this.room.send('break', { x: t.x, y: t.y });
  }

  // Right click: put the selected item on the column under the pointer (or beside the clicked side).
  private tryPlace(pointer: Phaser.Input.Pointer) {
    const t = this.targetAt(pointer);
    if (!t || t.kind !== 'block' || !this.room || !this.me) return;
    const item = this.hotbar.item;
    if ((this.carried[item] ?? 0) < 1) {
      showToast(`No ${ITEMS.find((i) => i.type === item)!.name} to place`);
      return;
    }
    const at = placeTarget(t);
    const now = this.time.now;
    if (!this.canPlaceAt(at.x, at.y) || now - this.lastBuild < BUILD_COOLDOWN_MS) return;
    this.lastBuild = now;
    this.swingAt(at.x, at.y);
    this.room.send('place', { x: at.x, y: at.y, item });
  }

  // These mirror the server's checks, so we don't send requests it would refuse.
  private canBreak(t: BlockHit) {
    const w = this.world!;
    return t.z === w.surface(t.x, t.y) - 1 && !!w.breakableTop(t.x, t.y) && w.inBuildReach(this.myBody, t.x, t.y);
  }

  private canPlaceAt(x: number, y: number) {
    const w = this.world!;
    return (
      w.canPlaceOn(x, y) &&
      w.inBuildReach(this.myBody, x, y) &&
      !w.overlapsBlock(this.myBody, x, y, w.surface(x, y))
    );
  }

  // Play our strike animation straight away (don't wait for the server), facing a tile.
  private swingAt(x: number, y: number) {
    const from = gridToScreen(this.myBody.gx, this.myBody.gy);
    const to = gridToScreen(x + 0.5, y + 0.5);
    this.me!.playAction(Math.sign(to.x - from.x), Math.sign(to.y - from.y));
  }

  // What the pointer is on: a tree/rock sprite wins, otherwise the block face under it.
  private targetAt(pointer: Phaser.Input.Pointer): Target | null {
    const world = this.world;
    if (!world) return null;
    for (const obj of this.input.hitTestPointer(pointer)) {
      const tile = obj.getData('tile') as { x: number; y: number; h: number } | undefined;
      if (tile) return { kind: 'prop', ...tile };
    }
    const p = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const hit = pickBlock(world, p.x, p.y);
    return hit && { kind: 'block', ...hit };
  }

  // Outline the face under the mouse: white if you can do something with it, red if not.
  private updateCursor() {
    const t = this.targetAt(this.input.activePointer);
    if (!t) {
      this.cursor.setVisible(false);
      return;
    }
    const { x, y } = t;
    let frame = 'tile_hover';
    let usable: boolean;
    let z: number; // the block whose outline we draw
    if (t.kind === 'prop') {
      z = t.h - 1;
      usable = this.world!.inReach(this.myBody, t.x, t.y);
    } else {
      z = t.z;
      if (t.face !== 'top') frame = `face_${t.face}`;
      const at = placeTarget(t);
      usable = this.canBreak(t) || this.canPlaceAt(at.x, at.y);
    }
    // Blocks are drawn from the centre of their top face (see TerrainView).
    const pos = gridToScreen(x + 0.5, y + 0.5, z + 1);
    const d = depth.block(x, y, z) + 0.5;
    if (this.cursor.depth !== d) this.cursor.setDepth(d); // re-sorting is costly; only when it changes
    this.cursor
      .setFrame(frame)
      .setPosition(pos.x, pos.y)
      .setTint(usable ? CURSOR_OK : CURSOR_TOO_FAR)
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

const snapshotOf = (p: PlayerState, t: number): Snapshot => ({
  t,
  x: p.x,
  y: p.y,
  z: p.z,
  dirX: p.dirX,
  dirY: p.dirY,
});

// A position part-way (t = 0..1) from a to b.
const blend = (a: Body, b: Body, t: number): Body => ({
  gx: a.gx + (b.gx - a.gx) * t,
  gy: a.gy + (b.gy - a.gy) * t,
  z: a.z + (b.z - a.z) * t,
  vz: b.vz,
});
