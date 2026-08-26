import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { isAdminRole, roleLabel } from '../lib/roles';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/authTypes';

type ListedProfile = Pick<
  Profile,
  'id' | 'email' | 'role' | 'display_name' | 'employee_name' | 'client_name'
>;

/** Admin-only: enter any portal profile for UI testing (JWT stays admin). */
export function AdminTestAsPanel() {
  const { realProfile, impersonating, startImpersonation, stopImpersonation, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ListedProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canUse = isAdminRole(realProfile?.role);

  useEffect(() => {
    if (!canUse || !open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      const { data, error } = await supabase
        .from('pa_profiles')
        .select('id,email,role,display_name,employee_name,client_name')
        .order('email', { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        setRows([]);
      } else {
        setRows((data || []) as ListedProfile[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canUse, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = [r.email, r.display_name, r.employee_name, r.client_name, r.role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query]);

  if (!canUse) return null;

  async function enterAs(id: string) {
    setBusyId(id);
    setErr(null);
    try {
      await startImpersonation(id);
      setOpen(false);
      setQuery('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not enter account');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-test-as">
      {impersonating ? (
        <button type="button" className="signout-btn admin-test-exit" onClick={() => stopImpersonation()}>
          Exit test ({profile?.email || 'user'})
        </button>
      ) : (
        <button
          type="button"
          className="signout-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? 'Close test mode' : 'Test as…'}
        </button>
      )}

      {open && !impersonating ? (
        <div className="admin-test-popover" role="dialog" aria-label="Test as user">
          <p className="admin-test-hint">
            View the portal as any profile. Your admin session stays active for API calls.
          </p>
          <input
            type="search"
            className="admin-test-search"
            placeholder="Search name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {err ? <p className="login-error">{err}</p> : null}
          {loading ? (
            <p className="admin-test-hint mono">Loading profiles…</p>
          ) : (
            <ul className="admin-test-list">
              {filtered.slice(0, 80).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busyId === r.id || r.id === realProfile?.id}
                    onClick={() => void enterAs(r.id)}
                  >
                    <strong>{r.display_name || r.employee_name || r.client_name || r.email}</strong>
                    <span className="mono">{r.email}</span>
                    <span className="admin-test-role">{roleLabel(r.role)}</span>
                  </button>
                </li>
              ))}
              {!filtered.length ? <li className="admin-test-hint">No matches</li> : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ImpersonationBanner() {
  const { impersonating, realProfile, profile, stopImpersonation } = useAuth();
  if (!impersonating || !profile) return null;
  return (
    <div className="impersonation-banner" role="status">
      <span>
        Testing as <strong>{profile.display_name || profile.email}</strong>
        <span className="mono"> ({roleLabel(profile.role)})</span>
        {realProfile?.email ? (
          <>
            {' '}
            · signed in as <span className="mono">{realProfile.email}</span>
          </>
        ) : null}
      </span>
      <button type="button" onClick={() => stopImpersonation()}>
        Exit testing mode
      </button>
    </div>
  );
}
