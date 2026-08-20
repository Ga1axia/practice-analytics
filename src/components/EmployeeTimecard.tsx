import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoursHBar } from './Charts';
import { KpiRow } from './KpiRow';
import { TimeEntryDrillPanel, type TimeEntryDrillFilter } from './TimeEntryDrillPanel';
import { downloadCsv, toCsv } from '../lib/downloadCsv';
import { downloadKvPdf } from '../lib/downloadPdf';
import {
  loadHistoryAnalytics,
  resolveHistoryDateRange,
  type EmployeeHistoryRow,
  type HistoryDatePreset,
  type HoursSlice,
} from '../lib/staffingHistoryAnalytics';
import { abbrevGlossary, phaseAbbrev } from '../lib/phaseAbbrev';
import { daysAgoYmd, ymd } from '../lib/staffingDelivery';

/** Firm targets shown next to pace / utilization KPIs. */
const TARGET_WEEKLY_PACE = 40;
const TARGET_BILLABLE_SHARE = 0.85;

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function shortLabel(label: string): string {
  const abbr = phaseAbbrev(label);
  if (abbr && abbr !== '—') return abbr;
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

function labelTitle(label: string): string {
  const abbr = phaseAbbrev(label);
  const gloss = abbrevGlossary(abbr);
  if (gloss && abbr !== label) return `${abbr} — ${gloss} (${label})`;
  if (gloss) return `${abbr} — ${gloss}`;
  return label;
}

/** Format YYYY-MM-DD → M/D or M/D/YYYY. */
function mdLabel(iso: string, withYear: boolean): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const base = `${Number(m[2])}/${Number(m[3])}`;
  return withYear ? `${base}/${Number(m[1])}` : base;
}

function formatPresetRange(fromDate: string, toDate: string): string {
  const withYear = fromDate.slice(0, 4) !== toDate.slice(0, 4);
  return `${mdLabel(fromDate, withYear)} → ${mdLabel(toDate, withYear)}`;
}

function parsePresetSelect(value: string): HistoryDatePreset {
  if (value === 'billing' || value === 'custom') return value;
  const n = Number(value);
  if (n === 30 || n === 60 || n === 90) return n;
  return 'billing';
}

export function EmployeeTimecard({
  employeeName,
  onOpenProjectLabel,
}: {
  employeeName: string;
  /** Resolve a BQE project label to an openable portal project. */
  onOpenProjectLabel?: (projectLabel: string) => void;
}) {
  const [preset, setPreset] = useState<HistoryDatePreset>('billing');
  const [customFrom, setCustomFrom] = useState(() => daysAgoYmd(30));
  const [customTo, setCustomTo] = useState(() => ymd(new Date()));
  const [row, setRow] = useState<EmployeeHistoryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<string>('');
  const [drill, setDrill] = useState<TimeEntryDrillFilter | null>(null);

  const bounds = useMemo(
    () =>
      resolveHistoryDateRange({
        preset,
        customFrom,
        customTo,
      }),
    [preset, customFrom, customTo],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadHistoryAnalytics({
        preset,
        customFrom,
        customTo,
        employee: employeeName,
      });
      const mine =
        result.employees.find((e) => e.employeeName === employeeName) ||
        result.employees[0] ||
        null;
      setRow(mine);
      setRange(formatPresetRange(bounds.fromDate, bounds.toDate));
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
  }, [preset, customFrom, customTo, employeeName, bounds.fromDate, bounds.toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const billableShare = row && row.totalHours > 0 ? row.billableHours / row.totalHours : 0;

  function openDrill(slice: HoursSlice, kind: 'project' | 'phase' | 'activity' | 'type') {
    setDrill({
      title: `${kind === 'project' ? 'Project' : kind === 'phase' ? 'Phase' : kind === 'activity' ? 'Activity' : 'Type'}: ${slice.label}`,
      employeeName,
      fromDate: bounds.fromDate,
      toDate: bounds.toDate,
      projectQuery: kind === 'project' || kind === 'phase' ? slice.label : undefined,
      activityQuery: kind === 'activity' ? slice.label : kind === 'type' ? slice.label : undefined,
    });
  }

  function summaryKvRows(): [string, string | number][] {
    if (!row) return [];
    const rows: [string, string | number][] = [
      ['Employee', employeeName],
      ['Range', range],
      ['Total hours', row.totalHours.toFixed(1)],
      ['Billable hours', row.billableHours.toFixed(1)],
      ['Weekly pace', row.weeklyPace.toFixed(1)],
      ['Projects', row.projectCount],
    ];
    for (const p of row.topProjects) {
      rows.push([`Project · ${p.label}`, p.hours.toFixed(1)]);
    }
    for (const p of row.topPhases) {
      rows.push([`Phase · ${p.label}`, p.hours.toFixed(1)]);
    }
    for (const p of row.topActivities) {
      rows.push([`Activity · ${p.label}`, p.hours.toFixed(1)]);
    }
    return rows;
  }

  function summaryBasename() {
    return `timecard-${employeeName.replace(/\s+/g, '-').toLowerCase()}-${bounds.toDate}`;
  }

  function onExportSummaryCsv() {
    if (!row) return;
    downloadCsv(summaryBasename() + '.csv', toCsv(['Field', 'Value'], summaryKvRows()));
  }

  function onExportSummaryPdf() {
    if (!row) return;
    downloadKvPdf({
      filename: summaryBasename() + '.pdf',
      title: 'My timecard',
      subtitle: `${employeeName} · ${range}`,
      rows: summaryKvRows(),
    });
  }

  function ShareRows({
    slices,
    kind,
    fillClass,
  }: {
    slices: HoursSlice[];
    kind: 'phase' | 'activity' | 'type';
    fillClass?: string;
  }) {
    if (!slices.length) return <span className="staff-share-empty">—</span>;
    return (
      <>
        {slices.slice(0, 6).map((p) => (
          <button
            key={p.key}
            type="button"
            className="staff-share-row staff-share-row-btn"
            title={`${labelTitle(p.label)}: ${p.hours.toFixed(1)}h — click for entries`}
            onClick={() => openDrill(p, kind)}
          >
            <span className="staff-share-lab" title={labelTitle(p.label)}>
              {shortLabel(p.label)}
            </span>
            <span className="staff-share-track">
              <span
                className={`staff-share-fill${fillClass ? ` ${fillClass}` : ''}`}
                style={{ width: `${Math.max(2, Math.min(100, p.share * 100))}%` }}
              />
            </span>
            <span className="staff-share-pct">{pct(p.share)}</span>
            <span className="staff-avg-h">{p.hours.toFixed(0)}h</span>
          </button>
        ))}
      </>
    );
  }

  return (
    <div className="panel emp-timecard">
      <div className="emp-timecard-head">
        <h3>
          My timecard <span className="tag">Observed from BQE</span>
        </h3>
        <div className="emp-timecard-tools">
          <select
            className="staff-input"
            value={String(preset)}
            onChange={(e) => setPreset(parsePresetSelect(e.target.value))}
            aria-label="Timecard window"
          >
            <option value="billing">Current billing</option>
            <option value="custom">Custom</option>
            <option value={30}>Trailing 30 days</option>
            <option value={60}>Trailing 60 days</option>
            <option value={90}>Trailing 90 days</option>
          </select>
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
          <button
            type="button"
            className="cp-text-btn"
            disabled={!row}
            onClick={onExportSummaryCsv}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="cp-text-btn"
            disabled={!row}
            onClick={onExportSummaryPdf}
          >
            Export PDF
          </button>
        </div>
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
              {
                k: `Pace (target ${TARGET_WEEKLY_PACE}h/wk)`,
                v: `${row.weeklyPace.toFixed(1)} h/wk`,
              },
              {
                k: `Utilization (target ${Math.round(TARGET_BILLABLE_SHARE * 100)}%)`,
                v: pct(billableShare),
              },
              { k: 'Projects', v: String(row.projectCount) },
              { k: 'Range', v: range },
            ]}
          />
          <p className="emp-timecard-bench pd-muted">
            Pace vs {TARGET_WEEKLY_PACE}h/wk target:{' '}
            <strong>
              {row.weeklyPace >= TARGET_WEEKLY_PACE
                ? 'on / above target'
                : `${(TARGET_WEEKLY_PACE - row.weeklyPace).toFixed(1)}h below`}
            </strong>
            {' · '}
            Billable share vs {Math.round(TARGET_BILLABLE_SHARE * 100)}%:{' '}
            <strong>
              {billableShare >= TARGET_BILLABLE_SHARE
                ? 'on / above target'
                : `${Math.round((TARGET_BILLABLE_SHARE - billableShare) * 100)} pts below`}
            </strong>
            . Click any mix bar for underlying entries.
          </p>

          <div className="staff-avg-grid" style={{ marginTop: 8 }}>
            <div className="staff-avg-card">
              <h4>Phase mix</h4>
              <div className="staff-share">
                <ShareRows slices={row.topPhases} kind="phase" />
              </div>
            </div>
            <div className="staff-avg-card">
              <h4>Activity mix</h4>
              <div className="staff-share">
                <ShareRows slices={row.topActivities} kind="activity" fillClass="navy" />
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
                    fullLabels={row.topProjects.map((p) => p.label)}
                    values={row.topProjects.map((p) => p.hours)}
                    onBarClick={(idx) => {
                      const slice = row.topProjects[idx];
                      if (!slice) return;
                      if (onOpenProjectLabel) onOpenProjectLabel(slice.label);
                      else openDrill(slice, 'project');
                    }}
                  />
                ) : (
                  <div className="plist-empty">No project hours</div>
                )}
              </div>
              <p className="pd-muted" style={{ marginTop: 6, fontSize: 11 }}>
                Click a bar to open the project (or drill into entries).
              </p>
            </div>
            <div className="staff-avg-card">
              <h4>Project type</h4>
              <div className="staff-share">
                <ShareRows slices={row.workTypes} kind="type" fillClass="gold" />
              </div>
            </div>
          </div>

          {drill ? <TimeEntryDrillPanel filter={drill} onClose={() => setDrill(null)} /> : null}
        </>
      ) : null}
    </div>
  );
}
