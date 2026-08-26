import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { envStr } from './bqe.js';

function bearerFromReq(req: VercelRequest): string | null {
  const raw = req.headers.authorization ?? req.headers.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ userId: string } | null> {
  const accessToken = bearerFromReq(req);
  if (!accessToken) {
    res.status(401).json({
      error: 'Sign in required.',
      detail: 'Missing Authorization Bearer token. Sign out and sign back in, then retry.',
    });
    return null;
  }

  const url = envStr('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const anon = envStr('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    res.status(500).json({
      error: 'Supabase env not configured.',
      detail: 'Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_*) on the Vercel project.',
    });
    return null;
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) {
    res.status(401).json({
      error: 'Invalid or expired session.',
      detail: userErr?.message || 'getUser failed — refresh the page and sign in again.',
    });
    return null;
  }

  const { data: profile, error: profileErr } = await supabase
    .from('pa_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileErr) {
    res.status(500).json({ error: `Profile lookup failed: ${profileErr.message}` });
    return null;
  }

  if (!profile || profile.role !== 'admin') {
    res.status(403).json({
      error: 'Admin only.',
      detail: profile
        ? `Your role is "${profile.role}". BQE connect requires pa_profiles.role = admin (dashboard admin).`
        : 'No pa_profiles row for this user.',
    });
    return null;
  }

  return { userId: userData.user.id };
}
