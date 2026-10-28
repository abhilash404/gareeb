import { ITEMS, type ItemType } from '../shared/items';

const ICON_SCALE = 2; // whole numbers only, so pixel art stays crisp

// Where an item's picture is in the atlas image.
export type IconFrame = { x: number; y: number; w: number; h: number; sheetW: number; sheetH: number };

// The row of item slots at the bottom of the screen. Number keys or the mouse wheel pick a slot;
// right-click places the picked item as a block.
export class Hotbar {
  private selected = 0;
  private slots: HTMLElement[] = [];
  private countEls: HTMLElement[] = [];

  constructor(atlasUrl: string, frameOf: (name: string) => IconFrame) {
    const bar = document.getElementById('hotbar')!;
    bar.replaceChildren();
    ITEMS.forEach((item, i) => {
      const f = frameOf(item.icon);
      const icon = document.createElement('div');
      icon.className = 'icon';
      Object.assign(icon.style, {
        width: `${f.w * ICON_SCALE}px`,
        height: `${f.h * ICON_SCALE}px`,
        backgroundImage: `url(${atlasUrl})`,
        backgroundPosition: `-${f.x * ICON_SCALE}px -${f.y * ICON_SCALE}px`,
        backgroundSize: `${f.sheetW * ICON_SCALE}px ${f.sheetH * ICON_SCALE}px`,
      });
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      const count = document.createElement('span');
      count.className = 'count';
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.title = item.name;
      slot.append(icon, key, count);
      slot.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.select(i);
      });
      bar.append(slot);
      this.slots.push(slot);
      this.countEls.push(count);
    });
    this.select(0);
    this.setCounts(() => 0);
  }

  get item(): ItemType {
    return ITEMS[this.selected].type;
  }

  select(i: number) {
    this.selected = ((i % ITEMS.length) + ITEMS.length) % ITEMS.length;
    this.slots.forEach((s, j) => s.classList.toggle('selected', j === this.selected));
  }

  scroll(step: number) {
    this.select(this.selected + step);
  }

  setCounts(countOf: (item: ItemType) => number) {
    ITEMS.forEach((item, i) => {
      const n = countOf(item.type);
      this.countEls[i].textContent = n > 0 ? String(n) : '';
      this.slots[i].classList.toggle('empty', n === 0);
    });
  }
}
