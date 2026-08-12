import { useCallback, useEffect, useState } from 'react';
import { HoursHBar } from './Charts';
import { KpiRow } from './KpiRow';
import {
  loadHistoryAnalytics,
  type EmployeeHistoryRow,
  type HistoryWindowDays,
} from '../lib/staffingHistoryAnalytics';
import { phaseAbbrev } from '../lib/phaseAbbrev';

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function shortLabel(label: string): string {
  const abbr = phaseAbbrev(label);
  if (abbr && abbr !== '—') return abbr;
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

/** Format YYYY-MM-DD → "M/D" (no year). */
function mdLabel(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function formatWindowRange(fromDate: string | null, toDate: string | null, windowDays: HistoryWindowDays): string {
  if (fromDate && toDate) return `${mdLabel(fromDate)} → ${mdLabel(toDate)}`;
  if (windowDays === 0) return 'All history';
  return `${windowDays}d`;
}

export function EmployeeTimecard({ employeeName }: { employeeName: string }) {
  const [windowDays, setWindowDays] = useState<HistoryWindowDays>(90);
  const [row, setRow] = useState<EmployeeHistoryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadHistoryAnalytics({
        windowDays,
        employee: employeeName,
      });
      const mine =
        result.employees.find((e) => e.employeeName === employeeName) ||
        result.employees[0] ||
        null;
      setRow(mine);
      setRange(formatWindowRange(result.summary.fromDate, result.summary.toDate, windowDays));
      if (!mine && result.summary.entriesLoaded === 0) {
        setError(
          'No time entries available for your name yet. Ask an admin to import BQE time entries.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timecard');
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [windowDays, employeeName]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="panel emp-timecard">
      <div className="emp-timecard-head">
        <h3>
          My timecard <span className="tag">Observed from BQE</span>
        </h3>
        <select
          className="staff-input"
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value) as HistoryWindowDays)}
          aria-label="Timecard window"
        >
          <option value={30}>Trailing 30 days</option>
          <option value={90}>Trailing 90 days</option>
          <option value={180}>Trailing 180 days</option>
          <option value={365}>Trailing 365 days</option>
          <option value={0}>All history</option>
        </select>
      </div>

      {loading ? <p className="pd-muted">Loading your time entries…</p> : null}
      {error ? <p className="plist-upload-err">{error}</p> : null}

      {!loading && row ? (
        <>
          <KpiRow
            className="emp-kpi-row"
            items={[
              { k: 'Total hours', v: row.totalHours.toFixed(0), cls: 'accent-teal' },
              { k: 'Billable', v: row.billableHours.toFixed(0), cls: 'accent-gold' },
              { k: 'Pace', v: `${row.weeklyPace.toFixed(1)} h/wk` },
              { k: 'Projects', v: String(row.projectCount) },
              { k: 'Avg h / project', v: row.avgHoursPerProject.toFixed(0) },
              { k: 'Range', v: range },
            ]}
          />

          <div className="staff-avg-grid" style={{ marginTop: 8 }}>
            <div className="staff-avg-card">
              <h4>Phase mix</h4>
              <div className="staff-share">
                {row.topPhases.slice(0, 6).map((p) => (
                  <div key={p.key} className="staff-share-row" title={`${p.label}: ${p.hours.toFixed(1)}h`}>
                    <span className="staff-share-lab">{shortLabel(p.label)}</span>
                    <span className="staff-share-track">
                      <span
                        className="staff-share-fill"
                        style={{ width: `${Math.max(2, Math.min(100, p.share * 100))}%` }}
                      />
                    </span>
                    <span className="staff-share-pct">{pct(p.share)}</span>
                    <span className="staff-avg-h">{p.hours.toFixed(0)}h</span>
                  </div>
                ))}
                {!row.topPhases.length ? <span className="staff-share-empty">—</span> : null}
              </div>
            </div>
            <div className="staff-avg-card">
              <h4>Activity mix</h4>
              <div className="staff-share">
                {row.topActivities.slice(0, 6).map((p) => (
                  <div key={p.key} className="staff-share-row" title={`${p.label}: ${p.hours.toFixed(1)}h`}>
                    <span className="staff-share-lab">{shortLabel(p.label)}</span>
                    <span className="staff-share-track">
                      <span
                        className="staff-share-fill navy"
                        style={{ width: `${Math.max(2, Math.min(100, p.share * 100))}%` }}
                      />
                    </span>
                    <span className="staff-share-pct">{pct(p.share)}</span>
                    <span className="staff-avg-h">{p.hours.toFixed(0)}h</span>
                  </div>
                ))}
                {!row.topActivities.length ? <span className="staff-share-empty">—</span> : null}
              </div>
            </div>
            <div className="staff-avg-card">
              <h4>Top projects</h4>
              <div className="chart-wrap" style={{ height: 200 }}>
                {row.topProjects.length ? (
                  <HoursHBar
                    labels={row.topProjects.map((p) =>
                      p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label,
                    )}
                    values={row.topProjects.map((p) => p.hours)}
                  />
                ) : (
                  <div className="plist-empty">No project hours</div>
                )}
              </div>
            </div>
            <div className="staff-avg-card">
              <h4>Project type</h4>
              <div className="staff-share">
                {row.workTypes.slice(0, 6).map((p) => (
                  <div key={p.key} className="staff-share-row" title={`${p.label}: ${p.hours.toFixed(1)}h`}>
                    <span className="staff-share-lab">{shortLabel(p.label)}</span>
                    <span className="staff-share-track">
                      <span
                        className="staff-share-fill gold"
                        style={{ width: `${Math.max(2, Math.min(100, p.share * 100))}%` }}
                      />
                    </span>
                    <span className="staff-share-pct">{pct(p.share)}</span>
                    <span className="staff-avg-h">{p.hours.toFixed(0)}h</span>
                  </div>
                ))}
                {!row.workTypes.length ? <span className="staff-share-empty">—</span> : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
