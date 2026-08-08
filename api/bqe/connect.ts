import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BQE_IDENTITY_BASE, BQE_SCOPES, requireBqeConfig } from '../_lib/bqe';
import { requireAdmin } from '../_lib/requireAdmin';

/**
 * Start BQE CORE OAuth (Authorization Code).
 * Admin-only. Redirects browser to CORE identity login/consent.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const { clientId, redirectUri } = requireBqeConfig();
    const state = Buffer.from(
      JSON.stringify({ n: Math.random().toString(36).slice(2), u: admin.userId }),
    ).toString('base64url');

    // Persist state briefly via cookie for CSRF check on callback
    const secure =
      process.env.NODE_ENV === 'production' ||
      (process.env.BQE_APP_ORIGIN || '').startsWith('https://');
    res.setHeader(
      'Set-Cookie',
      `bqe_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`,
    );

    const url = new URL(`${BQE_IDENTITY_BASE}/connect/authorize`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', BQE_SCOPES);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    res.status(200).json({ authorizeUrl: url.toString() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'BQE connect failed' });
  }
}
