// What the browser and the server send each other.
import { schema, t, type SchemaType } from '@colyseus/schema';

export const SERVER_PORT = 2567;
export const ROOM_NAME = 'world';
export const PATCH_MS = 50; // the server sends state changes this often

// Sent when joining. `key` is a random id kept per browser tab: if you drop out and rejoin,
// the server puts you back where you were instead of at spawn.
export type JoinOptions = { key?: string };

// Browser -> server about once a second, from the game loop: "my game is still running".
// The server answers 'pong' with the same t, so the browser can show its ping.
// A player whose game stops sending (crashed, or tab in the background) is removed.
export type PingMessage = { t: number };
export const HEARTBEAT_MS = 1000;
export const SILENT_KICK_MS = 10_000;
// Close code when another tab with the same key took over this player (e.g. a duplicated tab).
// That tab must not rejoin, or the two would keep kicking each other out.
export const TAKEN_OVER = 4001;

// Browser -> server, once per movement tick while moving, jumping or falling (and once when stopping).
// x/y: screen direction (-1, 0, 1); j: 1 while jump is held.
export type InputMessage = { seq: number; x: number; y: number; j: number };
// Browser -> server: hit the tree/rock on tile (x, y).
export type InteractMessage = { x: number; y: number };
// Browser -> server: break the top block of column (x, y).
export type BreakMessage = { x: number; y: number };
// Browser -> server: put one `item` on top of column (x, y) as a block.
export type PlaceMessage = { x: number; y: number; item: string };

// Server -> browser: synced automatically by Colyseus.
// Note: synced fields start out undefined, so the server must set every one.
export const PlayerState = schema(
  {
    x: t.float64(),
    y: t.float64(),
    z: t.float64(), // height of feet, in blocks
    vz: t.float64(), // vertical speed while jumping/falling
    dirX: t.int8(), // last pressed direction, for facing and walk animation
    dirY: t.int8(),
    color: t.uint8(), // index into SCARF_COLORS
    seq: t.uint32(), // last input the server has applied for this player
    jumpHeight: t.float64(), // in blocks; potions or spells could raise it later
    actions: t.uint16(), // counts up every time this player strikes; others play the animation
    inventory: t.map('uint16'), // item type -> how many they carry
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

// A tree/rock that players have hit. Untouched ones aren't listed: everyone generates those from the seed.
export const PropState = schema(
  {
    x: t.int32(),
    y: t.int32(),
    hp: t.uint8(), // hits left; 0 = destroyed (kept so players who join later know it's gone)
  },
  'PropState',
);
export type PropState = SchemaType<typeof PropState>;

// A column players have built on or dug into. Untouched columns aren't listed.
export const ColumnState = schema(
  {
    x: t.int32(),
    y: t.int32(),
    blocks: t.string(), // one letter per block, bottom first (see BLOCK_CODE)
  },
  'ColumnState',
);
export type ColumnState = SchemaType<typeof ColumnState>;

export const WorldState = schema(
  {
    seed: t.uint32(), // the whole world is generated from this
    players: t.map(PlayerState),
    props: t.map(PropState), // keyed "x,y"
    columns: t.map(ColumnState), // keyed "x,y"
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;

export const SCARF_COLORS = [0x8a55c4, 0xd94a4a, 0x3f8fe0, 0xe8b13a, 0x3cbf8a, 0xe06fb5, 0xf08a3c, 0xe8e8e8];
export const PROP_HP: Record<string, number> = { tree: 3, rock: 4 };
export const ACTION_COOLDOWN_MS = 350; // fastest you can strike
export const BUILD_COOLDOWN_MS = 150; // fastest you can place or break blocks
