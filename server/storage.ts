// Saving and loading worlds (the seed plus everything players changed) and player accounts.
// With DATABASE_URL set (any Postgres, e.g. a free Supabase or Neon database), everything is kept
// in the database, which survives restarts on hosts like Render whose disk is wiped.
// Without it, it's saved as files in save/ — fine when running on your own computer.
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { Character } from '../shared/characters';

export type SavedWorld = {
  version: 1;
  seed: number;
  props: [x: number, y: number, hp: number][]; // trees/rocks players hit (hp 0 = gone)
  columns: [x: number, y: number, blocks: string][]; // columns players changed (see BLOCK_CODE)
};

// A player account: their character, and where they were and what they carried when they left.
export type SavedPlayer = Character & {
  id: string; // the login account's id
  inventory: Record<string, number>;
  place?: { world: string; x: number; y: number; z: number }; // last position, and in which world
};

export interface Storage {
  readonly where: string; // for log messages
  load(id: string): Promise<SavedWorld | null>;
  save(id: string, world: SavedWorld): Promise<void>;
  loadPlayer(id: string): Promise<SavedPlayer | null>;
  savePlayer(player: SavedPlayer): Promise<void>;
  // Store a brand-new player. Returns false if the username is already taken (ignoring case).
  createPlayer(player: SavedPlayer): Promise<boolean>;
}

// One shared connection for the whole server, opened on first use.
let opened: Promise<Storage> | null = null;
export function getStorage(): Promise<Storage> {
  opened ??= (async () => {
    const url = process.env.DATABASE_URL;
    return url ? PostgresStorage.open(url) : new FileStorage(process.env.SAVE_DIR || 'save');
  })();
  return opened;
}

const safeName = (id: string) => id.replace(/[^\w-]/g, '_');

class FileStorage implements Storage {
  readonly where: string;
  constructor(private dir: string) {
    this.where = `files in ${path.resolve(dir)}`;
  }

  load(id: string) {
    return this.read<SavedWorld>(path.join(this.dir, `${safeName(id)}.json`));
  }

  save(id: string, world: SavedWorld) {
    return this.write(path.join(this.dir, `${safeName(id)}.json`), world);
  }

  loadPlayer(id: string) {
    return this.read<SavedPlayer>(this.playerFile(id));
  }

  savePlayer(player: SavedPlayer) {
    return this.write(this.playerFile(player.id), player);
  }

  async createPlayer(player: SavedPlayer) {
    // Fine for a handful of local test players; the database does this properly.
    const dir = path.join(this.dir, 'players');
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      const other = await this.read<SavedPlayer>(path.join(dir, f));
      if (other && other.id !== player.id && other.username.toLowerCase() === player.username.toLowerCase()) {
        return false;
      }
    }
    await this.savePlayer(player);
    return true;
  }

  private playerFile(id: string) {
    return path.join(this.dir, 'players', `${safeName(id)}.json`);
  }

  private async read<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async write(file: string, data: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write to a temporary file, then swap it in, so a crash mid-write can't corrupt the save.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  }
}

class PostgresStorage implements Storage {
  readonly where = 'the database (DATABASE_URL)';
  private constructor(private pool: pg.Pool) {}

  static async open(url: string) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    // Hosted databases require encrypted connections; a local one usually doesn't support them.
    const pool = new pg.Pool({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, max: 3 });
    await pool.query(
      `create table if not exists worlds (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )`,
    );
    await pool.query(
      `create table if not exists players (
        id text primary key,
        username text not null,
        data jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
    );
    await pool.query('create unique index if not exists players_username on players (lower(username))');
    return new PostgresStorage(pool);
  }

  async load(id: string) {
    const res = await this.pool.query('select data from worlds where id = $1', [id]);
    return (res.rows[0]?.data as SavedWorld | undefined) ?? null;
  }

  async save(id: string, world: SavedWorld) {
    await this.pool.query(
      `insert into worlds (id, data) values ($1, $2)
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      [id, JSON.stringify(world)],
    );
  }

  async loadPlayer(id: string) {
    const res = await this.pool.query('select data from players where id = $1', [id]);
    return (res.rows[0]?.data as SavedPlayer | undefined) ?? null;
  }

  async savePlayer(player: SavedPlayer) {
    await this.pool.query('update players set data = $2, updated_at = now() where id = $1', [
      player.id,
      JSON.stringify(player),
    ]);
  }

  async createPlayer(player: SavedPlayer) {
    try {
      await this.pool.query('insert into players (id, username, data) values ($1, $2, $3)', [
        player.id,
        player.username,
        JSON.stringify(player),
      ]);
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return false; // unique violation: name taken
      throw err;
    }
  }
}
