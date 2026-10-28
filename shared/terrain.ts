// Procedural terrain. The same seed always produces the same world, on every computer:
// only integer hashing and + - * / are used, so browsers and the server agree exactly.

export const CHUNK = 16; // chunks are CHUNK x CHUNK columns
export const SEA_LEVEL = 3; // ground lower than this is under water
export const MAX_HEIGHT = 14; // highest generated ground
export const BUILD_LIMIT = 24; // players can build up to this height
const STONE_PEAKS = 10; // ground this high has a bare stone top

export type BlockType = 'grass' | 'dirt' | 'stone' | 'sand' | 'water' | 'planks';

// One letter per block type, for storing and sending edited columns compactly as strings.
export const BLOCK_CODE: Record<BlockType, string> = {
  grass: 'g',
  dirt: 'd',
  stone: 's',
  sand: 'a',
  water: 'w',
  planks: 'p',
};
export const BLOCK_OF_CODE = Object.fromEntries(
  Object.entries(BLOCK_CODE).map(([type, code]) => [code, type]),
) as Record<string, BlockType>;
export const encodeColumn = (blocks: BlockType[]) => blocks.map((b) => BLOCK_CODE[b]).join('');
export const decodeColumn = (s: string) => [...s].map((c) => BLOCK_OF_CODE[c]).filter(Boolean);
export type PropKind = 'tree' | 'rock';

export type Chunk = {
  ground: Int8Array; // height of the land in each column
  props: Uint8Array; // what stands on each column: an index into PROP_KINDS
};

// ---------- Noise ----------

// A well-mixed 32-bit hash of a grid point.
function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Random number in [0, 1) for a grid point.
export const random = (x: number, y: number, seed: number) => hash(x, y, seed) / 4294967296;

// Gradient directions, picked per grid corner by its hash.
const GRAD_X = new Float64Array([1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GRAD_Y = new Float64Array([0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

// Perlin noise: smooth random hills, roughly -1..1.
// Written without temporary arrays or functions, since it runs thousands of times per chunk.
function perlin(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const g00 = hash(x0, y0, seed) & 7;
  const g10 = hash(x0 + 1, y0, seed) & 7;
  const g01 = hash(x0, y0 + 1, seed) & 7;
  const g11 = hash(x0 + 1, y0 + 1, seed) & 7;
  const n00 = GRAD_X[g00] * fx + GRAD_Y[g00] * fy;
  const n10 = GRAD_X[g10] * (fx - 1) + GRAD_Y[g10] * fy;
  const n01 = GRAD_X[g01] * fx + GRAD_Y[g01] * (fy - 1);
  const n11 = GRAD_X[g11] * (fx - 1) + GRAD_Y[g11] * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10); // smooth fade
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const top = n00 + (n10 - n00) * u;
  const bottom = n01 + (n11 - n01) * u;
  return (top + (bottom - top) * v) * 1.4;
}

// Several layers of noise, from big shapes down to small bumps.
function fbm(x: number, y: number, seed: number, octaves: number) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += perlin(x * freq, y * freq, seed + i * 1013) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

// ---------- Terrain ----------

// The noise is only worked out every SAMPLE tiles and blended in between: the land shapes are
// smooth at that scale anyway, and it's ~16x less noise work. Sample points sit at multiples of
// SAMPLE in world coordinates, so neighbouring chunks line up exactly.
const SAMPLE = 4;
const SAMPLES = CHUNK / SAMPLE + 1;

// Land height before rounding to whole blocks.
function rawHeight(seed: number, x: number, y: number) {
  const land = fbm(x / 64, y / 64, seed, 4); // rolling plains and lakes
  const hilliness = fbm(x / 160, y / 160, seed + 31, 3); // where the mountains are
  const mountains = Math.max(0, hilliness - 0.15) * 22;
  return 4.5 + land * 8 + mountains;
}

// How wooded an area is: above 0.2 counts as forest.
const forestness = (seed: number, x: number, y: number) => fbm(x / 40, y / 40, seed + 7, 2);

export const PROP_KINDS: (PropKind | null)[] = [null, 'tree', 'rock'];
const TREE = 1;
const ROCK = 2;

export function generateChunk(seed: number, cx: number, cy: number): Chunk {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;

  // Noise at the sample points covering this chunk (including its far edges).
  const heights = new Float64Array(SAMPLES * SAMPLES);
  const forests = new Float64Array(SAMPLES * SAMPLES);
  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) {
      heights[j * SAMPLES + i] = rawHeight(seed, x0 + i * SAMPLE, y0 + j * SAMPLE);
      forests[j * SAMPLES + i] = forestness(seed, x0 + i * SAMPLE, y0 + j * SAMPLE);
    }
  }
  // Blend between the four sample points around a column.
  const blend = (field: Float64Array, lx: number, ly: number) => {
    const i = (lx / SAMPLE) | 0;
    const j = (ly / SAMPLE) | 0;
    const tx = (lx % SAMPLE) / SAMPLE;
    const ty = (ly % SAMPLE) / SAMPLE;
    const a = field[j * SAMPLES + i];
    const b = field[j * SAMPLES + i + 1];
    const c = field[(j + 1) * SAMPLES + i];
    const d = field[(j + 1) * SAMPLES + i + 1];
    const top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * ty;
  };

  const ground = new Int8Array(CHUNK * CHUNK);
  const props = new Uint8Array(CHUNK * CHUNK); // index into PROP_KINDS
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const i = ly * CHUNK + lx;
      const h = Math.min(Math.max(Math.floor(blend(heights, lx, ly)), 1), MAX_HEIGHT);
      ground[i] = h;
      if (h <= SEA_LEVEL || h >= STONE_PEAKS) continue; // nothing grows on beaches or bare peaks
      const r = random(x0 + lx, y0 + ly, seed + 101);
      if (r < (blend(forests, lx, ly) > 0.2 ? 0.2 : 0.015)) props[i] = TREE;
      else if (r > 0.988) props[i] = ROCK;
    }
  }
  return { ground, props };
}

// What block is at height z in a column whose land is `ground` blocks high.
export function blockType(ground: number, z: number): BlockType | null {
  if (z >= ground) return z < SEA_LEVEL ? 'water' : null;
  const depth = ground - 1 - z; // 0 = top block
  if (ground <= SEA_LEVEL) return depth <= 1 ? 'sand' : 'stone'; // beaches and lake beds
  if (depth === 0) return ground >= STONE_PEAKS ? 'stone' : 'grass';
  return depth <= 2 ? 'dirt' : 'stone';
}
