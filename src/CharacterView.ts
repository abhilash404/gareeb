import Phaser from 'phaser';
import { gridToPixel, depth } from './iso';

// Frames in player.png / player_scarf.png (see tools/make-sprites.mjs):
// 0-2 front walk, 3-5 back walk, 6-8 front action, 9-11 back action.
const ANIMS = [
  { key: 'idle_front', frames: [0], rate: 8, loop: true },
  { key: 'idle_back', frames: [3], rate: 8, loop: true },
  { key: 'walk_front', frames: [1, 0, 2, 0], rate: 8, loop: true },
  { key: 'walk_back', frames: [4, 3, 5, 3], rate: 8, loop: true },
  { key: 'jump_front', frames: [1], rate: 8, loop: true },
  { key: 'jump_back', frames: [4], rate: 8, loop: true },
  { key: 'action_front', frames: [6, 7, 7, 8], rate: 16, loop: false },
  { key: 'action_back', frames: [9, 10, 10, 11], rate: 16, loop: false },
];

function ensureAnims(scene: Phaser.Scene) {
  if (scene.anims.exists('player_walk_front')) return;
  for (const sheet of ['player', 'player_scarf']) {
    for (const a of ANIMS) {
      scene.anims.create({
        key: `${sheet}_${a.key}`,
        frames: scene.anims.generateFrameNumbers(sheet, { frames: a.frames }),
        frameRate: a.rate,
        repeat: a.loop ? -1 : 0,
      });
    }
  }
}

// How a character looks on screen: body, a tinted scarf layer, a shadow, and a faint
// silhouette shown when terrain hides them.
// It doesn't decide where the character is; whoever owns it calls setPosition/setMotion.
export class CharacterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private scarf: Phaser.GameObjects.Sprite;
  private silhouette: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private facingBack = false;
  private acting = false; // an action animation is playing; don't interrupt it

  constructor(scene: Phaser.Scene, scarfColor: number) {
    ensureAnims(scene);
    this.shadow = scene.add.image(0, 0, 'terrain', 'shadow').setScale(0.6);
    // Origin at the feet so the character stands on the tile.
    this.sprite = scene.add.sprite(0, 0, 'player', 0).setOrigin(0.5, 22 / 24);
    this.scarf = scene.add.sprite(0, 0, 'player_scarf', 0).setOrigin(0.5, 22 / 24).setTint(scarfColor);
    this.silhouette = scene.add
      .sprite(0, 0, 'player', 0)
      .setOrigin(0.5, 22 / 24)
      .setTintFill(0xffffff)
      .setAlpha(0.35)
      .setDepth(depth.overlay)
      .setVisible(false);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => (this.acting = false));
  }

  // groundZ is the height of the ground below, where the shadow goes.
  setPosition(gx: number, gy: number, z: number, groundZ: number) {
    const { x, y } = gridToPixel(gx, gy, z);
    this.sprite.setPosition(x, y);
    this.scarf.setPosition(x, y);
    this.silhouette.setPosition(x, y);
    const shadowPos = gridToPixel(gx, gy, groundZ);
    this.shadow.setPosition(shadowPos.x, shadowPos.y);

    // Changing depth makes Phaser re-sort every sprite in the scene, so only do it when it changes.
    const d = depth.character(gx, gy);
    if (this.sprite.depth !== d) {
      this.sprite.setDepth(d);
      this.scarf.setDepth(d + 0.001);
    }
    const sd = depth.onSurface(Math.floor(gx), Math.floor(gy), groundZ);
    if (this.shadow.depth !== sd) this.shadow.setDepth(sd);
  }

  // dir: pressed screen direction. airborne: jumping or falling.
  setMotion(dir: { x: number; y: number }, airborne: boolean) {
    if (!this.acting) this.face(dir.x, dir.y);
    const moving = dir.x !== 0 || dir.y !== 0;
    const pose = airborne ? 'jump' : moving ? 'walk' : 'idle';
    if (!this.acting) this.play(pose);
    this.silhouette.setFrame(this.sprite.frame.name);
  }

  // Strike towards a screen direction (e.g. the thing being hit).
  playAction(towardsX = 0, towardsY = 0) {
    this.face(towardsX, towardsY);
    this.acting = true;
    this.play('action', false);
  }

  setHidden(hidden: boolean) {
    this.silhouette.setVisible(hidden);
  }

  destroy() {
    for (const o of [this.sprite, this.scarf, this.silhouette, this.shadow]) o.destroy();
  }

  private face(x: number, y: number) {
    if (y > 0) this.facingBack = false;
    if (y < 0) this.facingBack = true;
    if (x !== 0) {
      for (const s of [this.sprite, this.scarf, this.silhouette]) s.setFlipX(x < 0);
    }
  }

  private play(pose: string, ignoreIfPlaying = true) {
    const anim = `${pose}_${this.facingBack ? 'back' : 'front'}`;
    this.sprite.play(`player_${anim}`, ignoreIfPlaying);
    this.scarf.play(`player_scarf_${anim}`, ignoreIfPlaying);
  }
}
