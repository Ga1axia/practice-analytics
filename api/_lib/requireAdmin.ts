import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { envStr } from './bqe.js';

export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ userId: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }
  const accessToken = authHeader.slice(7);
  const url = envStr('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const anon = envStr('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    res.status(500).json({ error: 'Supabase env not configured.' });
    return null;
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return null;
  }

  const { data: profile } = await supabase
    .from('pa_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'admin') {
    res.status(403).json({ error: 'Admin only.' });
    return null;
  }

  return { userId: userData.user.id };
}
