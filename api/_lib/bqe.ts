import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const BQE_IDENTITY_BASE =
  process.env.BQE_IDENTITY_BASE_URL || 'https://api-identity.bqecore.com/idp';

export const BQE_SCOPES =
  process.env.BQE_SCOPES || 'read:core offline_access openid';

export type BqeTokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  endpoint?: string;
};

export type BqeConnection = {
  access_token: string;
  refresh_token: string | null;
  token_type: string | null;
  expires_at: string | null;
  scope: string | null;
  api_endpoint: string;
  connected_at: string;
  updated_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
};

export function envStr(...keys: string[]): string {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw == null) continue;
    const v = String(raw).trim().replace(/^["']|["']$/g, '');
    if (v) return v;
  }
  return '';
}

export function hasServiceRole(): boolean {
  return !!(envStr('SUPABASE_URL', 'VITE_SUPABASE_URL') && envStr('SUPABASE_SERVICE_ROLE_KEY'));
}

export function bqeConfig() {
  return {
    clientId: envStr('CORE_CLIENT_ID', 'BQE_CLIENT_ID'),
    clientSecret: envStr('CORE_CLIENT_SECRET', 'BQE_CLIENT_SECRET'),
    redirectUri: envStr('BQE_REDIRECT_URI', 'CORE_REDIRECT_URI'),
  };
}

export function requireBqeConfig() {
  const cfg = bqeConfig();
  if (!cfg.clientId) {
    throw new Error('Missing CORE_CLIENT_ID (from BQE Developer Portal → App Details).');
  }
  if (!cfg.clientSecret) {
    throw new Error('Missing CORE_CLIENT_SECRET in server env.');
  }
  if (!cfg.redirectUri) {
    throw new Error(
      'Missing BQE_REDIRECT_URI (must exactly match a Redirect URI registered in the Developer Portal).',
    );
  }
  return cfg;
}

export function serviceSupabase(): SupabaseClient {
  const url = envStr('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = envStr('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    const missing = [
      !url ? 'SUPABASE_URL' : null,
      !key ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean);
    throw new Error(
      `${missing.join(' and ')} required for BQE sync. ` +
        `Set in .env.local (no empty duplicate lines) and restart npm run dev:api.`,
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function exchangeCodeForTokens(code: string): Promise<BqeTokenResponse> {
  const { clientId, clientSecret, redirectUri } = requireBqeConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${BQE_IDENTITY_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BQE token exchange failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as BqeTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<BqeTokenResponse> {
  const { clientId, clientSecret } = requireBqeConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${BQE_IDENTITY_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BQE token refresh failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as BqeTokenResponse;
}

export async function saveConnection(
  tokens: BqeTokenResponse,
  opts?: { markConnected?: boolean },
) {
  if (!tokens.access_token) throw new Error('BQE token response missing access_token');
  let endpoint = (tokens.endpoint || '').trim();
  if (!endpoint) throw new Error('BQE token response missing endpoint (API base URL)');
  if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const row: Record<string, unknown> = {
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    token_type: tokens.token_type || 'Bearer',
    expires_at: expiresAt,
    scope: tokens.scope || null,
    api_endpoint: endpoint,
    updated_at: new Date().toISOString(),
  };
  if (opts?.markConnected !== false) {
    // Default true for OAuth callback; refresh path passes markConnected: false
    row.connected_at = new Date().toISOString();
  }

  const sb = serviceSupabase();
  const { error } = await sb.from('pa_bqe_connection').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`Failed to store BQE tokens: ${error.message}`);
}

export async function loadConnection(): Promise<BqeConnection | null> {
  const sb = serviceSupabase();
  const { data, error } = await sb.from('pa_bqe_connection').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BqeConnection | null) || null;
}

export async function getValidAccessToken(): Promise<{
  accessToken: string;
  endpoint: string;
}> {
  const conn = await loadConnection();
  if (!conn) throw new Error('BQE CORE is not connected. Connect from Executive first.');

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  const stale = !expiresAt || expiresAt < Date.now() + 60_000;

  if (!stale) {
    return { accessToken: conn.access_token, endpoint: conn.api_endpoint };
  }
  if (!conn.refresh_token) {
    throw new Error('BQE access token expired and no refresh token is available. Reconnect.');
  }

  const tokens = await refreshAccessToken(conn.refresh_token);
  // Keep prior refresh/endpoint if omitted
  await saveConnection(
    {
      ...tokens,
      refresh_token: tokens.refresh_token || conn.refresh_token,
      endpoint: tokens.endpoint || conn.api_endpoint,
    },
    { markConnected: false },
  );
  return {
    accessToken: tokens.access_token,
    endpoint: (tokens.endpoint || conn.api_endpoint).replace(/\/$/, ''),
  };
}

export async function bqeGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const { accessToken, endpoint } = await getValidAccessToken();
  const url = new URL(endpoint + (path.startsWith('/') ? path : `/${path}`));
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BQE GET ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!text || res.status === 204) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `BQE GET ${path} returned non-JSON (${res.status}): ${text.slice(0, 300)}`,
    );
  }
}

function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['value', 'data', 'items', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

/** Paginate a CORE list endpoint (page = "n,size"). */
export async function bqeListAll<T>(
  path: string,
  pageSize = 100,
  query?: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  // Expand forces max 100/page per CORE docs
  const size = query?.expand ? Math.min(pageSize, 100) : pageSize;
  for (;;) {
    const payload = await bqeGet<unknown>(path, {
      ...(query || {}),
      page: `${page},${size}`,
    });
    const batch = asList<T>(payload);
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < size) break;
    page += 1;
    if (page > 500) break; // safety
  }
  return out;
}

/** ISO date (YYYY-MM-DD) for CORE where filters — lookback months from today. */
export function bqeSinceDate(monthsBack = 36): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type BqeProject = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  code?: string | null;
  client?: string | null;
  clientId?: string | null;
  manager?: string | null;
  managerId?: string | null;
  status?: string | number | null;
  contractType?: string | number | null;
  contractAmount?: number | null;
  serviceContract?: number | null;
  expenseContract?: number | null;
  phaseName?: string | null;
  phaseDescription?: string | null;
  parent?: string | null;
  parentId?: string | null;
  rootProject?: string | null;
  rootProjectId?: string | null;
  hasChild?: boolean | null;
  address?: { city?: string | null }[] | null;
  percentComplete?: number | null;
};

export type BqeTimeEntry = {
  id?: string;
  date?: string | null;
  projectId?: string | null;
  resourceId?: string | null;
  resource?: string | null;
  actualHours?: number | null;
  billable?: boolean | null;
  billRate?: number | null;
  costRate?: number | null;
  isWrittenOff?: boolean | null;
};

export type BqeInvoiceDetail = {
  id?: string;
  projectId?: string | null;
  rootProjectId?: string | null;
  clientId?: string | null;
  client?: string | null;
  project?: string | null;
  amount?: number | null;
};

export type BqeInvoice = {
  id?: string;
  date?: string | null;
  invoiceAmount?: number | null;
  balance?: number | null;
  isDraft?: boolean | null;
  isVoid?: boolean | null;
  invoiceDetails?: BqeInvoiceDetail[] | null;
};

export type BqeEmployee = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  status?: string | number | null;
  department?: string | null;
  title?: string | null;
};

export function mapBqeStatus(status: string | number | null | undefined): string {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('complete') || s === '2') return 'COMPLETED';
  if (s.includes('inactive') || s.includes('hold') || s === '1') return 'INACTIVE';
  if (s.includes('cancel')) return 'CANCELED';
  return 'ACTIVE';
}

export function mapBqeContractType(t: string | number | null | undefined): string | null {
  const s = String(t ?? '');
  if (!s) return null;
  if (/fixed/i.test(s) || s === '0') return 'FIXED';
  if (/hour/i.test(s) || s === '1') return 'HOURLY';
  return s.toUpperCase();
}
