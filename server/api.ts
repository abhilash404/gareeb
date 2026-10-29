// Small web API used before joining the world: login settings, and creating your character.
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { accountOf, SUPABASE_URL, SUPABASE_ANON_KEY, DEV_LOGIN } from './auth';
import { getStorage } from './storage';
import { isRace, isClass, isValidUsername, USERNAME_RULES } from '../shared/characters';

type AuthedRequest = Request & { account?: string };

export function addApi(app: Application) {
  // In development the game page (port 5173) and this server (2567) are different sites,
  // so browsers need permission to call it.
  app.use('/api', (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') res.sendStatus(204);
    else next();
  });

  // Settings the login screen needs. Read from the server so they only have to be set in one place.
  app.get('/api/config', (_req, res) => {
    res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, devLogin: DEV_LOGIN });
  });

  // Your character, or null if you haven't made one yet.
  app.get('/api/me', signedIn, async (req: AuthedRequest, res) => {
    const player = await (await getStorage()).loadPlayer(req.account!);
    res.json({ character: player && { username: player.username, race: player.race, cls: player.cls } });
  });

  // Create your character (once per account).
  app.post('/api/character', express.json(), signedIn, async (req: AuthedRequest, res) => {
    const { username, race, cls } = req.body ?? {};
    if (!isValidUsername(username)) return void res.status(400).json({ error: `Name must be ${USERNAME_RULES}.` });
    if (!isRace(race) || !isClass(cls)) return void res.status(400).json({ error: 'Pick a race and a class.' });

    const storage = await getStorage();
    if (await storage.loadPlayer(req.account!)) {
      return void res.status(409).json({ error: 'You already have a character.' });
    }
    const created = await storage.createPlayer({ id: req.account!, username, race, cls, inventory: {} });
    if (!created) return void res.status(409).json({ error: 'That name is taken.' });
    console.log(`character created: ${username} (${race} ${cls})`);
    res.status(201).json({ character: { username, race, cls } });
  });
}

// Only let through requests with a valid login ("Authorization: Bearer <token>").
async function signedIn(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.get('Authorization')?.replace(/^Bearer /, '');
  const account = await accountOf(token);
  if (!account) return void res.status(401).json({ error: 'Please sign in again.' });
  req.account = account;
  next();
}
