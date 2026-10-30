// The screens before the game: signing in, and creating your character.
import { RACES, CLASSES, USERNAME_RULES, isValidUsername, type Character, type RaceId, type ClassId } from '../shared/characters';
import { api, devSignIn, signInWithGoogle, type LoginConfig } from './auth';
import { sheetFor, CLASS_COLOR, type Sheet } from './characterSheets';

const screen = () => document.getElementById('screen')!;

// Make an element with some properties (className, textContent, onclick...) and children.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

export function hideScreens() {
  screen().hidden = true;
  screen().className = '';
  screen().replaceChildren();
}

// Google's "G", drawn as a few pixel blocks to match the button.
function googleIcon() {
  const icon = el('span', { className: 'gicon' });
  icon.innerHTML =
    '<svg viewBox="0 0 8 8" width="20" height="20" shape-rendering="crispEdges">' +
    '<path fill="#ea4335" d="M2 0h4v1h1v1H5V1H2z"/>' +
    '<path fill="#fbbc05" d="M1 1h1v1H1v4H0V2h1z"/>' +
    '<path fill="#34a853" d="M1 6h1v1h3v1H2V7H1z"/>' +
    '<path fill="#4285f4" d="M4 3h4v3H7v1H5V6h1V5H4z"/></svg>';
  return icon;
}

// The welcome screen: the logo over the moving world (TitleScene), and a panel under it holding
// either a message ("Connecting…") or the sign-in buttons. It's built once and its panel refilled,
// so the logo doesn't flicker between steps.
let welcomePanel: HTMLDivElement | undefined;
let logo: HTMLImageElement | undefined;
function welcome() {
  if (welcomePanel && screen().className === 'welcome') return welcomePanel;
  welcomePanel = el('div', { className: 'panel' });
  logo = el('img', { className: 'logo', src: 'ui/logo.png', alt: 'Gareeb' });
  screen().className = 'welcome';
  screen().replaceChildren(
    el('div', { className: 'welcome-box' },
      logo,
      el('p', { className: 'tagline', textContent: 'Gather, build a home, and find your kingdom.' }),
      welcomePanel,
    ),
    el('footer', {}, el('a', { href: 'privacy.html', textContent: 'Privacy' })),
  );
  screen().hidden = false;
  return welcomePanel;
}

// Resolves once the logo can be drawn (or failed to load), so the page can appear all at once.
export function welcomeLogoReady(): Promise<void> {
  welcome();
  return logo!.decode().catch(() => {});
}

export function showWelcomeMessage(text: string) {
  welcome().replaceChildren(el('p', { className: 'center', textContent: text }));
}

// The sign-in buttons. Google sign-in leaves the page and comes back signed in; the development
// login (typing a name) resolves straight away.
export function showLogin(config: LoginConfig): Promise<void> {
  return new Promise((resolve) => {
    const panel = welcome();
    panel.replaceChildren();
    if (config.supabaseUrl) {
      panel.append(
        el('button', { className: 'primary google', onclick: signInWithGoogle }, googleIcon(), 'Sign in with Google'),
        el('p', { className: 'hint center', textContent: 'No password needed. We never see your Google password.' }),
      );
    }
    if (config.devLogin) {
      const name = el('input', { placeholder: 'Test player name', maxLength: 32 });
      const go = () => {
        const n = name.value.trim().replace(/[^A-Za-z0-9_]/g, '');
        if (!n) return;
        devSignIn(n);
        resolve();
      };
      name.onkeydown = (e) => e.key === 'Enter' && go();
      panel.append(
        el('p', { className: 'hint', textContent: 'Development login (only on your own computer):' }),
        el('div', { className: 'row' }, name, el('button', { textContent: 'Play', onclick: go })),
      );
    }
    if (!config.supabaseUrl && !config.devLogin) {
      panel.append(el('p', { textContent: 'Sign-in is not set up on this server yet.' }));
    }
  });
}

// Character creation: name, race, class, with a walking preview. Resolves once the server saved it.
export function showCharacterCreation(): Promise<Character> {
  return new Promise((resolve) => {
    let race: RaceId = RACES[0].id;
    let cls: ClassId = CLASSES[0].id;

    const name = el('input', { placeholder: 'Your name', maxLength: 16 });
    const error = el('p', { className: 'error' });
    const preview = el('canvas', { className: 'preview', width: 32, height: 32 });
    const caption = el('p', { className: 'hint' });

    const picker = <T extends string>(options: readonly { id: T; name: string }[], onPick: (id: T) => void) => {
      const row = el('div', { className: 'choices' });
      options.forEach((o, i) => {
        const b = el('button', { textContent: o.name });
        b.onclick = () => {
          row.querySelectorAll('button').forEach((x) => x.classList.remove('picked'));
          b.classList.add('picked');
          onPick(o.id);
          redraw();
        };
        if (i === 0) b.classList.add('picked');
        row.append(b);
      });
      return row;
    };

    const stopPreview = animatePreview(preview, () => ({ race, cls }));
    const redraw = () => {
      const art = sheetFor(race, cls).key !== 'player';
      const label = `${RACES.find((r) => r.id === race)!.name} ${CLASSES.find((c) => c.id === cls)!.name}`;
      caption.textContent = art ? label : `${label} (art coming soon)`;
    };

    const create = el('button', { className: 'primary', textContent: 'Create character' });
    create.onclick = async () => {
      const username = name.value.trim();
      if (!isValidUsername(username)) {
        error.textContent = `Name must be ${USERNAME_RULES}.`;
        return;
      }
      create.disabled = true;
      error.textContent = '';
      const res = await api<{ character?: Character; error?: string }>('/api/character', { username, race, cls });
      create.disabled = false;
      if (!res.ok || !res.data.character) {
        error.textContent = res.data.error ?? 'Something went wrong. Try again.';
        return;
      }
      stopPreview();
      resolve(res.data.character);
    };

    const panel = el(
      'div',
      { className: 'panel wide' },
      el('h1', { textContent: 'Create your character' }),
      el('div', { className: 'creator' },
        el('div', { className: 'stage' }, preview, caption),
        el('div', { className: 'options' },
          el('label', { textContent: 'Name' }), name,
          el('p', { className: 'hint', textContent: USERNAME_RULES }),
          el('label', { textContent: 'Race' }), picker(RACES, (id) => (race = id)),
          el('label', { textContent: 'Class' }), picker(CLASSES, (id) => (cls = id)),
          error, create,
        ),
      ),
    );
    screen().className = 'creating';
    screen().replaceChildren(panel);
    screen().hidden = false;
    redraw();
    name.focus();
  });
}

// Draw the chosen character walking on a small canvas. Returns a function that stops it.
function animatePreview(canvas: HTMLCanvasElement, current: () => { race: RaceId; cls: ClassId }) {
  const ctx = canvas.getContext('2d')!;
  const images = new Map<string, HTMLImageElement>();
  const image = (url: string) => {
    let img = images.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      images.set(url, img);
    }
    return img;
  };
  // The placeholder's white scarf, coloured for the class.
  const tinted = document.createElement('canvas');
  const drawFrame = (sheet: Sheet, img: HTMLImageElement, frame: number, color?: number) => {
    const cols = Math.max(1, Math.floor(img.width / sheet.frameW));
    const sx = (frame % cols) * sheet.frameW;
    const sy = Math.floor(frame / cols) * sheet.frameH;
    // Stand the character on the bottom of the preview, centred.
    const dx = Math.floor((canvas.width - sheet.frameW) / 2);
    const dy = canvas.height - 1 - sheet.footY;
    if (color === undefined) {
      ctx.drawImage(img, sx, sy, sheet.frameW, sheet.frameH, dx, dy, sheet.frameW, sheet.frameH);
      return;
    }
    tinted.width = sheet.frameW;
    tinted.height = sheet.frameH;
    const t = tinted.getContext('2d')!;
    t.drawImage(img, sx, sy, sheet.frameW, sheet.frameH, 0, 0, sheet.frameW, sheet.frameH);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    t.fillRect(0, 0, sheet.frameW, sheet.frameH);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(img, sx, sy, sheet.frameW, sheet.frameH, 0, 0, sheet.frameW, sheet.frameH);
    t.globalCompositeOperation = 'source-over';
    ctx.drawImage(tinted, dx, dy);
  };

  let step = 0;
  const timer = setInterval(() => {
    const { race, cls } = current();
    const sheet = sheetFor(race, cls);
    const frames = sheet.anims.walk.front;
    const frame = frames[step++ % frames.length];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawFrame(sheet, image(sheet.url), frame);
    if (sheet.scarf) drawFrame(sheet, image(sheet.scarf), frame, CLASS_COLOR[cls]);
  }, 160);
  return () => clearInterval(timer);
}
