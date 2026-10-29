// Character options. Cosmetic only for now. To add a race or class, add it here and put its
// sprite sheets in public/characters/ (see README "Character sprites").

export const RACES = [
  { id: 'human', name: 'Human' },
  { id: 'elf', name: 'Elf' },
  { id: 'dwarf', name: 'Dwarf' },
  { id: 'goblin', name: 'Goblin' },
  { id: 'merfolk', name: 'Merfolk' },
] as const;

export const CLASSES = [
  { id: 'knight', name: 'Knight' },
  { id: 'tank', name: 'Tank' },
  { id: 'mage', name: 'Mage' },
  { id: 'assassin', name: 'Assassin' },
  { id: 'cleric', name: 'Cleric' },
] as const;

export type RaceId = (typeof RACES)[number]['id'];
export type ClassId = (typeof CLASSES)[number]['id'];

export const isRace = (s: unknown): s is RaceId => RACES.some((r) => r.id === s);
export const isClass = (s: unknown): s is ClassId => CLASSES.some((c) => c.id === s);

// Usernames: 3-16 letters, numbers or underscores. Unique, ignoring upper/lower case.
export const USERNAME_RULES = '3-16 letters, numbers or _';
export const isValidUsername = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(s);

// What the server stores and sends about a player's character.
export type Character = { username: string; race: RaceId; cls: ClassId };
