import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useDashboard } from '../hooks/useDashboard';

type BqeStatus = {
  configured: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasRedirectUri: boolean;
  hasServiceRole?: boolean;
  connected: boolean;
  apiEndpoint: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  lastTimeEntrySyncAt?: string | null;
  lastTimeEntrySyncStatus?: string | null;
  timeEntryCount?: number | null;
  expiresAt: string | null;
  error?: string;
};

function isVercelHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1';
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Last N calendar months as [since, until] inclusive UTC ranges. */
function lastNMonthWindows(n: number): { since: string; until: string; label: string }[] {
  const out: { since: string; until: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    out.push({
      since: ymd(start),
      until: ymd(end),
      label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
    });
  }
  return out;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Parse JSON when possible; surface plain-text server crashes (e.g. Vercel). */
async function readApiJson<T extends { error?: string }>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new Error(res.ok ? 'Empty response from API' : `Request failed (${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 280);
    if (/A server error has occurred/i.test(snippet)) {
      throw new Error(
        'Vercel timed out (Hobby ~10s). Sync now runs in small steps — retry Sync from CORE. Or upgrade to Pro for longer functions. Ensure CORE_* + SUPABASE_SERVICE_ROLE_KEY are set in Vercel Project → Settings → Environment Variables.',
      );
    }
    if (/ECONNREFUSED|Local API is not running/i.test(snippet)) {
      throw new Error('Local API is not running. Start it with: npm run dev:api');
    }
    if (res.status === 502 || /Local API is not running on :8787/i.test(snippet)) {
      throw new Error(
        'Local API is not running on :8787. Open a second terminal and run: npm run dev:api',
      );
    }
    throw new Error(`API returned non-JSON (${res.status}): ${snippet}`);
  }
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function BqeConnectPanel() {
  const { reload } = useDashboard();
  const onVercel = isVercelHost();
  const [status, setStatus] = useState<BqeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/bqe/status', { headers: await authHeaders() });
      const body = await readApiJson<BqeStatus>(res);
      if (!res.ok) throw new Error(body.error || 'Failed to load BQE status');
      setStatus(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load BQE status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bqe = params.get('bqe');
    if (!bqe) return;
    if (bqe === 'connected') {
      setMsg('Connected to BQE CORE. Click Sync from CORE to pull data.');
      void refreshStatus();
    } else if (bqe === 'denied') {
      setErr(`BQE authorization declined: ${params.get('error') || 'denied'}`);
    } else if (bqe === 'error') {
      setErr(`BQE connection failed: ${params.get('error') || 'unknown error'}`);
    }
    params.delete('bqe');
    params.delete('error');
    const next = params.toString();
    const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', url);
  }, [refreshStatus]);

  async function connect() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/bqe/connect', { headers: await authHeaders() });
      const body = await readApiJson<{ authorizeUrl?: string; error?: string }>(res);
      if (!res.ok || !body.authorizeUrl) {
        throw new Error(body.error || 'Could not start BQE connect');
      }
      window.location.href = body.authorizeUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Connect failed');
      setBusy(false);
    }
  }

  /** Production: projects → recent months TE → short aggregates. Local: one full sync. */
  async function sync() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      if (onVercel) {
        // Hobby ~10s: page projects (100/req), then TE by month (no project crawl), skip heavy aggregates
        const projectWhere = 'status = 4'; // Active only — cuts payload vs full 5k tree
        let page = 1;
        let totalProjects = 0;
        for (;;) {
          setMsg(`Step 1 — projects page ${page}…`);
          const pRes = await fetch('/api/bqe/sync', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({
              mode: 'projects',
              page,
              pageSize: 80,
              reset: page === 1,
              projectWhere,
            }),
          });
          const pBody = await readApiJson<{
            message?: string;
            error?: string;
            hasMore?: boolean;
            insertedProjects?: number;
          }>(pRes);
          if (!pRes.ok) throw new Error(pBody.error || `Projects page ${page} failed`);
          totalProjects += pBody.insertedProjects || 0;
          if (!pBody.hasMore) break;
          page += 1;
          if (page > 80) break;
        }

        const months = lastNMonthWindows(3);
        let teFetched = 0;
        for (let i = 0; i < months.length; i += 1) {
          const m = months[i]!;
          setMsg(`Step 2 — time ${m.label} (${i + 1}/${months.length})…`);
          const tRes = await fetch('/api/bqe/sync', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ mode: 'historical', since: m.since, until: m.until }),
          });
          const tBody = await readApiJson<{
            message?: string;
            error?: string;
            fetched?: number;
          }>(tRes);
          if (!tRes.ok) throw new Error(tBody.error || `Time sync failed for ${m.label}`);
          teFetched += tBody.fetched || 0;
        }

        setMsg(
          `Vercel sync complete: ${totalProjects} project rows · ~${teFetched} time entries (3 months). Run local full sync for 36‑month analytics if needed.`,
        );
      } else {
        const res = await fetch('/api/bqe/sync', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ includeTimeEntries: true }),
        });
        const body = await readApiJson<{ message?: string; error?: string }>(res);
        if (!res.ok) throw new Error(body.error || 'Sync failed');
        setMsg(body.message || 'Sync complete.');
      }
      await refreshStatus();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function syncTimeEntries(mode: 'historical' | 'incremental') {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      if (mode === 'historical' && onVercel) {
        // 36 months one-by-one so each request stays under Hobby timeout
        const months = lastNMonthWindows(36);
        let fetched = 0;
        let inserted = 0;
        let updated = 0;
        for (let i = 0; i < months.length; i += 1) {
          const m = months[i]!;
          setMsg(`Historical ${m.label} (${i + 1}/${months.length})…`);
          const res = await fetch('/api/bqe/sync', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ mode: 'historical', since: m.since, until: m.until }),
          });
          const body = await readApiJson<{
            message?: string;
            error?: string;
            fetched?: number;
            inserted?: number;
            updated?: number;
          }>(res);
          if (!res.ok) throw new Error(body.error || `Failed ${m.label}`);
          fetched += body.fetched || 0;
          inserted += body.inserted || 0;
          updated += body.updated || 0;
        }
        setMsg(
          `Historical import done: fetched ${fetched}, inserted ${inserted}, updated ${updated} across ${months.length} months.`,
        );
      } else {
        const res = await fetch('/api/bqe/sync', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ mode }),
        });
        const body = await readApiJson<{
          message?: string;
          error?: string;
          fetched?: number;
          inserted?: number;
          updated?: number;
        }>(res);
        if (!res.ok) throw new Error(body.error || 'Time entry sync failed');
        setMsg(
          body.message ||
            `Time entries: fetched ${body.fetched ?? 0}, inserted ${body.inserted ?? 0}, updated ${body.updated ?? 0}`,
        );
      }
      await refreshStatus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Time entry sync failed');
    } finally {
      setBusy(false);
    }
  }

  const missing: string[] = [];
  if (status && !status.hasClientId) missing.push('CORE_CLIENT_ID');
  if (status && !status.hasClientSecret) missing.push('CORE_CLIENT_SECRET');
  if (status && !status.hasRedirectUri) missing.push('BQE_REDIRECT_URI');
  if (status && status.hasServiceRole === false) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  return (
    <div className="panel plist-upload">
      <h3>
        BQE CORE live data
        <span className="tag">Projects · Time · Invoices · Employees</span>
      </h3>
      <p className="plist-upload-help">
        {onVercel ? (
          <>
            Production sync runs in small steps (projects → recent months of time → analytics) so
            Vercel Hobby does not time out. Set{' '}
            <span className="mono">BQE_REDIRECT_URI</span> / <span className="mono">BQE_APP_ORIGIN</span>{' '}
            to this site URL in Vercel env, and register the same callback in the BQE Developer Portal.
          </>
        ) : (
          <>
            Connect with a CORE admin login, then sync. Locally also run{' '}
            <span className="mono">npm run dev:api</span>.
          </>
        )}
      </p>

      {loading ? <p className="plist-upload-help">Checking connection…</p> : null}

      {!loading && status ? (
        <div className="plist-upload-help" style={{ marginBottom: 10 }}>
          <div>
            Env: {status.configured ? 'ready' : `missing ${missing.join(', ') || 'config'}`}
            {onVercel ? ' · host: Vercel' : ' · host: local'}
          </div>
          <div>
            Status:{' '}
            {status.connected
              ? `connected${status.apiEndpoint ? ` · ${status.apiEndpoint}` : ''}`
              : 'not connected'}
          </div>
          {status.connected ? (
            <>
              <div>Connected: {fmtWhen(status.connectedAt)}</div>
              <div>
                Last sync: {fmtWhen(status.lastSyncAt)}
                {status.lastSyncStatus ? ` (${status.lastSyncStatus})` : ''}
              </div>
              {status.lastSyncMessage ? <div>{status.lastSyncMessage}</div> : null}
              <div>
                Time entries: {status.timeEntryCount ?? '—'} stored · last import{' '}
                {fmtWhen(status.lastTimeEntrySyncAt ?? null)}
                {status.lastTimeEntrySyncStatus ? ` (${status.lastTimeEntrySyncStatus})` : ''}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="plist-upload-row">
        <button
          type="button"
          className="plist-upload-btn"
          disabled={busy || (!!status && !status.configured)}
          onClick={() => void connect()}
        >
          {busy ? 'Working…' : status?.connected ? 'Reconnect CORE' : 'Connect to BQE CORE'}
        </button>
        <button
          type="button"
          className="plist-upload-btn"
          disabled={busy || !status?.connected}
          onClick={() => void sync()}
          style={{ marginLeft: 8 }}
        >
          {busy ? 'Working…' : 'Sync from CORE'}
        </button>
        <button
          type="button"
          className="plist-upload-btn"
          disabled={busy || !status?.connected}
          onClick={() => void syncTimeEntries('historical')}
          style={{ marginLeft: 8 }}
        >
          Import historical time entries
        </button>
        <button
          type="button"
          className="plist-upload-btn"
          disabled={busy || !status?.connected}
          onClick={() => void syncTimeEntries('incremental')}
          style={{ marginLeft: 8 }}
        >
          Incremental time entries
        </button>
      </div>

      {msg ? <p className="plist-upload-ok">{msg}</p> : null}
      {err ? <p className="plist-upload-err">{err}</p> : null}
    </div>
  );
}
