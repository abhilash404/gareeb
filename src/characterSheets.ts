// Which sprite sheet a character uses, and which frames make up each animation.
import type { RaceId, ClassId } from '../shared/characters';

export type Sheet = {
  key: string; // texture name in Phaser
  url: string;
  frameW: number;
  frameH: number;
  footY: number; // where the feet touch the ground, in pixels from the top of a frame
  anims: Record<'idle' | 'walk' | 'jump' | 'action', { front: number[]; back: number[] }>;
  scarf?: string; // url of a white scarf layer, tinted per class (placeholder only)
};

// The real art: public/characters/<race>_<class>.png. 8 columns x 2 rows of 32x32 frames.
// Row 1 faces down-right, row 2 up-right; each row: idle, 4 walk frames, 3 action frames.
// (Left-facing directions are the same frames, flipped.)
function generatedSheet(race: RaceId, cls: ClassId): Sheet {
  return {
    key: `char_${race}_${cls}`,
    url: `characters/${race}_${cls}.png`,
    frameW: 32,
    frameH: 32,
    footY: 31,
    anims: {
      idle: { front: [0], back: [8] },
      walk: { front: [1, 2, 3, 4], back: [9, 10, 11, 12] },
      jump: { front: [2], back: [10] },
      action: { front: [5, 6, 6, 7], back: [13, 14, 14, 15] },
    },
  };
}

// The hooded placeholder, used for any race/class whose art isn't in yet.
export const PLACEHOLDER: Sheet = {
  key: 'player',
  url: 'assets/player.png',
  frameW: 16,
  frameH: 24,
  footY: 22,
  anims: {
    idle: { front: [0], back: [3] },
    walk: { front: [1, 0, 2, 0], back: [4, 3, 5, 3] },
    jump: { front: [1], back: [4] },
    action: { front: [6, 7, 7, 8], back: [9, 10, 10, 11] },
  },
  scarf: 'assets/player_scarf.png',
};

// Until the art is in, the placeholder's scarf shows the class.
export const CLASS_COLOR: Record<ClassId, number> = {
  knight: 0x3f8fe0,
  tank: 0x9aa0a8,
  mage: 0x8a55c4,
  assassin: 0xd94a4a,
  cleric: 0xe8b13a,
};

// Which sheets exist, from public/characters/manifest.json (written by tools/pack-atlas.mjs).
let available = new Set<string>();

export async function loadCharacterManifest() {
  try {
    const res = await fetch('characters/manifest.json');
    if (res.ok) available = new Set(await res.json());
  } catch {
    // No manifest: everyone uses the placeholder.
  }
}

export function sheetFor(race: string, cls: string): Sheet {
  return available.has(`${race}_${cls}`) ? generatedSheet(race as RaceId, cls as ClassId) : PLACEHOLDER;
}

// Every sheet that exists, so the game can load them all up front (they're tiny).
export function allSheets(): Sheet[] {
  return [PLACEHOLDER, ...[...available].map((name) => {
    const [race, cls] = name.split('_');
    return generatedSheet(race as RaceId, cls as ClassId);
  })];
}
