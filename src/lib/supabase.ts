import { createClient } from '@supabase/supabase-js';

function envVar(...keys: string[]): string | undefined {
  const viteEnv =
    typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as ImportMetaEnv);
  for (const key of keys) {
    const fromVite = viteEnv[key as keyof ImportMetaEnv];
    if (fromVite) return String(fromVite);
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env;
    const fromNode = proc?.[key];
    if (fromNode) return String(fromNode);
  }
  return undefined;
}

const url = envVar('VITE_SUPABASE_URL', 'SUPABASE_URL');
const anon = envVar('VITE_SUPABASE_ANON_KEY');

if (!url || !anon) {
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — dashboard data will not load until .env.local is set.',
  );
}

export const supabase = createClient(url || 'http://localhost', anon || 'missing', {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
