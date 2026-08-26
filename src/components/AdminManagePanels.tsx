import { useCallback, useEffect, useState } from 'react';
import {
  listEmployeesDirectory,
  listMembersOverview,
  loadManagementOverview,
  updateProfile,
  type EmployeeDirectoryRow,
  type ManagementOverview,
  type MembersOverviewRow,
} from '../lib/adminData';
import { roleLabel } from '../lib/roles';
import type { UserRole } from '../lib/authTypes';
import { BqeConnectPanel } from './BqeConnectPanel';
import { AdminTestAsPanel } from './AdminTestAs';

const ROLES: UserRole[] = ['admin', 'exec', 'project_lead', 'employee', 'customer'];

function cell(v: unknown): string {
  if (v == null || v === '') return '—';
  return String(v);
}

export function AdminOverviewPanel({
  busy,
  onBusy,
  onError,
  onMsg,
}: {
  busy: boolean;
  onBusy: (v: boolean) => void;
  onError: (v: string | null) => void;
  onMsg: (v: string | null) => void;
}) {
  const [data, setData] = useState<ManagementOverview | null>(null);

  const load = useCallback(async () => {
    onBusy(true);
    onError(null);
    try {
      const res = await loadManagementOverview();
      setData(res);
      onMsg('Management overview loaded.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Overview failed');
    } finally {
      onBusy(false);
    }
  }, [onBusy, onError, onMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-data-panel">
      <div className="admin-data-actions" style={{ marginBottom: 12 }}>
        <button type="button" className="signout-btn" disabled={busy} onClick={() => void load()}>
          Refresh overview
        </button>
      </div>

      <h3>Impersonation</h3>
      <p className="pd-muted">Test the app as another role without signing out.</p>
      <div style={{ marginBottom: 18 }}>
        <AdminTestAsPanel />
      </div>

      <h3>BQE CORE</h3>
      <p className="pd-muted">Connect, sync, and project-list tools (same controls as Executive).</p>
      <div style={{ marginBottom: 18 }}>
        <BqeConnectPanel />
      </div>

      {!data ? (
        <p className="pd-muted">{busy ? 'Loading overview counts…' : 'No overview yet.'}</p>
      ) : (
        <>
          <div className="admin-data-sched-summary">
            <span>
              Project headers <strong>{data.projectHeaders}</strong>
            </span>
            <span>
              Active headers <strong>{data.activeProjectHeaders}</strong>
            </span>
            <span>
              Schedules assigned <strong>{data.schedulesAssigned}</strong>
            </span>
          </div>
          <h3>Portal roles</h3>
          <ul className="admin-data-table-counts">
            {Object.entries(data.roles)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([role, n]) => (
                <li key={role}>
                  <span>{roleLabel(role as UserRole)}</span>
                  <strong>{n}</strong>
                </li>
              ))}
          </ul>
          <h3>Table counts</h3>
          <ul className="admin-data-table-counts">
            {data.tableCounts.map((t) => (
              <li key={t.table}>
                <span className="mono">{t.table}</span>
                <strong>{t.count < 0 ? '—' : t.count.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
          <h3>BQE connection row</h3>
          {data.bqeConnection ? (
            <pre className="admin-data-pre mono">
              {JSON.stringify(data.bqeConnection, null, 2)}
            </pre>
          ) : (
            <p className="pd-muted">No BQE connection row.</p>
          )}
          <h3>Recent sync runs</h3>
          <div className="admin-data-grid-wrap">
            <table className="admin-data-grid">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Completed</th>
                  <th>Fetched</th>
                  <th>Inserted</th>
                </tr>
              </thead>
              <tbody>
                {(data.lastSyncRuns || []).map((r, i) => (
                  <tr key={i}>
                    <td>{cell(r.sync_type)}</td>
                    <td>{cell(r.status)}</td>
                    <td className="mono">{cell(r.completed_at)}</td>
                    <td>{cell(r.entries_fetched)}</td>
                    <td>{cell(r.entries_inserted)}</td>
                  </tr>
                ))}
                {!data.lastSyncRuns?.length ? (
                  <tr>
                    <td colSpan={5}>No sync runs</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function AdminEmployeesPanel({
  busy,
  onBusy,
  onError,
  onMsg,
}: {
  busy: boolean;
  onBusy: (v: boolean) => void;
  onError: (v: string | null) => void;
  onMsg: (v: string | null) => void;
}) {
  const [rows, setRows] = useState<EmployeeDirectoryRow[]>([]);
  const [count, setCount] = useState(0);
  const [from, setFrom] = useState(0);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<{
    people: number;
    with_profile: number;
    with_te: number;
    with_capacity: number;
  } | null>(null);
  const limit = 200;

  const load = useCallback(async () => {
    onBusy(true);
    onError(null);
    try {
      const res = await listEmployeesDirectory({
        from,
        limit,
        search: search.trim() || undefined,
      });
      setRows(res.rows);
      setCount(res.count);
      setSummary(res.summary);
      onMsg(`Employees: ${res.summary.people} people in directory.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Employees load failed');
    } finally {
      onBusy(false);
    }
  }, [from, search, onBusy, onError, onMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-data-panel">
      <h3>Everyone in the system</h3>
      <p className="pd-muted">
        Merged from profiles, roster, capacity, hour totals, project memberships, and time-entry
        names. Rows with a portal profile can edit email here; others need a profile first (sign-in
        or Profiles tab).
      </p>
      {summary ? (
        <div className="admin-data-sched-summary">
          <span>
            People <strong>{summary.people}</strong>
          </span>
          <span>
            With portal profile <strong>{summary.with_profile}</strong>
          </span>
          <span>
            With TE <strong>{summary.with_te}</strong>
          </span>
          <span>
            With capacity <strong>{summary.with_capacity}</strong>
          </span>
        </div>
      ) : null}
      <div className="admin-data-inline" style={{ marginBottom: 12 }}>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFrom(0);
            }}
            placeholder="Name, email, team, role…"
          />
        </label>
        <button type="button" className="signout-btn" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="admin-data-pager" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="signout-btn"
          disabled={busy || from <= 0}
          onClick={() => setFrom((f) => Math.max(0, f - limit))}
        >
          Prev
        </button>
        <span className="mono">
          {count ? `${from + 1}–${from + rows.length} / ${count}` : '0'}
        </span>
        <button
          type="button"
          className="signout-btn"
          disabled={busy || from + rows.length >= count}
          onClick={() => setFrom((f) => f + limit)}
        >
          Next
        </button>
      </div>
      <div className="admin-data-grid-wrap">
        <table className="admin-data-grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Portal role</th>
              <th>Team</th>
              <th>Capacity</th>
              <th>Job / disc.</th>
              <th>Hours</th>
              <th>Projects</th>
              <th>Leads</th>
              <th>Sources</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.name}-${r.profile_id || ''}`}>
                <td title={r.name}>{r.name}</td>
                <td>
                  {r.profile_id ? (
                    <input
                      className="admin-data-start-input"
                      style={{ width: 180 }}
                      defaultValue={r.email || ''}
                      id={`emp-em-${r.profile_id}`}
                      type="email"
                      placeholder="email@…"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="mono">{cell(r.email)}</span>
                  )}
                </td>
                <td>{r.role ? roleLabel(r.role as UserRole) : '—'}</td>
                <td>{cell(r.team)}</td>
                <td>{r.capacity_hours != null ? r.capacity_hours : '—'}</td>
                <td>
                  {[r.job_role, r.discipline].filter(Boolean).join(' · ') || '—'}
                </td>
                <td>
                  {r.total_hours != null ? Math.round(r.total_hours).toLocaleString() : '—'}
                  {r.bill_hours != null ? ` / ${Math.round(r.bill_hours).toLocaleString()}b` : ''}
                </td>
                <td>{r.member_projects || '—'}</td>
                <td>{r.lead_projects || '—'}</td>
                <td className="mono">{r.sources.join(', ')}</td>
                <td>
                  {r.profile_id ? (
                    <button
                      type="button"
                      className="signout-btn"
                      disabled={busy}
                      onClick={() => {
                        const id = r.profile_id!;
                        const email = (
                          document.getElementById(`emp-em-${id}`) as HTMLInputElement | null
                        )?.value;
                        void (async () => {
                          onBusy(true);
                          onError(null);
                          try {
                            const trimmed = (email || '').trim().toLowerCase();
                            if (!trimmed || !trimmed.includes('@')) {
                              throw new Error('A valid email is required');
                            }
                            await updateProfile(id, { email: trimmed });
                            onMsg(`Email updated → ${trimmed}`);
                            await load();
                          } catch (e) {
                            onError(e instanceof Error ? e.message : 'Email update failed');
                          } finally {
                            onBusy(false);
                          }
                        })();
                      }}
                    >
                      Save email
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={11}>{busy ? 'Loading…' : 'No people found'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminProfilesPanel({
  busy,
  onBusy,
  onError,
  onMsg,
}: {
  busy: boolean;
  onBusy: (v: boolean) => void;
  onError: (v: string | null) => void;
  onMsg: (v: string | null) => void;
}) {
  const [rows, setRows] = useState<EmployeeDirectoryRow[]>([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    onBusy(true);
    onError(null);
    try {
      const res = await listEmployeesDirectory({
        from: 0,
        limit: 500,
        search: search.trim() || undefined,
      });
      setRows(res.rows.filter((r) => r.profile_id));
      onMsg(`Profiles: ${res.rows.filter((r) => r.profile_id).length} portal accounts.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Profiles load failed');
    } finally {
      onBusy(false);
    }
  }, [search, onBusy, onError, onMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-data-panel">
      <h3>Portal profiles &amp; roles</h3>
      <p className="pd-muted">
        Edit email, role, and employee binding for signed-in portal accounts (people with a{' '}
        <span className="mono">pa_profiles</span> row).
      </p>
      <div className="admin-data-inline" style={{ marginBottom: 12 }}>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Email or name…"
          />
        </label>
        <button type="button" className="signout-btn" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="admin-data-grid-wrap">
        <table className="admin-data-grid">
          <thead>
            <tr>
              <th>Email</th>
              <th>Display</th>
              <th>Employee name</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.profile_id!}>
                <td>
                  <input
                    className="admin-data-start-input"
                    style={{ width: 200 }}
                    defaultValue={r.email || ''}
                    id={`em-${r.profile_id}`}
                    type="email"
                    placeholder="email@…"
                  />
                </td>
                <td>
                  <input
                    className="admin-data-start-input"
                    style={{ width: 140 }}
                    defaultValue={r.display_name || ''}
                    id={`dn-${r.profile_id}`}
                  />
                </td>
                <td>
                  <input
                    className="admin-data-start-input"
                    style={{ width: 140 }}
                    defaultValue={r.name || ''}
                    id={`en-${r.profile_id}`}
                  />
                </td>
                <td>
                  <select
                    defaultValue={r.role || 'employee'}
                    id={`role-${r.profile_id}`}
                    style={{ fontSize: 12, padding: 4 }}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="signout-btn"
                    disabled={busy}
                    onClick={() => {
                      const id = r.profile_id!;
                      const email = (
                        document.getElementById(`em-${id}`) as HTMLInputElement | null
                      )?.value;
                      const display = (
                        document.getElementById(`dn-${id}`) as HTMLInputElement | null
                      )?.value;
                      const employee = (
                        document.getElementById(`en-${id}`) as HTMLInputElement | null
                      )?.value;
                      const role = (document.getElementById(`role-${id}`) as HTMLSelectElement | null)
                        ?.value;
                      void (async () => {
                        onBusy(true);
                        onError(null);
                        try {
                          const trimmed = (email || '').trim().toLowerCase();
                          if (!trimmed || !trimmed.includes('@')) {
                            throw new Error('A valid email is required');
                          }
                          await updateProfile(id, {
                            email: trimmed,
                            display_name: display?.trim() || null,
                            employee_name: employee?.trim() || null,
                            role: role || 'employee',
                          });
                          onMsg(`Updated ${trimmed}`);
                          await load();
                        } catch (e) {
                          onError(e instanceof Error ? e.message : 'Update failed');
                        } finally {
                          onBusy(false);
                        }
                      })();
                    }}
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={5}>{busy ? 'Loading…' : 'No profiles'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminMembersPanel({
  busy,
  onBusy,
  onError,
  onMsg,
}: {
  busy: boolean;
  onBusy: (v: boolean) => void;
  onError: (v: string | null) => void;
  onMsg: (v: string | null) => void;
}) {
  const [rows, setRows] = useState<MembersOverviewRow[]>([]);
  const [count, setCount] = useState(0);
  const [from, setFrom] = useState(0);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<{
    projects_with_members: number;
    total_memberships: number;
    lead_memberships: number;
  } | null>(null);
  const limit = 100;

  const load = useCallback(async () => {
    onBusy(true);
    onError(null);
    try {
      const res = await listMembersOverview({
        from,
        limit,
        search: search.trim() || undefined,
      });
      setRows(res.rows);
      setCount(res.count);
      setSummary(res.summary);
      onMsg(
        `Members: ${res.summary.total_memberships} memberships across ${res.summary.projects_with_members} projects.`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Members load failed');
    } finally {
      onBusy(false);
    }
  }, [from, search, onBusy, onError, onMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-data-panel">
      <h3>Project memberships</h3>
      <p className="pd-muted">Leads and member counts per project (from pa_project_members).</p>
      {summary ? (
        <div className="admin-data-sched-summary">
          <span>
            Projects <strong>{summary.projects_with_members}</strong>
          </span>
          <span>
            Memberships <strong>{summary.total_memberships}</strong>
          </span>
          <span>
            Lead seats <strong>{summary.lead_memberships}</strong>
          </span>
        </div>
      ) : null}
      <div className="admin-data-inline" style={{ marginBottom: 12 }}>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setFrom(0);
            }}
            placeholder="Project or person…"
          />
        </label>
        <button type="button" className="signout-btn" disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="admin-data-pager" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="signout-btn"
          disabled={busy || from <= 0}
          onClick={() => setFrom((f) => Math.max(0, f - limit))}
        >
          Prev
        </button>
        <span className="mono">
          {count ? `${from + 1}–${from + rows.length} / ${count}` : '0'}
        </span>
        <button
          type="button"
          className="signout-btn"
          disabled={busy || from + rows.length >= count}
          onClick={() => setFrom((f) => f + limit)}
        >
          Next
        </button>
      </div>
      <div className="admin-data-grid-wrap">
        <table className="admin-data-grid">
          <thead>
            <tr>
              <th>Project</th>
              <th>Members</th>
              <th>Leads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.project_key}>
                <td title={r.project_key}>{r.project_key}</td>
                <td>{r.members}</td>
                <td>{r.leads.join(', ') || '—'}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={3}>{busy ? 'Loading…' : 'No memberships'}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
