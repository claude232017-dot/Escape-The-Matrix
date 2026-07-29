import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, created lazily.
 *
 * Lazy on purpose: the Phase 0 shell must render on a deployment that has no keys
 * configured yet, and a module-level `createClient` would throw during import and blank
 * the page. Nothing calls this until Phase 1.
 *
 * On the anon key: it is public, it ships in the bundle, and that is fine. It is an
 * identifier, not a secret. Everything it is allowed to do is decided by RLS policies
 * in the database — see docs/SECURITY.md. Any rule enforced only in this file is
 * decoration.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export class MissingSupabaseConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Supabase is not configured: missing ${missing.join(', ')}. Copy .env.example to .env.local and fill it in.`,
    );
    this.name = 'MissingSupabaseConfigError';
  }
}

export function readSupabaseEnv(
  source: Record<string, string | undefined> = import.meta.env as unknown as Record<
    string,
    string | undefined
  >,
): SupabaseEnv | null {
  const url = source['VITE_SUPABASE_URL'];
  const anonKey = source['VITE_SUPABASE_ANON_KEY'];
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const env = readSupabaseEnv();
  if (!env) {
    const source = import.meta.env as unknown as Record<string, string | undefined>;
    const missing = [
      source['VITE_SUPABASE_URL'] ? null : 'VITE_SUPABASE_URL',
      source['VITE_SUPABASE_ANON_KEY'] ? null : 'VITE_SUPABASE_ANON_KEY',
    ].filter((v): v is string => v !== null);
    throw new MissingSupabaseConfigError(missing);
  }

  cached = createClient(env.url, env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // A recovery link must not become a standing credential. The session it creates is
      // detected explicitly and held on a reset screen — see §3.7 of the build spec and
      // the Phase 1 auth feature. Detection stays on because the token arrives in the
      // URL; what changes is that the app refuses to route past the reset view.
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return cached;
}

/** Drops the memoised client. Used by sign-out and by tests. */
export function resetSupabaseClient(): void {
  cached = null;
}
