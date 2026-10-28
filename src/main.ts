import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#1b1b1f',
  pixelArt: true, // keep pixels crisp when zoomed
  roundPixels: false, // pixelArt would round to whole art pixels; the camera snaps to screen pixels itself
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [WorldScene],
});

// Handy for poking at the game from the browser console while developing.
if (import.meta.env.DEV) (window as any).game = game;
