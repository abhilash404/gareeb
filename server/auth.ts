// Who is this? Turns a login token from the browser into an account id.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// From the Supabase dashboard (Project Settings -> API). Both are safe to show to browsers.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

// `npm run dev` starts the server with --dev, which allows "dev:<name>" tokens: log in by just
// typing a name, to test several players on one computer. `npm start` (production) never allows it.
export const DEV_LOGIN = process.argv.includes('--dev');

let supabase: SupabaseClient | null = null;

// The account id for a token, or null if it isn't a valid login.
export async function accountOf(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token) return null;
  if (token.startsWith('dev:')) {
    const name = token.slice(4);
    return DEV_LOGIN && /^[A-Za-z0-9_]{1,32}$/.test(name) ? `dev-${name}` : null;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  // Supabase checks the token is genuine, unexpired and belongs to a real user.
  supabase ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}
