/** Refresh when the JWT expires within this window. */
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

export function accessTokenNeedsRefresh(
  expiresAtSec: number | undefined | null,
  nowMs = Date.now(),
): boolean {
  if (!expiresAtSec) return true;
  return expiresAtSec * 1000 < nowMs + ACCESS_TOKEN_REFRESH_SKEW_MS;
}
