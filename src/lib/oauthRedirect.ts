/** Where Microsoft OAuth should return after Azure consent. */
export function oauthRedirectTo(
  origin = typeof window !== 'undefined' ? window.location.origin : '',
  pathname = typeof window !== 'undefined' ? window.location.pathname : '/',
): string {
  if (pathname === '/demo' || pathname.startsWith('/demo/')) return `${origin}/demo`;
  return origin || '/';
}

export function oauthErrorFromSearch(search = typeof window !== 'undefined' ? window.location.search : ''): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('error_description') || params.get('error');
  if (!raw) return null;
  return raw.replace(/\+/g, ' ');
}
