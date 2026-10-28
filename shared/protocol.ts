// What the browser and the server send each other.
import { schema, t, type SchemaType } from '@colyseus/schema';

export const SERVER_PORT = 2567;
export const ROOM_NAME = 'world';

// Browser -> server, once per movement tick while moving, jumping or falling (and once when stopping).
// x/y: screen direction (-1, 0, 1); j: 1 while jump is held.
export type InputMessage = { seq: number; x: number; y: number; j: number };
// Browser -> server: hit the tree/rock on tile (x, y).
export type InteractMessage = { x: number; y: number };

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

export const WorldState = schema(
  {
    seed: t.uint32(), // the whole world is generated from this
    players: t.map(PlayerState),
    props: t.map(PropState), // keyed "x,y"
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;

export const SCARF_COLORS = [0x8a55c4, 0xd94a4a, 0x3f8fe0, 0xe8b13a, 0x3cbf8a, 0xe06fb5, 0xf08a3c, 0xe8e8e8];
export const PROP_HP: Record<string, number> = { tree: 3, rock: 4 };
export const ACTION_COOLDOWN_MS = 350; // fastest you can strike
