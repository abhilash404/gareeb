import Phaser from 'phaser';
import { gridToPixel, depth, ZOOM } from './iso';
import { sheetFor, CLASS_COLOR, type Sheet } from './characterSheets';
import type { ClassId } from '../shared/characters';

const POSES = ['idle', 'walk', 'jump', 'action'] as const;

// Animations are made once per sheet (and its scarf layer), named "<texture>_<pose>_<front|back>".
function ensureAnims(scene: Phaser.Scene, sheet: Sheet) {
  if (scene.anims.exists(`${sheet.key}_idle_front`)) return;
  const textures = sheet.scarf ? [sheet.key, `${sheet.key}_scarf`] : [sheet.key];
  for (const texture of textures) {
    for (const pose of POSES) {
      for (const side of ['front', 'back'] as const) {
        scene.anims.create({
          key: `${texture}_${pose}_${side}`,
          frames: scene.anims.generateFrameNumbers(texture, { frames: sheet.anims[pose][side] }),
          frameRate: pose === 'action' ? 16 : 8,
          repeat: pose === 'action' ? 0 : -1,
        });
      }
    }
  }
}

// How a character looks on screen: their race/class sprite, a shadow, their name above them,
// and a faint silhouette shown when terrain hides them.
// It doesn't decide where the character is; whoever owns it calls setPosition/setMotion.
export class CharacterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private scarf?: Phaser.GameObjects.Sprite; // placeholder art only: shows the class colour
  private silhouette: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private nameTag: Phaser.GameObjects.Text;
  private sheet: Sheet;
  private facingBack = false;
  private acting = false; // an action animation is playing; don't interrupt it

  constructor(scene: Phaser.Scene, look: { name: string; race: string; cls: string }) {
    this.sheet = sheetFor(look.race, look.cls);
    const sheet = this.sheet;
    ensureAnims(scene, sheet);
    // Origin at the feet so the character stands on the tile.
    const originY = sheet.footY / sheet.frameH;
    this.shadow = scene.add.image(0, 0, 'terrain', 'shadow').setScale(0.6);
    this.sprite = scene.add.sprite(0, 0, sheet.key, 0).setOrigin(0.5, originY);
    if (sheet.scarf) {
      this.scarf = scene.add
        .sprite(0, 0, `${sheet.key}_scarf`, 0)
        .setOrigin(0.5, originY)
        .setTint(CLASS_COLOR[look.cls as ClassId] ?? 0xffffff);
    }
    this.silhouette = scene.add
      .sprite(0, 0, sheet.key, 0)
      .setOrigin(0.5, originY)
      .setTintFill(0xffffff)
      .setAlpha(0.35)
      .setDepth(depth.overlay)
      .setVisible(false);
    this.nameTag = scene.add
      .text(0, 0, look.name, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '7px',
        color: '#f4f1ff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setResolution(ZOOM * window.devicePixelRatio) // drawn at screen resolution, so it stays sharp
      .setDepth(depth.overlay + 1);
    this.sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => (this.acting = false));
  }

  // groundZ is the height of the ground below, where the shadow goes.
  setPosition(gx: number, gy: number, z: number, groundZ: number) {
    const { x, y } = gridToPixel(gx, gy, z);
    this.sprite.setPosition(x, y);
    this.scarf?.setPosition(x, y);
    this.silhouette.setPosition(x, y);
    this.nameTag.setPosition(x, y - this.sheet.footY - 1);
    const shadowPos = gridToPixel(gx, gy, groundZ);
    this.shadow.setPosition(shadowPos.x, shadowPos.y);

    // Changing depth makes Phaser re-sort every sprite in the scene, so only do it when it changes.
    const d = depth.character(gx, gy);
    if (this.sprite.depth !== d) {
      this.sprite.setDepth(d);
      this.scarf?.setDepth(d + 0.001);
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
    for (const o of [this.sprite, this.scarf, this.silhouette, this.shadow, this.nameTag]) o?.destroy();
  }

  private face(x: number, y: number) {
    if (y > 0) this.facingBack = false;
    if (y < 0) this.facingBack = true;
    if (x !== 0) {
      for (const s of [this.sprite, this.scarf, this.silhouette]) s?.setFlipX(x < 0);
    }
  }

  private play(pose: string, ignoreIfPlaying = true) {
    const anim = `${pose}_${this.facingBack ? 'back' : 'front'}`;
    this.sprite.play(`${this.sheet.key}_${anim}`, ignoreIfPlaying);
    this.scarf?.play(`${this.sheet.key}_scarf_${anim}`, ignoreIfPlaying);
  }
}
