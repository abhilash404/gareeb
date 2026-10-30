// Items players can carry and what they come from.
import type { PropKind } from './terrain';

export type ItemType = 'wood' | 'stone';

// In hotbar order. `icon` is its picture in the atlas.
export const ITEMS: { type: ItemType; name: string; icon: string }[] = [
  { type: 'wood', name: 'Wood', icon: 'planks' },
  { type: 'stone', name: 'Stone', icon: 'stone' },
];

export const isItem = (s: unknown): s is ItemType => ITEMS.some((i) => i.type === s);

// What a tree or rock drops when it breaks.
export const PROP_DROPS: Record<PropKind, { item: ItemType; count: number }> = {
  tree: { item: 'wood', count: 3 },
  rock: { item: 'stone', count: 2 },
};

export const MAX_STACK = 999; // most of one item a player can carry
