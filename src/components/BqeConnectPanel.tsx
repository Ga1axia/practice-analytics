import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useDashboard } from '../hooks/useDashboard';
import { authHeaders } from '../lib/authToken';

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

/** Inclusive UTC day windows covering the last `monthsBack` months. */
function dayWindows(
  monthsBack: number,
  chunkDays: number,
): { since: string; until: string; label: string }[] {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out: { since: string; until: string; label: string }[] = [];
  const cur = new Date(start);
  while (cur.getTime() <= last.getTime()) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd.getTime() > last.getTime()) chunkEnd.setTime(last.getTime());
    out.push({
      since: ymd(cur),
      until: ymd(chunkEnd),
      label: `${ymd(cur)}–${ymd(chunkEnd)}`,
    });
    cur.setUTCDate(cur.getUTCDate() + chunkDays);
  }
  return out;
}

async function readApiJson<T>(res: Response): Promise<T> {
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

async function postSync<T>(
  body: Record<string, unknown>,
  timeoutMs = 180_000,
): Promise<T & { error?: string; detail?: string; message?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/bqe/sync', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const parsed = await readApiJson<T & { error?: string; detail?: string; message?: string }>(res);
    if (!res.ok) throw new Error(apiErrorMessage(parsed, 'Sync step failed'));
    return parsed;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(
        'That sync step timed out after 3 minutes. Refresh the page to cancel the old request, then retry. Use Incremental time entries instead of a full CORE dump.',
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function apiErrorMessage(body: { error?: string; detail?: string }, fallback: string): string {
  const err = body.error || '';
  if (/invalid or expired session/i.test(err) || /auth session missing/i.test(err + (body.detail || ''))) {
    return 'Your session expired. Sign out and sign back in, then retry.';
  }
  if (body.error && body.detail) return `${body.error} ${body.detail}`;
  return body.error || body.detail || fallback;
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
  const { session, loading: authLoading } = useAuth();
  const onVercel = isVercelHost();
  const [status, setStatus] = useState<BqeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false);
      setStatus(null);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/bqe/status', { headers: await authHeaders() });
      const body = await readApiJson<BqeStatus>(res);
      if (!res.ok) throw new Error(apiErrorMessage(body, 'Failed to load BQE status'));
      setStatus(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load BQE status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (authLoading) return;
    void refreshStatus();
  }, [authLoading, refreshStatus]);

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
      const body = await readApiJson<{ authorizeUrl?: string; error?: string; detail?: string }>(res);
      if (!res.ok || !body.authorizeUrl) {
        throw new Error(apiErrorMessage(body, 'Could not start BQE connect'));
      }
      window.location.href = body.authorizeUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Connect failed');
      setBusy(false);
    }
  }

  /** Incremental time (local), then paged CORE projects. On Vercel, projects only — Hobby ~10s. */
  async function sync() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const teCount = status?.timeEntryCount ?? 0;
      let teFetched = 0;
      if (!onVercel) {
        if (teCount < 1) {
          const months = dayWindows(36, 30);
          for (let i = 0; i < months.length; i += 1) {
            const m = months[i]!;
            setMsg(`Step 1 — historical time ${m.label} (${i + 1}/${months.length})…`);
            const tBody = await postSync<{ fetched?: number }>({
              mode: 'historical',
              since: m.since,
              until: m.until,
            });
            teFetched += tBody.fetched || 0;
          }
        } else {
          setMsg('Step 1 — incremental time entries…');
          const tBody = await postSync<{ fetched?: number; message?: string }>({
            mode: 'incremental',
          });
          teFetched = tBody.fetched || 0;
        }
      }

      let page = 1;
      let totalProjects = 0;
      for (;;) {
        setMsg(`Projects page ${page}…`);
        const pBody = await postSync<{
          hasMore?: boolean;
          insertedProjects?: number;
          message?: string;
        }>({
          mode: 'projects',
          page,
          pageSize: 80,
          reset: page === 1,
          requireRecentHours: false,
        });
        totalProjects += pBody.insertedProjects || 0;
        if (!pBody.hasMore) break;
        page += 1;
        if (page > 120) break;
      }

      setMsg(
        `Sync complete: ${teFetched} time rows this run · ${totalProjects} project rows written. Dashboard is refreshing…`,
      );
      await refreshStatus();
      await reload();
      setMsg(
        `Sync complete: ${teFetched} time rows this run · ${totalProjects} project rows written (CORE status and billing type).`,
      );
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
        const windows = dayWindows(36, 7);
        let fetched = 0;
        let inserted = 0;
        let updated = 0;
        for (let i = 0; i < windows.length; i += 1) {
          const m = windows[i]!;
          let page = 1;
          for (;;) {
            setMsg(`Historical ${m.label} p${page} (${i + 1}/${windows.length})…`);
            const body = await postSync<{
              fetched?: number;
              inserted?: number;
              updated?: number;
              hasMore?: boolean;
            }>({
              mode: 'historical',
              since: m.since,
              until: m.until,
              page,
              pageSize: 80,
            });
            fetched += body.fetched || 0;
            inserted += body.inserted || 0;
            updated += body.updated || 0;
            if (!body.hasMore) break;
            page += 1;
            if (page > 30) break;
          }
        }
        setMsg(
          `Historical import done: fetched ${fetched}, inserted ${inserted}, updated ${updated} across ${windows.length} windows.`,
        );
      } else if (mode === 'incremental' && onVercel) {
        let page = 1;
        let fetched = 0;
        let inserted = 0;
        let updated = 0;
        for (;;) {
          setMsg(`Incremental time page ${page}…`);
          const body = await postSync<{
            fetched?: number;
            inserted?: number;
            updated?: number;
            hasMore?: boolean;
            message?: string;
          }>({
            mode: 'incremental',
            page,
            pageSize: 80,
          });
          fetched += body.fetched || 0;
          inserted += body.inserted || 0;
          updated += body.updated || 0;
          if (!body.hasMore) break;
          page += 1;
          if (page > 40) break;
        }
        setMsg(
          `Incremental time done: fetched ${fetched}, inserted ${inserted}, updated ${updated}.`,
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
            Production sync copies the CORE project list (status and hourly/fixed on every
            phase). It does not re-import 96k time rows. Hobby functions die after ~10s —
            Incremental time is a separate paged button. Set{' '}
            <span className="mono">BQE_REDIRECT_URI</span> / <span className="mono">BQE_APP_ORIGIN</span>{' '}
            to this site URL in Vercel env, and register the same callback in the BQE Developer Portal.
          </>
        ) : (
          <>
            Connect with a CORE admin login, then sync. Locally also run{' '}
            <span className="mono">npm run dev:api</span>. Sync shows step progress (time, then
            project pages) instead of one long “Working…” wait.
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
