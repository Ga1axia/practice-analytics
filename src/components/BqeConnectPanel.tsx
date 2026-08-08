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
      const body = (await res.json()) as BqeStatus;
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
      setMsg('Connected to BQE CORE. Click Sync projects to pull live data.');
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
      const body = (await res.json()) as { authorizeUrl?: string; error?: string };
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
      });
      const body = (await res.json()) as { message?: string; error?: string };
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

  const missing: string[] = [];
  if (status && !status.hasClientId) missing.push('CORE_CLIENT_ID');
  if (status && !status.hasClientSecret) missing.push('CORE_CLIENT_SECRET');
  if (status && !status.hasRedirectUri) missing.push('BQE_REDIRECT_URI');
  if (status && status.hasServiceRole === false) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  return (
    <div className="panel plist-upload">
      <h3>
        BQE CORE live data
        <span className="tag">Sole source · Projects API</span>
      </h3>
      <p className="plist-upload-help">
        Connect with a CORE admin login, then sync. Sync replaces the project list with live CORE
        data only (no Excel merge).
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
          {busy ? 'Working…' : 'Sync projects'}
        </button>
      </div>

      {msg ? <p className="plist-upload-ok">{msg}</p> : null}
      {err ? <p className="plist-upload-err">{err}</p> : null}
    </div>
  );
}
