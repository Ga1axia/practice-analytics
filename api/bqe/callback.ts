import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exchangeCodeForTokens, saveConnection } from '../_lib/bqe.js';

/**
 * OAuth redirect target. Exchanges ?code= for tokens and stores them.
 * Registered Redirect URI must match this path exactly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const err = String(req.query.error || '');

  const appOrigin =
    process.env.BQE_APP_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:5173');

  const secure = process.env.NODE_ENV === 'production' || appOrigin.startsWith('https://');
  const clearCookie = `bqe_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

  if (err) {
    res.setHeader('Set-Cookie', clearCookie);
    res.redirect(302, `${appOrigin}/?sheet=exec&bqe=denied&error=${encodeURIComponent(err)}`);
    return;
  }

  const cookie = String(req.headers.cookie || '');
  const match = cookie.match(/(?:^|;\s*)bqe_oauth_state=([^;]+)/);
  const expected = match?.[1] ? decodeURIComponent(match[1]) : '';
  if (!code || !state || !expected || state !== expected) {
    res.setHeader('Set-Cookie', clearCookie);
    res.redirect(302, `${appOrigin}/?sheet=exec&bqe=error&error=invalid_state`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(tokens);
    res.setHeader('Set-Cookie', clearCookie);
    res.redirect(302, `${appOrigin}/?sheet=exec&bqe=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'token_exchange_failed';
    res.setHeader('Set-Cookie', clearCookie);
    res.redirect(302, `${appOrigin}/?sheet=exec&bqe=error&error=${encodeURIComponent(msg)}`);
  }
}
