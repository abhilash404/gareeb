// Signing in (Google through Supabase, or a typed name in development) and talking to the server's API.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SERVER_PORT } from '../shared/protocol';

// Dev: Vite and the game server run on separate ports. Production: one server hosts both.
export const SERVER_URL = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${SERVER_PORT}` : location.origin;

export type LoginConfig = { supabaseUrl: string; supabaseAnonKey: string; devLogin: boolean };

let config: LoginConfig = { supabaseUrl: '', supabaseAnonKey: '', devLogin: false };
let supabase: SupabaseClient | null = null;

// Ask the server how sign-in is set up. Also completes a Google sign-in if we just came back from one.
export async function loadLoginConfig() {
  config = await (await fetch(`${SERVER_URL}/api/config`)).json();
  if (config.supabaseUrl) supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  return config;
}

// Proof of who we are, sent to the server; null if signed out.
// Dev logins are kept per tab, so two windows can be two different test players.
export async function currentToken(): Promise<string | null> {
  const dev = sessionStorage.getItem('devLogin');
  if (dev && config.devLogin) return `dev:${dev}`;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession(); // Supabase keeps this fresh by itself
  return data.session?.access_token ?? null;
}

// Goes to Google and comes back to this page signed in.
export function signInWithGoogle() {
  supabase?.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
}

export function devSignIn(name: string) {
  sessionStorage.setItem('devLogin', name);
}

export async function signOut() {
  sessionStorage.removeItem('devLogin');
  await supabase?.auth.signOut();
  location.reload();
}

// Call the server's API as the signed-in player.
export async function api<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const token = await currentToken();
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}
