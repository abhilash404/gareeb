import { Room, type Client } from 'colyseus';
import {
  PlayerState,
  PropState,
  ColumnState,
  WorldState,
  SCARF_COLORS,
  PROP_HP,
  ACTION_COOLDOWN_MS,
  BUILD_COOLDOWN_MS,
  PATCH_MS,
  SILENT_KICK_MS,
  TAKEN_OVER,
  type InputMessage,
  type InteractMessage,
  type BreakMessage,
  type PlaceMessage,
  type JoinOptions,
  type PingMessage,
} from '../shared/protocol';
import { World, TICK_MS, DEFAULT_STATS, type Body } from '../shared/world';
import { encodeColumn, decodeColumn, type BlockType } from '../shared/terrain';
import { ITEM_FROM_BLOCK, PROP_DROPS, MAX_STACK, isItem, blockOfItem, type ItemType } from '../shared/items';
import { openStorage, type Storage, type SavedWorld } from './storage';

// Inputs arrive in bursts over a laggy connection. After a 0.5s hiccup the server must be able to
// catch up on all 30 queued steps, or they pile up for good and every later step arrives late.
const MAX_QUEUED = 60; // inputs waiting per player; extra ones are dropped
const MAX_BUDGET = 30; // most ticks a player can catch up on at once after lag
const PARK_MS = 5 * 60_000; // how long a player who dropped out keeps their spot
const SETTLE_AFTER_MS = 250; // if an airborne player sends nothing for this long, the server makes them fall anyway
const REACH_SLACK = 0.5; // extra reach the server allows, since it sees players slightly behind
const KEEP_CHUNKS_RADIUS = 48; // tiles around each player whose terrain the server keeps in memory
const SAVE_EVERY_MS = 10_000; // how often changes are saved

type Inbox = {
  queue: InputMessage[];
  budget: number;
  quietMs: number;
  lastAction: number; // Date.now() of the last hit on a tree/rock
  lastBuild: number; // Date.now() of the last block placed or broken
  lastHeard: number; // Date.now() of this player's last message
  key: string | null; // from JoinOptions
};
// Where a player was when they dropped out, so a rejoin puts them back.
type Parked = { body: Body; color: number; inventory: Record<string, number>; at: number };

// Which saved world this server runs. Change it to start a fresh world without deleting the old one.
const WORLD_ID = process.env.WORLD_ID || 'main';
// The seed for a brand-new world. Once a world is saved, its seed comes from the save.
const NEW_WORLD_SEED = (Number(process.env.WORLD_SEED) || Math.floor(Math.random() * 2 ** 32)) >>> 0;

// One world: its own seed, terrain, players, and everything players changed.
export class WorldRoom extends Room<{ state: WorldState }> {
  autoDispose = false; // keep the world (and its changes) when everyone leaves
  maxClients = 50;
  maxMessagesPerSecond = 200;
  state = new WorldState();
  private world!: World;
  private inboxes = new Map<string, Inbox>();
  private parked = new Map<string, Parked>(); // keyed by JoinOptions.key
  private sessionOfKey = new Map<string, string>();
  private joined = 0;
  private storage?: Storage;
  private dirty = false; // changed since the last save
  private saving: Promise<void> | null = null;

  async onCreate() {
    this.patchRate = PATCH_MS;
    await this.loadWorld();

    this.onMessage('input', (client, msg: InputMessage) => {
      const inbox = this.heard(client);
      if (!inbox || typeof msg !== 'object' || !Number.isInteger(msg?.seq)) return;
      // Only accept -1, 0 or 1 so nobody can send a bigger direction to move faster.
      const x = Math.sign(Number(msg.x) || 0);
      const y = Math.sign(Number(msg.y) || 0);
      const j = msg.j ? 1 : 0;
      if (inbox.queue.length < MAX_QUEUED) inbox.queue.push({ seq: msg.seq, x, y, j });
    });

    this.onMessage('interact', (client, msg: InteractMessage) => this.interact(client, msg));
    this.onMessage('break', (client, msg: BreakMessage) => this.breakBlock(client, msg));
    this.onMessage('place', (client, msg: PlaceMessage) => this.placeBlock(client, msg));

    this.onMessage('ping', (client, msg: PingMessage) => {
      this.heard(client);
      if (typeof msg?.t === 'number') client.send('pong', msg.t);
    });

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), TICK_MS);

    // Every few seconds, free terrain no player is near.
    this.clock.setInterval(() => {
      const points = [...this.state.players.values()].map(bodyOf);
      this.world.forgetChunksAwayFrom([this.world.spawn, ...points], KEEP_CHUNKS_RADIUS);
    }, 5000);

    // Remove players whose game has stopped. Their connection can stay open (the browser answers
    // network pings by itself), so without this they'd stand frozen in the world forever.
    this.clock.setInterval(() => {
      const now = Date.now();
      for (const [id, inbox] of this.inboxes) {
        if (now - inbox.lastHeard > SILENT_KICK_MS) {
          console.log(`${id} went silent; removing`);
          this.clients.getById(id)?.leave();
        }
      }
      for (const [key, p] of this.parked) if (now - p.at > PARK_MS) this.parked.delete(key);
    }, 1000);

    this.clock.setInterval(() => this.save(), SAVE_EVERY_MS);
  }

  // The server is shutting down (e.g. Render restarting it): save what's left.
  async onDispose() {
    await this.save();
  }

  // Note that a player's game is still running; returns their inbox.
  private heard(client: Client) {
    const inbox = this.inboxes.get(client.sessionId);
    if (inbox) inbox.lastHeard = Date.now();
    return inbox;
  }

  onJoin(client: Client, options?: JoinOptions) {
    const key = typeof options?.key === 'string' && options.key.length <= 64 ? options.key : null;
    let start: Body = this.world.spawn;
    let color = this.joined++ % SCARF_COLORS.length;
    let inventory: Record<string, number> = {};
    if (key) {
      // Rejoining before the server noticed the old connection died: take over that player.
      const oldId = this.sessionOfKey.get(key);
      const old = oldId ? this.state.players.get(oldId) : undefined;
      if (oldId && old) {
        this.parked.set(key, { body: bodyOf(old), color: old.color, inventory: inventoryOf(old), at: Date.now() });
        this.clients.getById(oldId)?.leave(TAKEN_OVER);
      }
      const parked = this.parked.get(key);
      if (parked) {
        start = parked.body;
        color = parked.color;
        inventory = parked.inventory;
        this.parked.delete(key);
      }
      this.sessionOfKey.set(key, client.sessionId);
    }

    const player = new PlayerState();
    player.x = start.gx;
    player.y = start.gy;
    player.z = start.z;
    player.vz = start.vz;
    player.dirX = 0;
    player.dirY = 0;
    player.seq = 0;
    player.jumpHeight = DEFAULT_STATS.jumpHeight;
    player.actions = 0;
    player.color = color;
    for (const [item, n] of Object.entries(inventory)) player.inventory.set(item, n);
    this.state.players.set(client.sessionId, player);
    this.inboxes.set(client.sessionId, {
      queue: [],
      budget: 0,
      quietMs: 0,
      lastAction: 0,
      lastBuild: 0,
      lastHeard: Date.now(),
      key,
    });
    console.log(`${client.sessionId} joined (${this.state.players.size} online)`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const key = this.inboxes.get(client.sessionId)?.key;
    // Only park if this session still owns the key (a rejoin may have taken it over already).
    if (player && key && this.sessionOfKey.get(key) === client.sessionId) {
      this.parked.set(key, { body: bodyOf(player), color: player.color, inventory: inventoryOf(player), at: Date.now() });
      this.sessionOfKey.delete(key);
    }
    this.state.players.delete(client.sessionId);
    this.inboxes.delete(client.sessionId);
    console.log(`${client.sessionId} left (${this.state.players.size} online)`);
  }

  // Hit a tree or rock. The server checks everything: it exists, you're close enough, you're not too fast.
  // Whoever breaks it gets its drops.
  private interact(client: Client, msg: InteractMessage) {
    const player = this.state.players.get(client.sessionId);
    const inbox = this.heard(client);
    if (!player || !inbox || !Number.isInteger(msg?.x) || !Number.isInteger(msg?.y)) return;

    const kind = this.world.propAt(msg.x, msg.y);
    if (!kind) return;
    const now = Date.now();
    if (now - inbox.lastAction < ACTION_COOLDOWN_MS) return;
    if (!this.world.inReach(bodyOf(player), msg.x, msg.y, REACH_SLACK)) return;
    inbox.lastAction = now;
    player.actions = (player.actions + 1) % 65536;

    const key = `${msg.x},${msg.y}`;
    let prop = this.state.props.get(key);
    if (!prop) {
      prop = new PropState();
      prop.x = msg.x;
      prop.y = msg.y;
      prop.hp = PROP_HP[kind];
      this.state.props.set(key, prop);
    }
    prop.hp -= 1;
    if (prop.hp === 0) {
      this.world.removeProp(msg.x, msg.y);
      const drop = PROP_DROPS[kind];
      addItem(player, drop.item, drop.count);
    }
    this.dirty = true;
  }

  // Break the top block of a column; the player gets it as an item.
  private breakBlock(client: Client, msg: BreakMessage) {
    const player = this.state.players.get(client.sessionId);
    const inbox = this.heard(client);
    if (!player || !inbox || !Number.isInteger(msg?.x) || !Number.isInteger(msg?.y)) return;
    const { x, y } = msg;

    const now = Date.now();
    if (now - inbox.lastBuild < BUILD_COOLDOWN_MS) return;
    if (!this.world.inBuildReach(bodyOf(player), x, y, REACH_SLACK)) return;
    const type = this.world.breakableTop(x, y);
    if (!type) return;

    inbox.lastBuild = now;
    player.actions = (player.actions + 1) % 65536;
    const blocks = this.world.column(x, y);
    blocks.pop();
    this.setColumn(x, y, blocks);
    const item = ITEM_FROM_BLOCK[type];
    if (item) addItem(player, item, 1);
  }

  // Put one of an item from the player's inventory on top of a column.
  private placeBlock(client: Client, msg: PlaceMessage) {
    const player = this.state.players.get(client.sessionId);
    const inbox = this.heard(client);
    if (!player || !inbox || !Number.isInteger(msg?.x) || !Number.isInteger(msg?.y) || !isItem(msg?.item)) return;
    const { x, y, item } = msg;

    const have = player.inventory.get(item) ?? 0;
    if (have < 1) return;
    const now = Date.now();
    if (now - inbox.lastBuild < BUILD_COOLDOWN_MS) return;
    if (!this.world.canPlaceOn(x, y) || !this.world.inBuildReach(bodyOf(player), x, y, REACH_SLACK)) return;
    // Never build a block inside someone.
    const z = this.world.surface(x, y);
    for (const p of this.state.players.values()) if (this.world.overlapsBlock(bodyOf(p), x, y, z)) return;

    inbox.lastBuild = now;
    player.actions = (player.actions + 1) % 65536;
    const blocks = this.world.column(x, y);
    blocks.push(blockOfItem(item));
    this.setColumn(x, y, blocks);
    if (have === 1) player.inventory.delete(item);
    else player.inventory.set(item, have - 1);
  }

  // Change a column in the world and tell everyone.
  private setColumn(x: number, y: number, blocks: BlockType[]) {
    this.world.setColumn(x, y, blocks);
    const key = `${x},${y}`;
    let column = this.state.columns.get(key);
    if (!column) {
      column = new ColumnState();
      column.x = x;
      column.y = y;
      this.state.columns.set(key, column);
    }
    column.blocks = encodeColumn(blocks);
    this.dirty = true;
  }

  // ---------- Saving ----------

  private async loadWorld() {
    let saved: SavedWorld | null = null;
    try {
      this.storage = await openStorage();
      saved = await this.storage.load(WORLD_ID);
    } catch (err) {
      // Better to keep playing than to refuse everyone; but say loudly that nothing is saved.
      console.error('!!! Could not open or read the save. This world will NOT be saved:', err);
      this.storage = undefined;
    }

    this.state.seed = saved?.seed ?? NEW_WORLD_SEED;
    this.world = new World(this.state.seed);
    for (const [x, y, hp] of saved?.props ?? []) {
      const prop = new PropState();
      prop.x = x;
      prop.y = y;
      prop.hp = hp;
      this.state.props.set(`${x},${y}`, prop);
      if (hp === 0) this.world.removeProp(x, y);
    }
    for (const [x, y, blocks] of saved?.columns ?? []) this.setColumn(x, y, decodeColumn(blocks));
    this.dirty = !saved; // a new world: save its seed straight away

    const where = this.storage?.where ?? 'nowhere';
    if (saved) {
      const changes = (saved.props?.length ?? 0) + (saved.columns?.length ?? 0);
      console.log(`loaded world "${WORLD_ID}" (seed ${saved.seed}, ${changes} changes) from ${where}`);
    } else {
      console.log(`new world "${WORLD_ID}" with seed ${this.state.seed}; saving to ${where}`);
    }
  }

  // Save if anything changed. Returns when the save (if any) is done.
  private save(): Promise<void> {
    if (this.saving) return this.saving.then(() => this.save());
    if (!this.dirty || !this.storage) return Promise.resolve();
    this.dirty = false;
    const data: SavedWorld = {
      version: 1,
      seed: this.state.seed,
      props: [...this.state.props.values()].map((p) => [p.x, p.y, p.hp]),
      columns: [...this.world.editedColumns()].map(([key, blocks]) => {
        const [x, y] = key.split(',').map(Number);
        return [x, y, encodeColumn(blocks)];
      }),
    };
    this.saving = this.storage
      .save(WORLD_ID, data)
      .catch((err) => {
        console.error('saving the world failed; will retry:', err);
        this.dirty = true;
      })
      .finally(() => (this.saving = null));
    return this.saving;
  }

  // ---------- Movement ----------

  // Each player may move one step per TICK_MS of real time, however fast they send inputs.
  private tick(deltaMs: number) {
    for (const [id, inbox] of this.inboxes) {
      const player = this.state.players.get(id);
      if (!player) continue;
      inbox.budget = Math.min(inbox.budget + deltaMs / TICK_MS, MAX_BUDGET);

      if (inbox.queue.length === 0) {
        // Normal browsers keep sending while in the air; this stops anyone hovering by going quiet.
        inbox.quietMs += deltaMs;
        if (inbox.quietMs > SETTLE_AFTER_MS && !this.world.isOnGround(bodyOf(player))) {
          this.applyStep(player, { seq: player.seq, x: 0, y: 0, j: 0 });
        }
        continue;
      }

      inbox.quietMs = 0;
      while (inbox.budget >= 1 && inbox.queue.length > 0) {
        const input = inbox.queue.shift()!;
        this.applyStep(player, input);
        player.seq = input.seq;
        inbox.budget -= 1;
      }
    }
  }

  private applyStep(player: PlayerState, input: InputMessage) {
    const next = this.world.step(bodyOf(player), { x: input.x, y: input.y, jump: input.j === 1 }, {
      jumpHeight: player.jumpHeight,
    });
    player.x = next.gx;
    player.y = next.gy;
    player.z = next.z;
    player.vz = next.vz;
    player.dirX = input.x;
    player.dirY = input.y;
  }
}

const bodyOf = (p: PlayerState): Body => ({ gx: p.x, gy: p.y, z: p.z, vz: p.vz });
const inventoryOf = (p: PlayerState) => Object.fromEntries(p.inventory.entries());

function addItem(player: PlayerState, item: ItemType, count: number) {
  player.inventory.set(item, Math.min(MAX_STACK, (player.inventory.get(item) ?? 0) + count));
}
