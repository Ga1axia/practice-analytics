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
        'API crashed (often a timeout on a long CORE sync, or missing env on Vercel). Locally: run npm run dev:api in a second terminal and use http://localhost:5173 — not the Vercel URL. Check CORE_CLIENT_* + SUPABASE_SERVICE_ROLE_KEY in .env.local.',
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
      setMsg('Connected to BQE CORE. Click Sync from CORE to pull projects, time, and invoices.');
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

  async function sync() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/api/bqe/sync', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ includeTimeEntries: true }),
      });
      const body = await readApiJson<{ message?: string; error?: string }>(res);
      if (!res.ok) throw new Error(body.error || 'Sync failed');
      setMsg(body.message || 'Sync complete.');
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
        Connect with a CORE admin login, then sync. Sync pulls projects, time entries, employees, and
        invoices when your CORE subscription includes them (last 36 months). Requires{' '}
        <span className="mono">npm run dev:api</span> locally.
      </p>

      {loading ? <p className="plist-upload-help">Checking connection…</p> : null}

      {!loading && status ? (
        <div className="plist-upload-help" style={{ marginBottom: 10 }}>
          <div>
            Env: {status.configured ? 'ready' : `missing ${missing.join(', ') || 'config'}`}
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
