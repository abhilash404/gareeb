// Items players can carry, what they come from, and what they build.
import type { BlockType, PropKind } from './terrain';

export type ItemType = 'dirt' | 'stone' | 'sand' | 'wood';

// In hotbar order. `block` is what the item places; `icon` is its picture in the atlas.
export const ITEMS: { type: ItemType; name: string; block: BlockType; icon: string }[] = [
  { type: 'wood', name: 'Wood', block: 'planks', icon: 'planks' },
  { type: 'stone', name: 'Stone', block: 'stone', icon: 'stone' },
  { type: 'dirt', name: 'Dirt', block: 'dirt', icon: 'dirt' },
  { type: 'sand', name: 'Sand', block: 'sand', icon: 'sand' },
];

export const isItem = (s: unknown): s is ItemType => ITEMS.some((i) => i.type === s);
export const blockOfItem = (item: ItemType) => ITEMS.find((i) => i.type === item)!.block;

// What you get for breaking a block (null = can't be broken).
export const ITEM_FROM_BLOCK: Record<BlockType, ItemType | null> = {
  grass: 'dirt',
  dirt: 'dirt',
  stone: 'stone',
  sand: 'sand',
  planks: 'wood',
  water: null,
};

// What a tree or rock drops when it breaks.
export const PROP_DROPS: Record<PropKind, { item: ItemType; count: number }> = {
  tree: { item: 'wood', count: 3 },
  rock: { item: 'stone', count: 2 },
};

export const MAX_STACK = 999; // most of one item a player can carry
