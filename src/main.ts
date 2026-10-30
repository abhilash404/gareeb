import Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { loadLoginConfig, currentToken, api, signOut, type LoginConfig } from './auth';
import { showLogin, showCharacterCreation, showWelcomeMessage, welcomeLogoReady, hideScreens } from './screens';
import { loadCharacterManifest } from './characterSheets';
import { showStatus } from './status';
import type { Character } from '../shared/characters';

const REVEAL_TIMEOUT_MS = 4000; // show the page even if the background or logo is slow

// Before the game: reach the server, sign in, make sure we have a character.
// The welcome screen's moving world plays behind all of this.
async function boot(game: Phaser.Game) {
  let config: LoginConfig;
  try {
    config = await loadLoginConfig();
  } catch {
    showWelcomeMessage("Can't reach the game server. Retrying…");
    setTimeout(() => boot(game), 3000);
    return;
  }

  while (!(await currentToken())) await showLogin(config);

  showWelcomeMessage('Signing you in…');
  const me = await api<{ character: Character | null }>('/api/me');
  if (me.status === 401) {
    await signOut(); // the login expired or was revoked: start again
    return;
  }
  if (!me.data.character) await showCharacterCreation();

  // Keep the welcome screen up until the world has actually been drawn, then swap in one go.
  showWelcomeMessage('Entering the world…');
  game.events.once('world-ready', () => {
    game.scene.stop('title');
    hideScreens();
    const signOutButton = document.getElementById('signout')!;
    signOutButton.hidden = false;
    signOutButton.onclick = () => signOut();
  });
  game.scene.start('world');
}

function startGame() {
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
    // Only the first starts by itself. The world draws over the title until the title is stopped.
    scene: [TitleScene, WorldScene],
  });

  // The browser can take the graphics card away from the page for a moment (driver hiccups, low
  // memory); the screen goes black until it's given back and Phaser redraws. Say so, rather than
  // leaving a silent black screen.
  game.events.once(Phaser.Core.Events.READY, () => {
    game.canvas.addEventListener('webglcontextlost', () => {
      console.warn('Graphics context lost; waiting for the browser to restore it');
      showStatus('Graphics reset by the browser. Restoring…');
    });
    game.canvas.addEventListener('webglcontextrestored', () => {
      console.warn('Graphics context restored');
      showStatus(null);
    });
  });

  // Handy for poking at the game from the browser console while developing.
  if (import.meta.env.DEV) (window as any).game = game;
  return game;
}

// The page stays hidden (body.starting) until the moving background and the logo are both ready,
// so they fade in together.
function revealWhenReady(game: Phaser.Game) {
  const background = new Promise<void>((resolve) => game.events.once('title-ready', resolve));
  const reveal = () => document.body.classList.remove('starting');
  Promise.all([background, welcomeLogoReady()]).then(reveal);
  setTimeout(reveal, REVEAL_TIMEOUT_MS);
}

showWelcomeMessage('Connecting…');
// The sprite list comes first: the welcome screen, character creation and the game all use it.
loadCharacterManifest().then(() => {
  const game = startGame();
  revealWhenReady(game);
  boot(game);
});
