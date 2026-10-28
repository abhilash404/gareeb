// Saving and loading worlds: the seed plus everything players changed.
// With DATABASE_URL set (any Postgres, e.g. a free Supabase or Neon database), worlds are kept
// in the database, which survives restarts on hosts like Render whose disk is wiped.
// Without it, they're saved as files in save/ — fine when running on your own computer.
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export type SavedWorld = {
  version: 1;
  seed: number;
  props: [x: number, y: number, hp: number][]; // trees/rocks players hit (hp 0 = gone)
  columns: [x: number, y: number, blocks: string][]; // columns players changed (see BLOCK_CODE)
};

export interface Storage {
  readonly where: string; // for log messages
  load(id: string): Promise<SavedWorld | null>;
  save(id: string, world: SavedWorld): Promise<void>;
}

export async function openStorage(): Promise<Storage> {
  const url = process.env.DATABASE_URL;
  return url ? PostgresStorage.open(url) : new FileStorage(process.env.SAVE_DIR || 'save');
}

class FileStorage implements Storage {
  readonly where: string;
  constructor(private dir: string) {
    this.where = `files in ${path.resolve(dir)}`;
  }

  async load(id: string) {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as SavedWorld;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(id: string, world: SavedWorld) {
    await fs.mkdir(this.dir, { recursive: true });
    // Write to a temporary file, then swap it in, so a crash mid-write can't corrupt the save.
    const tmp = `${this.file(id)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(world));
    await fs.rename(tmp, this.file(id));
  }

  private file(id: string) {
    return path.join(this.dir, `${id.replace(/[^\w-]/g, '_')}.json`);
  }
}

class PostgresStorage implements Storage {
  readonly where = 'the database (DATABASE_URL)';
  private constructor(private pool: pg.Pool) {}

  static async open(url: string) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    // Hosted databases require encrypted connections; a local one usually doesn't support them.
    const pool = new pg.Pool({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, max: 2 });
    await pool.query(
      `create table if not exists worlds (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )`,
    );
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
}
