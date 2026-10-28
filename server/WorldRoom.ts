import { Room, type Client } from 'colyseus';
import {
  PlayerState,
  PropState,
  WorldState,
  SCARF_COLORS,
  PROP_HP,
  ACTION_COOLDOWN_MS,
  type InputMessage,
  type InteractMessage,
} from '../shared/protocol';
import { World, TICK_MS, DEFAULT_STATS, type Body } from '../shared/world';

const MAX_QUEUED = 30; // inputs waiting per player; extra ones are dropped
const MAX_BUDGET = 8; // most ticks a player can catch up on at once after lag
const SETTLE_AFTER_MS = 250; // if an airborne player sends nothing for this long, the server makes them fall anyway
const REACH_SLACK = 0.5; // extra reach the server allows, since it sees players slightly behind
const KEEP_CHUNKS_RADIUS = 48; // tiles around each player whose terrain the server keeps in memory

type Inbox = { queue: InputMessage[]; budget: number; quietMs: number; lastAction: number };

// Set WORLD_SEED to get the same world every time; otherwise it's random per server run.
const SERVER_SEED = (Number(process.env.WORLD_SEED) || Math.floor(Math.random() * 2 ** 32)) >>> 0;

// One world: its own seed, terrain, and players.
export class WorldRoom extends Room<{ state: WorldState }> {
  autoDispose = false; // keep the world (and its changes) when everyone leaves
  maxClients = 50;
  maxMessagesPerSecond = 200;
  state = new WorldState();
  private world!: World;
  private inboxes = new Map<string, Inbox>();
  private joined = 0;

  onCreate() {
    this.state.seed = SERVER_SEED;
    this.world = new World(this.state.seed);
    console.log(`world created with seed ${this.state.seed}`);

    this.onMessage('input', (client, msg: InputMessage) => {
      const inbox = this.inboxes.get(client.sessionId);
      if (!inbox || typeof msg !== 'object' || !Number.isInteger(msg.seq)) return;
      // Only accept -1, 0 or 1 so nobody can send a bigger direction to move faster.
      const x = Math.sign(Number(msg.x) || 0);
      const y = Math.sign(Number(msg.y) || 0);
      const j = msg.j ? 1 : 0;
      if (inbox.queue.length < MAX_QUEUED) inbox.queue.push({ seq: msg.seq, x, y, j });
    });

    this.onMessage('interact', (client, msg: InteractMessage) => this.interact(client, msg));

    this.setSimulationInterval((deltaMs) => this.tick(deltaMs), TICK_MS);

    // Every few seconds, free terrain no player is near.
    this.clock.setInterval(() => {
      const points = [...this.state.players.values()].map(bodyOf);
      this.world.forgetChunksAwayFrom([this.world.spawn, ...points], KEEP_CHUNKS_RADIUS);
    }, 5000);
  }

  onJoin(client: Client) {
    const spawn = this.world.spawn;
    const player = new PlayerState();
    player.x = spawn.gx;
    player.y = spawn.gy;
    player.z = spawn.z;
    player.vz = 0;
    player.dirX = 0;
    player.dirY = 0;
    player.seq = 0;
    player.jumpHeight = DEFAULT_STATS.jumpHeight;
    player.actions = 0;
    player.color = this.joined++ % SCARF_COLORS.length;
    this.state.players.set(client.sessionId, player);
    this.inboxes.set(client.sessionId, { queue: [], budget: 0, quietMs: 0, lastAction: 0 });
    console.log(`${client.sessionId} joined (${this.state.players.size} online)`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inboxes.delete(client.sessionId);
    console.log(`${client.sessionId} left (${this.state.players.size} online)`);
  }

  // Hit a tree or rock. The server checks everything: it exists, you're close enough, you're not too fast.
  private interact(client: Client, msg: InteractMessage) {
    const player = this.state.players.get(client.sessionId);
    const inbox = this.inboxes.get(client.sessionId);
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
    if (prop.hp === 0) this.world.removeProp(msg.x, msg.y);
  }

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
