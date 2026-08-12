import { useEffect, useMemo, useState } from 'react';
import { StackedHoursHBar } from './Charts';
import { KpiRow } from './KpiRow';
import { matchProcessPhaseIndex, PROCESS_PHASES } from '../lib/architecturalProcess';
import { phaseAbbrev } from '../lib/phaseAbbrev';
import {
  loadProjectHoursBreakdown,
  type ProjectHoursBreakdown,
} from '../lib/projectLoggedHours';

const FALLBACK_COLORS = [
  '#146C6B',
  '#A8783A',
  '#101B2D',
  '#3A6EA5',
  '#6B4C8A',
  '#C47A5A',
  '#4C6580',
  '#8B6B8A',
  '#2E7D46',
  '#B3261E',
];

function phaseColor(label: string, index: number): string {
  const idx = matchProcessPhaseIndex(label);
  if (idx >= 0) return PROCESS_PHASES[idx]!.color;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
}

function fmtH(n: number): string {
  if (!n) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function ProjectHoursBreakdown({
  projectTitle,
  projectFullName,
  projectCode,
}: {
  projectTitle: string;
  projectFullName?: string | null;
  projectCode?: string | null;
}) {
  const [data, setData] = useState<ProjectHoursBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loadProjectHoursBreakdown({
      projectTitle,
      projectFullName,
      projectCode,
    }).then((result) => {
      if (cancelled) return;
      setData(result);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectTitle, projectFullName, projectCode]);

  const chartPeople = useMemo(() => (data?.people || []).slice(0, 14), [data]);

  const chart = useMemo(() => {
    if (!data || !chartPeople.length) return null;
    const phaseKeys = data.phaseOrder.slice(0, 8);
    return {
      labels: chartPeople.map((p) => p.name),
      series: phaseKeys.map((phase, i) => ({
        label: phaseAbbrev(phase) !== '—' ? phaseAbbrev(phase) : phase,
        values: chartPeople.map((p) => p.byPhase[phase] || 0),
        color: phaseColor(phase, i),
      })),
    };
  }, [data, chartPeople]);

  const tablePhases = (data?.phaseOrder || []).slice(0, 8);

  return (
    <div className="panel pd-hours-breakdown">
      <div className="emp-timecard-head">
        <h3>
          Hours spent <span className="tag">By person · phase · BQE</span>
        </h3>
      </div>

      {loading ? <p className="pd-muted">Loading time entries for this project…</p> : null}
      {error ? <p className="plist-upload-err">{error}</p> : null}

      {!loading && data && data.entries === 0 && !error ? (
        <p className="pd-muted">
          No time entries matched this project yet. Import BQE time entries from Staffing if
          needed.
        </p>
      ) : null}

      {!loading && data && data.entries > 0 ? (
        <>
          <KpiRow
            className="emp-kpi-row"
            items={[
              {
                k: 'Total hours',
                v: Math.round(data.totalHours).toLocaleString('en-US'),
                cls: 'accent-teal',
              },
              {
                k: 'Billable',
                v: Math.round(data.billableHours).toLocaleString('en-US'),
                cls: 'accent-gold',
              },
              { k: 'People', v: String(data.people.length) },
              { k: 'Phases', v: String(data.phases.length) },
              { k: 'Entries', v: String(data.entries) },
              {
                k: 'Billable %',
                v:
                  data.totalHours > 0
                    ? `${((data.billableHours / data.totalHours) * 100).toFixed(0)}%`
                    : '—',
              },
            ]}
          />

          <div className="pd-hours-grid">
            <div className="pd-hours-chart">
              <h4>Hours by person · stacked by phase</h4>
              {chart ? (
                <div
                  className="chart-wrap"
                  style={{ height: Math.max(220, chart.labels.length * 28 + 80) }}
                >
                  <StackedHoursHBar labels={chart.labels} series={chart.series} xTitle="Hours" />
                </div>
              ) : (
                <p className="pd-muted">No person/phase mix to chart.</p>
              )}
            </div>

            <div className="pd-hours-phase-list">
              <h4>By phase</h4>
              <div className="table-scroll pd-bottom-scroll">
                <table className="data pd-fee-table">
                  <thead>
                    <tr>
                      <th>Phase</th>
                      <th className="num">Hours</th>
                      <th className="num">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.phases.map((p) => (
                      <tr key={p.label}>
                        <td>
                          <strong>{phaseAbbrev(p.label)}</strong>
                          <span className="pd-hours-phase-full"> {p.label}</span>
                        </td>
                        <td className="num">{fmtH(p.hours)}</td>
                        <td className="num">{fmtH(p.billableHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <h4 className="pd-hours-matrix-title">Person × phase</h4>
          <div className="table-scroll pd-hours-matrix-scroll">
            <table className="data pd-fee-table pd-hours-matrix">
              <thead>
                <tr>
                  <th>Person</th>
                  {tablePhases.map((ph) => (
                    <th key={ph} className="num" title={ph}>
                      {phaseAbbrev(ph)}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Bill.</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    {tablePhases.map((ph) => (
                      <td key={ph} className="num">
                        {p.byPhase[ph] ? fmtH(p.byPhase[ph]!) : '—'}
                      </td>
                    ))}
                    <td className="num">
                      <strong>{fmtH(p.hours)}</strong>
                    </td>
                    <td className="num">{fmtH(p.billableHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
