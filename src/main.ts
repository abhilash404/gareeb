import Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';
import { WorldScene } from './scenes/WorldScene';
import { loadLoginConfig, currentToken, api, signOut, type LoginConfig } from './auth';
import { showLogin, showCharacterCreation, hideScreens } from './screens';
import { loadCharacterManifest } from './characterSheets';
import { showStatus } from './status';
import type { Character } from '../shared/characters';

// Before the game: reach the server, sign in, make sure we have a character.
// The welcome screen's moving world plays behind all of this.
async function boot(game: Phaser.Game) {
  let config: LoginConfig;
  try {
    config = await loadLoginConfig();
  } catch {
    showStatus("Can't reach the game server. Retrying…");
    setTimeout(() => boot(game), 3000);
    return;
  }
  showStatus(null);

  while (!(await currentToken())) await showLogin(config);

  const me = await api<{ character: Character | null }>('/api/me');
  if (me.status === 401) {
    await signOut(); // the login expired or was revoked: start again
    return;
  }
  if (!me.data.character) await showCharacterCreation();
  hideScreens();

  const signOutButton = document.getElementById('signout')!;
  signOutButton.hidden = false;
  signOutButton.onclick = () => signOut();
  game.scene.stop('title');
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
    scene: [TitleScene, WorldScene], // only the first starts by itself
  });

  // Handy for poking at the game from the browser console while developing.
  if (import.meta.env.DEV) (window as any).game = game;
  return game;
}

// The sprite list comes first: the welcome screen, character creation and the game all use it.
loadCharacterManifest().then(() => boot(startGame()));
