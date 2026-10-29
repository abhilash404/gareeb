import Phaser from 'phaser';
import { allSheets } from './characterSheets';

// Queue the world art and every character sheet. Both scenes call this; whatever an earlier scene
// already loaded is skipped.
export function preloadArt(scene: Phaser.Scene) {
  const textures = scene.textures;
  // All world sprites come from one atlas (built by tools/pack-atlas.mjs), so they draw in one go.
  if (!textures.exists('terrain')) scene.load.atlas('terrain', 'atlas/terrain.png', 'atlas/terrain.json');
  // Every race/class sheet that exists (they're small), plus the placeholder and its scarf layer.
  for (const sheet of allSheets()) {
    const size = { frameWidth: sheet.frameW, frameHeight: sheet.frameH };
    if (!textures.exists(sheet.key)) scene.load.spritesheet(sheet.key, sheet.url, size);
    if (sheet.scarf && !textures.exists(`${sheet.key}_scarf`)) scene.load.spritesheet(`${sheet.key}_scarf`, sheet.scarf, size);
  }
}
