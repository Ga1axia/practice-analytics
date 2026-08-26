import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoursHBar } from '../components/Charts';
import { KpiRow } from '../components/KpiRow';
import { supabase } from '../lib/supabase';
import { ymd, daysAgoYmd } from '../lib/staffingDelivery';
import type { TimeEntryLite } from '../lib/staffingTypes';
import {
  loadHistoricalTimeEntries,
  loadHistoricalTimeEntryStats,
} from '../lib/staffingTimeEntries';
import {
  loadStaffingOverview,
  resolveHistoryDateRange,
  type EmployeeHistoryRow,
  type HistoryAnalyticsResult,
  type HistoryDatePreset,
  type HoursSlice,
  type StaffingOverview,
} from '../lib/staffingHistoryAnalytics';
import { WORK_TYPES, type WorkType } from '../lib/workType';
import { phaseAbbrev } from '../lib/phaseAbbrev';

type StaffingView = 'analytics' | 'entries';

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function shortLabel(label: string, max = 10): string {
  const abbr = phaseAbbrev(label);
  if (abbr && abbr !== '—') return abbr;
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Compact labeled % bars for table cells / firm panels. */
function ShareBars({
  slices,
  max = 3,
  tone = 'teal',
  showHours = false,
}: {
  slices: Array<Pick<HoursSlice, 'label' | 'share' | 'hours'>>;
  max?: number;
  tone?: 'teal' | 'gold' | 'navy';
  showHours?: boolean;
}) {
  const shown = slices.slice(0, max);
  if (!shown.length) return <span className="staff-share-empty">—</span>;
  return (
    <div className="staff-share" onClick={(e) => e.stopPropagation()}>
      {shown.map((s) => (
        <div key={s.label} className="staff-share-row" title={`${s.label}: ${s.hours.toFixed(1)}h (${pct(s.share)})`}>
          <span className="staff-share-lab">{shortLabel(s.label)}</span>
          <span className="staff-share-track">
            <span
              className={`staff-share-fill ${tone === 'teal' ? '' : tone}`}
              style={{ width: `${Math.max(2, Math.min(100, s.share * 100))}%` }}
            />
          </span>
          <span className="staff-share-pct">{pct(s.share)}</span>
          {showHours ? <span className="staff-avg-h">{s.hours.toFixed(0)}h</span> : null}
        </div>
      ))}
    </div>
  );
}

function focusResult(
  full: HistoryAnalyticsResult,
  name: string | null | undefined,
): HistoryAnalyticsResult {
  const want = (name || '').trim();
  if (!want) return full;
  const row = full.employees.find((e) => e.employeeName === want);
  if (!row) {
    return {
      ...full,
      summary: {
        ...full.summary,
        employees: 0,
        totalHours: 0,
        billableHours: 0,
        deliveryHours: 0,
        projectCount: 0,
      },
      averages: { ...full.averages, byPhase: [] },
      employees: [],
    };
  }
  return {
    ...full,
    summary: {
      ...full.summary,
      employees: 1,
      totalHours: row.totalHours,
      billableHours: row.billableHours,
      deliveryHours: row.deliveryHours,
      projectCount: row.projectCount,
    },
    averages: {
      ...full.averages,
      byPhase: row.topPhases.map((p) => ({
        key: p.key,
        label: p.label,
        hours: p.hours,
        share: p.share,
        billableHours: p.billableHours,
        people: 1,
        projects: 0,
        avgHoursPerPerson: p.hours,
        avgHoursPerProject: 0,
      })),
    },
    employees: [row],
  };
}

function fmtHoursKpi(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function PeriodSnapshotPanel({
  title,
  who,
  rangeLabel,
  result,
}: {
  title: string;
  who: string;
  rangeLabel: string;
  result: HistoryAnalyticsResult;
}) {
  const summary = result.summary;
  const phases = result.averages.byPhase.slice(0, 10);
  const solo = result.employees.length === 1 ? result.employees[0]! : null;
  const kpiItems = [
    {
      k: 'Hours',
      v: fmtHoursKpi(summary.totalHours),
      cls: 'accent-teal',
    },
    {
      k: 'Billable',
      v: fmtHoursKpi(summary.billableHours),
      cls: 'accent-gold',
    },
    { k: 'Projects', v: String(summary.projectCount) },
    solo
      ? { k: 'Pace', v: `${solo.weeklyPace.toFixed(1)} h/wk` }
      : { k: 'Delivery', v: fmtHoursKpi(summary.deliveryHours) },
  ];
  return (
    <div className="panel staff-period">
      <h3>
        {title} <span className="tag">{who}</span>{' '}
        <span className="tag">{rangeLabel}</span>
      </h3>
      <KpiRow items={kpiItems} />
      <h4 className="exec-load-sub">Phase mix</h4>
      <div className="chart-wrap tall">
        {phases.length ? (
          <HoursHBar
            labels={phases.map((p) => shortLabel(p.label, 16))}
            values={phases.map((p) => p.hours)}
            fullLabels={phases.map((p) => `${p.label} · ${pct(p.share)}`)}
          />
        ) : (
          <div className="plist-empty">No phase hours in this range.</div>
        )}
      </div>
    </div>
  );
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readSyncJson<T extends { error?: string; message?: string }>(
  res: Response,
): Promise<T> {
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
        'API crashed during sync (often timeout). Use http://localhost:5173 with npm run dev:api running — not the Vercel URL.',
      );
    }
    if (res.status === 502 || /Local API is not running/i.test(snippet)) {
      throw new Error('Local API is not running. Start: npm run dev:api');
    }
    // Safari often surfaces non-JSON as "The string did not match the expected pattern."
    throw new Error(`API returned non-JSON (${res.status}): ${snippet || '(empty)'}`);
  }
}

function parsePresetSelect(value: string): HistoryDatePreset {
  if (value === 'billing' || value === 'custom') return value;
  const n = Number(value);
  if (n === 30 || n === 60 || n === 90) return n;
  return 'billing';
}

export function Staffing() {
  const [view, setView] = useState<StaffingView>('analytics');
  const [preset, setPreset] = useState<HistoryDatePreset>('billing');
  const [customFrom, setCustomFrom] = useState(() => daysAgoYmd(30));
  const [customTo, setCustomTo] = useState(() => ymd(new Date()));
  const [employee, setEmployee] = useState('');
  const [phase, setPhase] = useState('');
  const [workType, setWorkType] = useState('');

  const [overview, setOverview] = useState<StaffingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [histSince, setHistSince] = useState(() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 36);
    return ymd(d);
  });

  const [selected, setSelected] = useState<string | null>(null);

  const dateRange = useMemo(
    () => resolveHistoryDateRange({ preset, customFrom, customTo }),
    [preset, customFrom, customTo],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadStaffingOverview({
        preset,
        customFrom,
        customTo,
        employee: employee || undefined,
        phase: phase || undefined,
        workType: (workType as WorkType) || undefined,
      });
      setOverview(result);
      setSelected((prev) =>
        prev && result.period.employees.some((e) => e.employeeName === prev) ? prev : null,
      );
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : e instanceof Error
            ? e.message
            : 'Failed to load staffing history';
      setError(message);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [preset, customFrom, customTo, employee, phase, workType]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runTimeEntrySync(mode: 'historical' | 'incremental' | 'dry_run') {
    setSyncBusy(true);
    setMsg(null);
    setError(null);
    try {
      if ((mode === 'historical' || mode === 'dry_run') && !/^\d{4}-\d{2}-\d{2}$/.test(histSince)) {
        throw new Error('Historical since must be a valid date (YYYY-MM-DD).');
      }
      const res = await fetch('/api/bqe/sync', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          mode,
          since: mode === 'historical' || mode === 'dry_run' ? histSince : undefined,
        }),
      });
      const body = await readSyncJson<{
        message?: string;
        error?: string;
        fetched?: number;
        inserted?: number;
        updated?: number;
      }>(res);
      if (!res.ok) throw new Error(body.error || 'Sync failed');
      setMsg(
        body.message ||
          `Fetched ${body.fetched ?? 0}, inserted ${body.inserted ?? 0}, updated ${body.updated ?? 0}`,
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncBusy(false);
    }
  }

  const selectedRow = useMemo(
    () => overview?.period.employees.find((e) => e.employeeName === selected) || null,
    [overview, selected],
  );

  if (loading && !overview) {
    return (
      <section className="sheet active">
        <div className="panel">
          <p className="pd-muted">Loading historical staffing…</p>
        </div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="sheet active">
        <div className="panel">
          <h3>Staffing history</h3>
          <p className="plist-upload-err">{error || 'No data'}</p>
          <div className="plist-upload-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="plist-upload-btn"
              disabled={syncBusy}
              onClick={() => void runTimeEntrySync('historical')}
            >
              Import historical time entries
            </button>
            <button
              type="button"
              className="plist-upload-btn"
              style={{ marginLeft: 8 }}
              onClick={() => void reload()}
            >
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  const period = overview.period;
  const ytd = overview.ytd;
  const opts = overview.filterOptions;
  const who = employee.trim() || selected || 'All staff';
  const focusName = employee.trim() || selected;
  const ytdView = focusResult(ytd, focusName);
  const periodView = focusResult(period, focusName);
  const windowRange = `${dateRange.fromDate} → ${dateRange.toDate}`;
  const ytdRangeLabel = `${overview.ytdRange.fromDate} → ${overview.ytdRange.toDate}`;

  return (
    <section className="sheet active staffing-sheet">
      <header className="emp-hero">
        <div>
          <p className="pd-kicker">Staffing</p>
          <h1 className="display" style={{ fontSize: 28 }}>
            Staffing history
          </h1>
          <p className="emp-lede">
            Observed hours from imported BQE time entries — who works on what, which phases, and
            typical activity mix.
          </p>
        </div>
        <div className="staff-meta">
          <div>
            <span className="k">Last time-entry sync</span>
            <div className="v">{fmtWhen(period.summary.lastSyncAt)}</div>
          </div>
          <div className="exec-toggle" role="group" aria-label="Staffing view">
            <button
              type="button"
              className={view === 'analytics' ? 'on' : ''}
              onClick={() => setView('analytics')}
            >
              People &amp; patterns
            </button>
            <button
              type="button"
              className={view === 'entries' ? 'on' : ''}
              onClick={() => setView('entries')}
            >
              Raw time entries
            </button>
          </div>
        </div>
      </header>

      <div className="panel staff-sync">
        <h3>
          Time entry import <span className="tag">Admin · BQE → Supabase</span>
        </h3>
        <div className="filters" style={{ marginBottom: 8 }}>
          <span className="f-label">Historical since</span>
          <input
            type="date"
            value={histSince}
            onChange={(e) => setHistSince(e.target.value)}
            className="staff-input"
          />
        </div>
        <div className="plist-upload-row">
          <button
            type="button"
            className="plist-upload-btn"
            disabled={syncBusy}
            onClick={() => void runTimeEntrySync('historical')}
          >
            {syncBusy ? 'Working…' : 'Import historical time entries'}
          </button>
          <button
            type="button"
            className="plist-upload-btn"
            style={{ marginLeft: 8 }}
            disabled={syncBusy}
            onClick={() => void runTimeEntrySync('incremental')}
          >
            Incremental sync
          </button>
        </div>
        {msg ? <p className="plist-upload-ok">{msg}</p> : null}
        {error ? <p className="plist-upload-err">{error}</p> : null}
      </div>

      {view === 'entries' ? (
        <HistoricalTimeEntriesPanel
          employeeOptions={opts.employees}
          onBack={() => setView('analytics')}
        />
      ) : (
        <>
          <div className="filters staff-filters">
            <span className="f-label">Window</span>
            <select
              value={String(preset)}
              onChange={(e) => setPreset(parsePresetSelect(e.target.value))}
            >
              <option value="billing">Current billing</option>
              <option value="custom">Custom</option>
              <option value={30}>Trailing 30 days</option>
              <option value={60}>Trailing 60 days</option>
              <option value={90}>Trailing 90 days</option>
            </select>
            <span className="staff-window-range mono">{windowRange}</span>
            {preset === 'custom' ? (
              <>
                <input
                  type="date"
                  className="staff-input"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  aria-label="From date"
                />
                <input
                  type="date"
                  className="staff-input"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  aria-label="To date"
                />
              </>
            ) : null}
            <span className="f-label">Employee</span>
            <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">All</option>
              {opts.employees.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="f-label">Phase</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="">All</option>
              {opts.phases.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="f-label">Project type</span>
            <select value={workType} onChange={(e) => setWorkType(e.target.value)}>
              <option value="">All</option>
              {WORK_TYPES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <PeriodSnapshotPanel
            title="Year to date"
            who={who}
            rangeLabel={ytdRangeLabel}
            result={ytdView}
          />

          <PeriodSnapshotPanel
            title="Current period"
            who={who}
            rangeLabel={dateRange.label}
            result={periodView}
          />

          {period.summary.entriesLoaded === 0 ? (
            <div className="panel staff-stale" style={{ maxWidth: 'none', marginBottom: 12 }}>
              <p className="plist-empty" style={{ margin: 0 }}>
                No time entries in this window. Import historical entries or widen the range. Use{' '}
                <strong>Raw time entries</strong> to inspect the table directly.
              </p>
            </div>
          ) : null}

          <div className="panel">
            <h3>
              Who is working <span className="tag">{period.employees.length}</span>
            </h3>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Total h</th>
                    <th className="num">Billable</th>
                    <th className="num">Pace</th>
                    <th className="num">Avg h/proj</th>
                    <th>Phases</th>
                    <th>Activity</th>
                    <th>Projects</th>
                  </tr>
                </thead>
                <tbody>
                  {period.employees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="plist-empty">
                        No employees match these filters.
                      </td>
                    </tr>
                  ) : (
                    period.employees.map((e) => (
                      <tr
                        key={e.employeeName}
                        className={selected === e.employeeName ? 'staff-row-on' : undefined}
                        onClick={() => setSelected(e.employeeName)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>{e.employeeName}</td>
                        <td className="num">{e.totalHours.toFixed(0)}</td>
                        <td className="num">{e.billableHours.toFixed(0)}</td>
                        <td className="num">{e.weeklyPace.toFixed(1)}</td>
                        <td className="num">{e.avgHoursPerProject.toFixed(0)}</td>
                        <td>
                          <ShareBars slices={e.topPhases} max={3} tone="teal" />
                        </td>
                        <td>
                          <ShareBars slices={e.topActivities} max={3} tone="navy" />
                        </td>
                        <td>
                          <ShareBars slices={e.topProjects} max={2} tone="gold" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRow ? (
            <EmployeeHistoryDetail row={selectedRow} onClose={() => setSelected(null)} />
          ) : null}
        </>
      )}
    </section>
  );
}

function EmployeeHistoryDetail({
  row,
  onClose,
}: {
  row: EmployeeHistoryRow;
  onClose: () => void;
}) {
  const phaseChart = {
    labels: row.topPhases.map((p) => p.label),
    values: row.topPhases.map((p) => p.hours),
  };
  const projectChart = {
    labels: row.topProjects.map((p) =>
      p.label.length > 28 ? `${p.label.slice(0, 27)}…` : p.label,
    ),
    values: row.topProjects.map((p) => p.hours),
  };
  return (
    <div className="staff-drawer panel">
      <div className="exec-load-head">
        <h3>
          {row.employeeName} <span className="tag">Observed history</span>
        </h3>
        <button type="button" className="signout-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <KpiRow
        items={[
          { k: 'Total hours', v: row.totalHours.toFixed(1), cls: 'accent-teal' },
          { k: 'Billable', v: row.billableHours.toFixed(1), cls: 'accent-gold' },
          { k: 'Pace', v: `${row.weeklyPace.toFixed(1)} h/wk` },
          { k: 'Avg h / project', v: row.avgHoursPerProject.toFixed(0) },
          { k: 'Avg h / phase', v: row.avgHoursPerPhase.toFixed(0) },
          { k: 'Projects', v: String(row.projectCount) },
          { k: 'Phases', v: String(row.phaseCount) },
        ]}
      />

      <div className="staff-avg-grid" style={{ marginBottom: 12 }}>
        <div className="staff-avg-card">
          <h4>Phase mix</h4>
          <ShareBars slices={row.topPhases} max={6} tone="teal" showHours />
        </div>
        <div className="staff-avg-card">
          <h4>Activity mix</h4>
          <ShareBars slices={row.topActivities} max={6} tone="navy" showHours />
        </div>
        <div className="staff-avg-card">
          <h4>Project type</h4>
          <ShareBars slices={row.workTypes} max={6} tone="gold" showHours />
        </div>
        <div className="staff-avg-card">
          <h4>Top projects</h4>
          <ShareBars slices={row.topProjects} max={6} tone="teal" showHours />
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <h4 className="exec-load-sub">Hours by phase</h4>
          <div className="chart-wrap tall">
            {phaseChart.labels.length ? (
              <HoursHBar labels={phaseChart.labels} values={phaseChart.values} />
            ) : (
              <div className="plist-empty">No phase hours</div>
            )}
          </div>
        </div>
        <div>
          <h4 className="exec-load-sub">Hours by project</h4>
          <div className="chart-wrap tall">
            {projectChart.labels.length ? (
              <HoursHBar labels={projectChart.labels} values={projectChart.values} />
            ) : (
              <div className="plist-empty">No project hours</div>
            )}
          </div>
        </div>
      </div>

      <h4 className="exec-load-sub">Activity / specialty mix</h4>
      <div className="chart-wrap" style={{ height: 220 }}>
        {row.topActivities.length ? (
          <HoursHBar
            labels={row.topActivities.map((a) => a.label)}
            values={row.topActivities.map((a) => a.hours)}
          />
        ) : (
          <div className="plist-empty">No activity breakdown</div>
        )}
      </div>

      <h4 className="exec-load-sub">Project size &amp; phase detail</h4>
      <div className="table-scroll staff-te-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Phase</th>
              <th>Type</th>
              <th className="num">Hours</th>
              <th className="num">Billable</th>
              <th className="num">Entries</th>
              <th>First</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {row.projects.slice(0, 40).map((p) => (
              <tr key={`${p.project}-${p.phase}`}>
                <td>{p.project}</td>
                <td>{p.client || '—'}</td>
                <td>
                  {p.phaseCode !== '—' ? `${p.phaseCode}` : ''}
                  {p.phase && p.phase !== p.phaseCode ? ` · ${p.phase}` : p.phase || '—'}
                </td>
                <td>{p.workType}</td>
                <td className="num">{p.hours.toFixed(1)}</td>
                <td className="num">{p.billableHours.toFixed(1)}</td>
                <td className="num">{p.entries}</td>
                <td className="mono">{p.firstDate}</td>
                <td className="mono">{p.lastDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoricalTimeEntriesPanel({
  employeeOptions,
  onBack,
}: {
  employeeOptions: string[];
  onBack: () => void;
}) {
  const [fromDate, setFromDate] = useState(() => daysAgoYmd(30));
  const [toDate, setToDate] = useState(() => ymd(new Date()));
  const [employee, setEmployee] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [billable, setBillable] = useState<'all' | 'billable' | 'non_billable'>('all');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TimeEntryLite[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    entries: number;
    hours: number;
    billableHours: number;
    employees: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pageRes, statsRes] = await Promise.all([
        loadHistoricalTimeEntries({
          fromDate,
          toDate,
          employee: employee || undefined,
          projectQuery: projectQuery || undefined,
          billable,
          page,
          pageSize: 50,
        }),
        loadHistoricalTimeEntryStats(fromDate, toDate),
      ]);
      if (pageRes.error) setError(pageRes.error);
      if (statsRes.error) setError(statsRes.error);
      setRows(pageRes.rows);
      setTotal(pageRes.total);
      setPageSize(pageRes.pageSize);
      setStats({
        entries: statsRes.entries,
        hours: statsRes.hours,
        billableHours: statsRes.billableHours,
        employees: statsRes.employees,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load time entries');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, employee, projectQuery, billable, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="exec-load-head">
        <h3>
          Raw time entries <span className="tag">pa_time_entries</span>
        </h3>
        <button type="button" className="signout-btn" onClick={onBack}>
          Back to analytics
        </button>
      </div>

      <div className="filters staff-filters">
        <span className="f-label">From</span>
        <input
          className="staff-input"
          type="date"
          value={fromDate}
          onChange={(e) => {
            setPage(0);
            setFromDate(e.target.value);
          }}
        />
        <span className="f-label">To</span>
        <input
          className="staff-input"
          type="date"
          value={toDate}
          onChange={(e) => {
            setPage(0);
            setToDate(e.target.value);
          }}
        />
        <span className="f-label">Employee</span>
        <select
          value={employee}
          onChange={(e) => {
            setPage(0);
            setEmployee(e.target.value);
          }}
        >
          <option value="">All</option>
          {employeeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="f-label">Billable</span>
        <select
          value={billable}
          onChange={(e) => {
            setPage(0);
            setBillable(e.target.value as 'all' | 'billable' | 'non_billable');
          }}
        >
          <option value="all">All</option>
          <option value="billable">Billable</option>
          <option value="non_billable">Non-billable</option>
        </select>
        <span className="f-label">Project / client</span>
        <input
          className="staff-input"
          value={projectQuery}
          placeholder="Search…"
          onChange={(e) => {
            setPage(0);
            setProjectQuery(e.target.value);
          }}
        />
        <button type="button" className="plist-upload-btn" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {stats ? (
        <KpiRow
          items={[
            { k: 'Entries in range', v: String(stats.entries), cls: 'accent-teal' },
            { k: 'Total hours', v: stats.hours.toFixed(1) },
            { k: 'Billable hours', v: stats.billableHours.toFixed(1), cls: 'accent-gold' },
            { k: 'Employees', v: String(stats.employees) },
          ]}
        />
      ) : null}

      {error ? <p className="plist-upload-err">{error}</p> : null}
      {loading ? <p className="pd-muted">Loading time entries…</p> : null}

      <div className="table-scroll staff-te-scroll" style={{ maxHeight: 480 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Client</th>
              <th>Project</th>
              <th>Phase</th>
              <th>Activity</th>
              <th className="num">Hours</th>
              <th>Billable</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="plist-empty">
                  No time entries in this range.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.work_date}</td>
                  <td>{e.employee_name || '—'}</td>
                  <td>{e.client || '—'}</td>
                  <td>{e.parent_project_name || e.project_name || '—'}</td>
                  <td>{e.phase_name || e.phase || '—'}</td>
                  <td>{e.activity || '—'}</td>
                  <td className="num">{Number(e.actual_hours).toFixed(2)}</td>
                  <td>{e.is_billable ? 'Y' : 'N'}</td>
                  <td className="staff-working">
                    {(e.description || e.memo || '').slice(0, 100)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="plist-upload-row" style={{ marginTop: 10, gap: 8 }}>
        <button
          type="button"
          className="plist-upload-btn"
          disabled={page <= 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Previous
        </button>
        <span className="pd-muted mono">
          Page {page + 1} / {pageCount} · {total.toLocaleString()} rows
        </span>
        <button
          type="button"
          className="plist-upload-btn"
          disabled={page + 1 >= pageCount || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
