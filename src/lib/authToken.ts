import { supabase } from './supabase';
import { accessTokenNeedsRefresh } from './authTokenExpiry';

let refreshInFlight: Promise<string | null> | null = null;

export { accessTokenNeedsRefresh } from './authTokenExpiry';

/**
 * Access token for /api/* calls.
 * Does not call refreshSession unless the JWT is actually expiring — a blind
 * refresh on every mount races in React Strict Mode and 400s /auth/v1/token
 * with "Auth session missing!".
 */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token) {
    throw new Error('Not signed in. Sign in as admin, then retry.');
  }
  if (!accessTokenNeedsRefresh(session.expires_at)) {
    return session.access_token;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (refreshed.session?.access_token) return refreshed.session.access_token;

      const { data: again } = await supabase.auth.getSession();
      if (
        again.session?.access_token &&
        !accessTokenNeedsRefresh(again.session.expires_at)
      ) {
        return again.session.access_token;
      }

      if (error && /session missing|invalid.*refresh|refresh token/i.test(error.message)) {
        await supabase.auth.signOut();
      }
      return null;
    })().finally(() => {
      refreshInFlight = null;
    });
  }

  const token = await refreshInFlight;
  if (!token) {
    throw new Error('Your session expired. Sign in again, then retry.');
  }
  return token;
}

export async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}
