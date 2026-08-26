import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import {
  ADMIN_TABLES,
  clearAllSchedules,
  clearProjectList,
  deleteAdminRows,
  listAdminTables,
  listProjectSchedules,
  pruneProjectsWithoutRecentHours,
  queryAdminTable,
  seedMembersFromTimeEntries,
  seedSchedulesFromTimeEntries,
  setScheduleStartDate,
  updateAdminRows,
  upsertAdminRows,
  type ProjectScheduleRow,
  type TableInfo,
} from '../lib/adminData';
import {
  AdminEmployeesPanel,
  AdminMembersPanel,
  AdminOverviewPanel,
  AdminProfilesPanel,
} from '../components/AdminManagePanels';
import { isAdminRole } from '../lib/roles';
import { useAuth } from '../hooks/useAuth';

type TabId =
  | 'overview'
  | 'employees'
  | 'profiles'
  | 'members'
  | 'browse'
  | 'schedules'
  | 'seed'
  | 'bulk'
  | 'danger';
type ScheduleFilter = 'all' | 'assigned' | 'unassigned' | 'missing_start';

const SEARCH_COLUMNS: Record<string, string> = {
  pa_projects: 'project',
  pa_profiles: 'email',
  pa_project_members: 'employee_name',
  pa_time_entries: 'employee_name',
  pa_employee_totals: 'employee',
  pa_employee_monthly: 'employee',
  pa_ar_clients: 'client',
  pa_invoice_ledger: 'client',
  pa_schedules: 'project_key',
};

function cellPreview(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  const s = String(v);
  return s.length > 64 ? `${s.slice(0, 63)}…` : s;
}

export function AdminData() {
  const { realProfile, impersonating } = useAuth();
  const { reload } = useDashboard();
  const allowed = isAdminRole(realProfile?.role) && !impersonating;

  const [tab, setTab] = useState<TabId>('overview');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [table, setTable] = useState<string>('pa_projects');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [from, setFrom] = useState(0);
  const [limit] = useState(50);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editJson, setEditJson] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bulkJson, setBulkJson] = useState('[\n  \n]');
  const [bulkStatus, setBulkStatus] = useState('ACTIVE');
  const [bulkMatchStatus, setBulkMatchStatus] = useState('COMPLETED');
  const [schedRows, setSchedRows] = useState<ProjectScheduleRow[]>([]);
  const [schedTotal, setSchedTotal] = useState(0);
  const [schedFrom, setSchedFrom] = useState(0);
  const [schedSearch, setSchedSearch] = useState('');
  const [schedFilter, setSchedFilter] = useState<ScheduleFilter>('all');
  const [schedSummary, setSchedSummary] = useState<{
    projects: number;
    assigned: number;
    unassigned: number;
    with_start: number;
  } | null>(null);
  const [startEdits, setStartEdits] = useState<Record<string, string>>({});
  const schedLimit = 100;

  const columns = useMemo(() => {
    if (!rows.length) return [] as string[];
    const keys = new Set<string>();
    for (const r of rows.slice(0, 20)) Object.keys(r).forEach((k) => keys.add(k));
    return [...keys];
  }, [rows]);

  const idColumn = useMemo(() => {
    if (columns.includes('id')) return 'id';
    if (table === 'pa_projects' && columns.includes('project')) return 'project';
    if (table === 'pa_profiles') return 'id';
    return columns[0] || 'id';
  }, [columns, table]);

  const refreshTables = useCallback(async () => {
    const res = await listAdminTables();
    setTables(res.tables);
  }, []);

  const loadRows = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const searchCol = SEARCH_COLUMNS[table];
      const res = await queryAdminTable({
        table,
        from,
        limit,
        search:
          search.trim() && searchCol
            ? { column: searchCol, value: search.trim() }
            : undefined,
      });
      setRows(res.rows);
      setTotal(res.count);
      setMsg(`Loaded ${res.rows.length} row(s)${res.count != null ? ` of ${res.count}` : ''}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Query failed');
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [table, from, limit, search]);

  const loadSchedules = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await listProjectSchedules({
        from: schedFrom,
        limit: schedLimit,
        search: schedSearch.trim() || undefined,
        scheduleFilter: schedFilter,
      });
      setSchedRows(res.rows);
      setSchedTotal(res.count);
      setSchedSummary(res.summary);
      const edits: Record<string, string> = {};
      for (const r of res.rows) edits[r.project] = r.start_date || '';
      setStartEdits(edits);
      setMsg(
        `Schedules: ${res.summary.assigned} assigned / ${res.summary.unassigned} unassigned · ${res.summary.with_start} with start date`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load project schedules');
      setSchedRows([]);
    } finally {
      setBusy(false);
    }
  }, [schedFrom, schedSearch, schedFilter]);

  useEffect(() => {
    if (!allowed) return;
    void refreshTables().catch((e) =>
      setErr(e instanceof Error ? e.message : 'Could not list tables'),
    );
  }, [allowed, refreshTables]);

  useEffect(() => {
    if (!allowed || tab !== 'browse') return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when table/page/search change
  }, [allowed, tab, table, from, search]);

  useEffect(() => {
    if (!allowed || tab !== 'schedules') return;
    void loadSchedules();
  }, [allowed, tab, loadSchedules]);

  if (!allowed) {
    return (
      <section className="sheet active">
        <p className="pd-muted">Admin Data Console is only available to dashboard admins.</p>
      </section>
    );
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const result = await fn();
      setMsg(`${label}: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
      await refreshTables();
      if (tab === 'browse') await loadRows();
      if (tab === 'schedules') await loadSchedules();
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : label);
    } finally {
      setBusy(false);
    }
  }

  function openRow(row: Record<string, unknown>) {
    const id = row[idColumn];
    setSelectedId(id != null ? String(id) : null);
    setEditJson(JSON.stringify(row, null, 2));
  }

  return (
    <section className="sheet active admin-data">
      <header className="admin-data-head">
        <div>
          <p className="pd-kicker">Admin only</p>
          <h2 className="display">Data console</h2>
          <p className="emp-lede">
            Firm management hub: everyone in the system, portal roles, memberships, schedules, table
            browse/edit, seed from hours, and cleanup. Uses the service role after your admin session
            is verified.
          </p>
        </div>
        <div className="admin-data-tabs">
          {(
            [
              ['overview', 'Overview'],
              ['employees', 'Employees'],
              ['profiles', 'Profiles / roles'],
              ['members', 'Members'],
              ['schedules', 'Schedules'],
              ['browse', 'Browse / edit'],
              ['seed', 'Seed from hours'],
              ['bulk', 'Bulk edit'],
              ['danger', 'Danger zone'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {err ? <p className="plist-upload-err">{err}</p> : null}
      {msg ? <p className="admin-data-msg mono">{msg}</p> : null}

      {tab === 'overview' ? (
        <AdminOverviewPanel
          busy={busy}
          onBusy={setBusy}
          onError={setErr}
          onMsg={setMsg}
        />
      ) : null}

      {tab === 'employees' ? (
        <AdminEmployeesPanel
          busy={busy}
          onBusy={setBusy}
          onError={setErr}
          onMsg={setMsg}
        />
      ) : null}

      {tab === 'profiles' ? (
        <AdminProfilesPanel
          busy={busy}
          onBusy={setBusy}
          onError={setErr}
          onMsg={setMsg}
        />
      ) : null}

      {tab === 'members' ? (
        <AdminMembersPanel
          busy={busy}
          onBusy={setBusy}
          onError={setErr}
          onMsg={setMsg}
        />
      ) : null}

      {tab === 'browse' ? (
        <div className="admin-data-browse">
          <div className="admin-data-sidebar">
            <label>
              Table
              <select
                value={table}
                onChange={(e) => {
                  setTable(e.target.value);
                  setFrom(0);
                  setSelectedId(null);
                  setEditJson('');
                }}
              >
                {ADMIN_TABLES.map((t) => {
                  const info = tables.find((x) => x.table === t);
                  return (
                    <option key={t} value={t}>
                      {t}
                      {info?.ok ? ` (${info.count})` : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Search {SEARCH_COLUMNS[table] ? `(${SEARCH_COLUMNS[table]})` : ''}
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setFrom(0);
                }}
                placeholder={SEARCH_COLUMNS[table] ? 'Filter…' : 'No search column'}
                disabled={!SEARCH_COLUMNS[table]}
              />
            </label>
            <div className="admin-data-pager">
              <button
                type="button"
                className="signout-btn"
                disabled={busy || from <= 0}
                onClick={() => setFrom((f) => Math.max(0, f - limit))}
              >
                Prev
              </button>
              <span className="mono">
                {from + 1}–{from + rows.length}
                {total != null ? ` / ${total}` : ''}
              </span>
              <button
                type="button"
                className="signout-btn"
                disabled={busy || rows.length < limit}
                onClick={() => setFrom((f) => f + limit)}
              >
                Next
              </button>
              <button
                type="button"
                className="signout-btn"
                disabled={busy}
                onClick={() => void loadRows()}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="admin-data-grid-wrap">
            <table className="admin-data-grid">
              <thead>
                <tr>
                  {columns.slice(0, 8).map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const id = r[idColumn];
                  const key = id != null ? String(id) : `row-${i}`;
                  return (
                    <tr
                      key={key}
                      className={selectedId != null && String(id) === selectedId ? 'on' : ''}
                      onClick={() => openRow(r)}
                    >
                      {columns.slice(0, 8).map((c) => (
                        <td key={c} title={String(r[c] ?? '')}>
                          {cellPreview(r[c])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8}>{busy ? 'Loading…' : 'No rows'}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="admin-data-editor">
            <h3>Row editor</h3>
            <p className="pd-muted">
              Edit JSON and Save (upsert). Delete uses <span className="mono">{idColumn}</span>.
            </p>
            <textarea
              value={editJson}
              onChange={(e) => setEditJson(e.target.value)}
              spellCheck={false}
              rows={16}
            />
            <div className="admin-data-actions">
              <button
                type="button"
                className="signout-btn"
                disabled={busy || !editJson.trim()}
                onClick={() =>
                  void run('Upsert', async () => {
                    const parsed = JSON.parse(editJson) as Record<string, unknown>;
                    const res = await upsertAdminRows(table, [parsed]);
                    return `saved ${res.upserted}`;
                  })
                }
              >
                Save row
              </button>
              <button
                type="button"
                className="signout-btn"
                disabled={busy || !selectedId}
                onClick={() =>
                  void run('Delete', async () => {
                    if (!selectedId) return 'nothing selected';
                    if (!window.confirm(`Delete ${table} where ${idColumn}=${selectedId}?`)) {
                      return 'cancelled';
                    }
                    const res = await deleteAdminRows({
                      table,
                      ids: [selectedId],
                      idColumn,
                    });
                    setEditJson('');
                    setSelectedId(null);
                    return `deleted ${res.deleted}`;
                  })
                }
              >
                Delete row
              </button>
              <button
                type="button"
                className="signout-btn"
                onClick={() => {
                  setEditJson('{\n  \n}');
                  setSelectedId(null);
                }}
              >
                New blank
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'schedules' ? (
        <div className="admin-data-panel">
          <h3>Project schedules</h3>
          <p className="pd-muted">
            Project List headers with schedule assignment and kickoff start date (
            <span className="mono">pa_schedules.start_date</span>).
          </p>
          {schedSummary ? (
            <div className="admin-data-sched-summary">
              <span>
                Projects <strong>{schedSummary.projects}</strong>
              </span>
              <span>
                Assigned <strong>{schedSummary.assigned}</strong>
              </span>
              <span>
                Unassigned <strong>{schedSummary.unassigned}</strong>
              </span>
              <span>
                With start date <strong>{schedSummary.with_start}</strong>
              </span>
            </div>
          ) : null}
          <div className="admin-data-inline" style={{ marginBottom: 12 }}>
            <label>
              Filter
              <select
                value={schedFilter}
                onChange={(e) => {
                  setSchedFilter(e.target.value as ScheduleFilter);
                  setSchedFrom(0);
                }}
              >
                <option value="all">All projects</option>
                <option value="assigned">Schedule assigned</option>
                <option value="unassigned">Schedule not assigned</option>
                <option value="missing_start">Assigned, missing start date</option>
              </select>
            </label>
            <label>
              Search
              <input
                value={schedSearch}
                onChange={(e) => {
                  setSchedSearch(e.target.value);
                  setSchedFrom(0);
                }}
                placeholder="Project, client, manager…"
              />
            </label>
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => void loadSchedules()}
            >
              Refresh
            </button>
          </div>
          <div className="admin-data-pager" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="signout-btn"
              disabled={busy || schedFrom <= 0}
              onClick={() => setSchedFrom((f) => Math.max(0, f - schedLimit))}
            >
              Prev
            </button>
            <span className="mono">
              {schedTotal ? `${schedFrom + 1}–${schedFrom + schedRows.length} / ${schedTotal}` : '0'}
            </span>
            <button
              type="button"
              className="signout-btn"
              disabled={busy || schedFrom + schedRows.length >= schedTotal}
              onClick={() => setSchedFrom((f) => f + schedLimit)}
            >
              Next
            </button>
          </div>
          <div className="admin-data-grid-wrap">
            <table className="admin-data-grid">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Schedule</th>
                  <th>Start date</th>
                  <th>Rows</th>
                  <th>Manager</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {schedRows.map((r) => (
                  <tr key={r.project}>
                    <td title={r.project}>{cellPreview(r.project)}</td>
                    <td>{cellPreview(r.client)}</td>
                    <td>{cellPreview(r.status)}</td>
                    <td>
                      <span
                        className={
                          r.schedule_assigned
                            ? 'admin-data-pill on'
                            : 'admin-data-pill off'
                        }
                      >
                        {r.schedule_assigned ? 'Assigned' : 'Not assigned'}
                      </span>
                    </td>
                    <td>
                      <input
                        className="admin-data-start-input"
                        value={startEdits[r.project] ?? ''}
                        placeholder="M/D/YYYY or blank"
                        onChange={(e) =>
                          setStartEdits((prev) => ({ ...prev, [r.project]: e.target.value }))
                        }
                      />
                    </td>
                    <td className="mono">{r.schedule_row_count}</td>
                    <td>{cellPreview(r.manager)}</td>
                    <td>
                      <button
                        type="button"
                        className="signout-btn"
                        disabled={busy}
                        onClick={() =>
                          void run('Set start', async () => {
                            const v = (startEdits[r.project] || '').trim();
                            const res = await setScheduleStartDate(r.project, v);
                            await loadSchedules();
                            return res.created
                              ? `created schedule + start “${v || '(none)'}”`
                              : `start → “${v || '(none)'}”`;
                          })
                        }
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                ))}
                {!schedRows.length ? (
                  <tr>
                    <td colSpan={8}>{busy ? 'Loading…' : 'No projects match'}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'seed' ? (
        <div className="admin-data-panel">
          <h3>Seed project members from logged hours</h3>
          <p className="pd-muted">
            Scans <span className="mono">pa_time_entries</span>, matches job codes to Project List
            headers, inserts missing rows into <span className="mono">pa_project_members</span>, and
            promotes Project List managers to leads. Same logic as{' '}
            <span className="mono">npm run sync:project-members</span>.
          </p>
          <p className="pd-muted">
            Does <strong>not</strong> create, clear, or change schedules, schedule rows, or project
            start dates by itself — use the schedule seed below for that.
          </p>
          <div className="admin-data-actions">
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() =>
                void run('Dry-run seed members', async () => seedMembersFromTimeEntries(true))
              }
            >
              Dry run members
            </button>
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Insert/promote project members from time entries?')) return;
                void run('Seed members', async () => seedMembersFromTimeEntries(false));
              }}
            >
              Run member seed
            </button>
          </div>

          <h3 style={{ marginTop: 28 }}>Seed schedules from logged hours</h3>
          <p className="pd-muted">
            For each Project List header with time entries: set{' '}
            <span className="mono">start_date</span> to the first work date, create a schedule shell
            if missing, and fill the firm checklist rows dated from that kickoff. Hand-edited
            schedules (non autofill/preset rows) are skipped unless you force wipe.
          </p>
          <div className="admin-data-actions">
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() =>
                void run('Dry-run seed schedules', async () =>
                  seedSchedulesFromTimeEntries(true, false),
                )
              }
            >
              Dry run schedules
            </button>
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    'Create/update start dates and seed checklist rows from first logged hours? Hand-edited schedules are skipped.',
                  )
                ) {
                  return;
                }
                void run('Seed schedules', async () => seedSchedulesFromTimeEntries(false, false));
              }}
            >
              Run schedule seed
            </button>
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    'FORCE wipe all schedule rows for projects with hours and rebuild from first TE date? This overwrites hand edits.',
                  )
                ) {
                  return;
                }
                void run('Force seed schedules', async () =>
                  seedSchedulesFromTimeEntries(false, true),
                );
              }}
            >
              Force wipe + seed
            </button>
          </div>

          <h3 style={{ marginTop: 28 }}>Prune projects without recent hours</h3>
          <p className="pd-muted">
            Delete Project List rows (and orphan schedules) with no time entries in the last 3 years.
            CORE sync also applies this filter automatically.
          </p>
          <div className="admin-data-actions">
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    'Delete all projects (and their schedules) with no hours in the last 3 years?',
                  )
                ) {
                  return;
                }
                void run('Prune projects', async () => pruneProjectsWithoutRecentHours());
              }}
            >
              Prune now
            </button>
          </div>

          <ul className="admin-data-table-counts">
            {tables
              .filter((t) =>
                [
                  'pa_projects',
                  'pa_time_entries',
                  'pa_project_members',
                  'pa_schedules',
                  'pa_schedule_rows',
                  'pa_profiles',
                ].includes(t.table),
              )
              .map((t) => (
                <li key={t.table}>
                  <span className="mono">{t.table}</span>
                  <strong>{t.ok ? t.count.toLocaleString() : t.error || '—'}</strong>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {tab === 'bulk' ? (
        <div className="admin-data-panel">
          <h3>Bulk upsert (JSON array)</h3>
          <p className="pd-muted">
            Upsert up to 1000 objects into the selected browse table (
            <span className="mono">{table}</span>).
          </p>
          <textarea
            value={bulkJson}
            onChange={(e) => setBulkJson(e.target.value)}
            spellCheck={false}
            rows={12}
          />
          <div className="admin-data-actions">
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() =>
                void run('Bulk upsert', async () => {
                  const parsed = JSON.parse(bulkJson) as Record<string, unknown>[];
                  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
                  const res = await upsertAdminRows(table, parsed);
                  return `upserted ${res.upserted}`;
                })
              }
            >
              Upsert into {table}
            </button>
          </div>

          <h3 style={{ marginTop: 28 }}>Bulk project status</h3>
          <p className="pd-muted">
            Set all <span className="mono">pa_projects</span> rows with status{' '}
            <span className="mono">{bulkMatchStatus || '(any)'}</span> →{' '}
            <span className="mono">{bulkStatus}</span>.
          </p>
          <div className="admin-data-inline">
            <label>
              Match status
              <input value={bulkMatchStatus} onChange={(e) => setBulkMatchStatus(e.target.value)} />
            </label>
            <label>
              Set to
              <input value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} />
            </label>
            <button
              type="button"
              className="signout-btn"
              disabled={busy || !bulkStatus.trim() || !bulkMatchStatus.trim()}
              onClick={() => {
                if (
                  !window.confirm(
                    `Update projects status ${bulkMatchStatus} → ${bulkStatus}?`,
                  )
                ) {
                  return;
                }
                void run('Bulk status', async () => {
                  const res = await updateAdminRows({
                    table: 'pa_projects',
                    patch: { status: bulkStatus.trim() },
                    match: { status: bulkMatchStatus.trim() },
                  });
                  return `updated ${res.updated}`;
                });
              }}
            >
              Apply status
            </button>
          </div>
          <p className="pd-muted" style={{ marginTop: 8 }}>
            Match status is required so a blank filter cannot rewrite the whole project list.
          </p>
        </div>
      ) : null}

      {tab === 'danger' ? (
        <div className="admin-data-panel admin-data-danger">
          <h3>Danger zone</h3>
          <p className="pd-muted">Irreversible cleanup. Confirm carefully.</p>
          <div className="admin-data-actions">
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Delete ALL schedules and schedule rows?')) return;
                void run('Clear schedules', async () => clearAllSchedules());
              }}
            >
              Clear all schedules
            </button>
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    'Delete the entire Project List (pa_projects)? You will need a BQE sync or upload to restore.',
                  )
                ) {
                  return;
                }
                void run('Clear projects', async () => clearProjectList());
              }}
            >
              Clear project list
            </button>
            <button
              type="button"
              className="signout-btn"
              disabled={busy}
              onClick={() => void refreshTables()}
            >
              Refresh table counts
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
