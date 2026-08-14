import { useEffect, useMemo, useRef, useState } from 'react';
import { ScheduleDateInput } from './ScheduleDateInput';
import {
  filterEmployeeGanttBars,
  groupEmployeeGanttByPhase,
  loadEmployeeGantt,
  rangeIntersects,
  type EmployeeGanttBar,
} from '../lib/employeeGantt';
import {
  barLeftPct,
  barWidthPct,
  currentMonthBounds,
  daysBetween,
  ganttTicks,
  upcomingWeekBounds,
  type GanttFilter,
  type GanttTickScale,
} from '../lib/scheduleGantt';
import {
  formatScheduleDate,
  fromDateInputValue,
  setScheduleRowDates,
  toDateInputValue,
} from '../lib/scheduleMutations';
import { parseScheduleDate, startOfDay } from '../lib/scheduleDates';
import type { ProjectNode } from '../lib/projectListHierarchy';

type RangeMode = 'week' | 'month' | 'custom';

function fmtShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Clamp a bar into the visible window; null if fully outside. */
function visibleSpan(
  start: Date,
  end: Date,
  winStart: Date,
  winEnd: Date,
): { start: Date; end: Date } | null {
  if (!rangeIntersects(start, end, winStart, winEnd)) return null;
  const s = start.getTime() < winStart.getTime() ? winStart : start;
  const e = end.getTime() > winEnd.getTime() ? winEnd : end;
  return { start: s, end: e };
}

function normalizeRange(start: Date, end: Date): { start: Date; end: Date } {
  const a = startOfDay(start);
  const b = startOfDay(end);
  if (a.getTime() <= b.getTime()) return { start: a, end: b };
  return { start: b, end: a };
}

export function EmployeeGantt({
  projects,
  onOpenProject,
  initialProjectKey = '',
  reloadToken = 0,
  onDatesChanged,
}: {
  projects: (ProjectNode & { clientName: string })[];
  onOpenProject: (key: string) => void;
  /** Pre-select a project filter (e.g. from project detail). */
  initialProjectKey?: string;
  /** Bump to force reload after external edits. */
  reloadToken?: number;
  onDatesChanged?: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<GanttFilter>('all');
  const [projectKey, setProjectKey] = useState(initialProjectKey);
  const [rangeMode, setRangeMode] = useState<RangeMode>('week');
  const today = useMemo(() => startOfDay(new Date()), []);
  const weekDefault = useMemo(() => upcomingWeekBounds(today), [today]);
  const monthDefault = useMemo(() => currentMonthBounds(today), [today]);
  const [customStartYmd, setCustomStartYmd] = useState(() =>
    toDateInputValue(weekDefault.start),
  );
  const [customEndYmd, setCustomEndYmd] = useState(() => toDateInputValue(weekDefault.end));
  const [allBars, setAllBars] = useState<EmployeeGanttBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmployeeGanttBar | null>(null);
  const [saving, setSaving] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const projectsKey = useMemo(
    () => projects.map((p) => p.key).join('|'),
    [projects],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await loadEmployeeGantt(projects);
      if (cancelled) return;
      setAllBars(res.bars);
      if (res.errors.length) setError(res.errors.slice(0, 3).join(' · '));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectsKey tracks identity
  }, [projectsKey, reloadToken]);

  useEffect(() => {
    if (initialProjectKey) setProjectKey(initialProjectKey);
  }, [initialProjectKey]);

  const bars = useMemo(
    () => filterEmployeeGanttBars(allBars, { kind: kindFilter, projectKey: projectKey || undefined }),
    [allBars, kindFilter, projectKey],
  );

  const phaseRows = useMemo(() => groupEmployeeGanttByPhase(bars), [bars]);

  const bounds = useMemo(() => {
    if (rangeMode === 'week') return weekDefault;
    if (rangeMode === 'month') return monthDefault;
    const startRaw = parseScheduleDate(fromDateInputValue(customStartYmd));
    const endRaw = parseScheduleDate(fromDateInputValue(customEndYmd));
    if (!startRaw || !endRaw) return weekDefault;
    return normalizeRange(startRaw, endRaw);
  }, [rangeMode, weekDefault, monthDefault, customStartYmd, customEndYmd]);

  const visibleRows = useMemo(() => {
    if (!bounds) return [];
    return phaseRows.filter((row) =>
      rangeIntersects(row.start, row.end, bounds.start, bounds.end),
    );
  }, [phaseRows, bounds]);

  const projectsInView = useMemo(() => {
    const keys = new Set(visibleRows.map((r) => r.projectKey));
    return projects.filter((p) => keys.has(p.key) || p.key === projectKey);
  }, [projects, visibleRows, projectKey]);

  const totalDays = bounds ? Math.max(daysBetween(bounds.start, bounds.end), 1) : 1;
  const tickScale: GanttTickScale =
    rangeMode === 'custom' ? 'custom' : rangeMode === 'month' ? 'month' : 'week';
  const ticks = useMemo(
    () => (bounds ? ganttTicks(bounds.start, bounds.end, tickScale) : []),
    [bounds, tickScale],
  );
  const todayPct =
    bounds && today.getTime() >= bounds.start.getTime() && today.getTime() <= bounds.end.getTime()
      ? barLeftPct(today, bounds.start, totalDays)
      : null;

  const pxPerDay = totalDays <= 10 ? 96 : totalDays <= 40 ? 28 : 8;
  const timelineWidth = bounds ? Math.max(totalDays * pxPerDay, 560) : 720;

  function setPreset(mode: 'week' | 'month') {
    setRangeMode(mode);
    const win = mode === 'week' ? weekDefault : monthDefault;
    setCustomStartYmd(toDateInputValue(win.start));
    setCustomEndYmd(toDateInputValue(win.end));
  }

  function onCustomStart(ymd: string) {
    setCustomStartYmd(ymd);
    setRangeMode('custom');
  }

  function onCustomEnd(ymd: string) {
    setCustomEndYmd(ymd);
    setRangeMode('custom');
  }

  async function saveSelectedDates(startText: string, endText: string) {
    if (!selected || selected.kind === 'phase') return;
    setSaving(true);
    setError(null);
    const res = await setScheduleRowDates({
      projectKey: selected.projectKey,
      rowId: selected.rowId,
      targetStart: startText,
      targetEnd: endText,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSelected(null);
    onDatesChanged?.();
    const res2 = await loadEmployeeGantt(projects);
    setAllBars(res2.bars);
  }

  return (
    <div className="gantt emp-gantt">
      {selected && selected.kind !== 'phase' ? (
        <div className="emp-gantt-edit panel">
          <div>
            <p className="pd-kicker">{selected.projectTitle}</p>
            <strong>{selected.label}</strong>
          </div>
          <label>
            <span>Start</span>
            <ScheduleDateInput
              value={formatScheduleDate(selected.start)}
              disabled={saving}
              ariaLabel="Gantt start date"
              onCommit={(v) => {
                const end = formatScheduleDate(selected.end);
                void saveSelectedDates(v || end, end);
              }}
            />
          </label>
          <label>
            <span>Due / end</span>
            <ScheduleDateInput
              value={formatScheduleDate(selected.end)}
              disabled={saving}
              ariaLabel="Gantt end date"
              onCommit={(v) => {
                const start = formatScheduleDate(selected.start);
                void saveSelectedDates(start, v || start);
              }}
            />
          </label>
          <button type="button" className="cp-text-btn" onClick={() => setSelected(null)}>
            Close
          </button>
          <button
            type="button"
            className="cp-text-btn"
            onClick={() => onOpenProject(selected.projectKey)}
          >
            Open project
          </button>
        </div>
      ) : null}

      <div className="gantt-toolbar emp-gantt-toolbar">
        <label className="emp-gantt-project">
          <span className="f-label">Project</span>
          <select
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            aria-label="Filter Gantt by project"
          >
            <option value="">Projects in range ({projectsInView.length})</option>
            {projectsInView.map((p) => (
              <option key={p.key} value={p.key}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <div className="exec-toggle" role="group" aria-label="Gantt filter">
          {(
            [
              ['all', 'All'],
              ['tasks', 'Tasks'],
              ['subtasks', 'Subtasks'],
              ['deadlines', 'Deadlines'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={kindFilter === id ? 'on' : ''}
              onClick={() => setKindFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="exec-toggle" role="group" aria-label="Gantt time window">
          <button
            type="button"
            className={rangeMode === 'week' ? 'on' : ''}
            onClick={() => setPreset('week')}
          >
            This week
          </button>
          <button
            type="button"
            className={rangeMode === 'month' ? 'on' : ''}
            onClick={() => setPreset('month')}
          >
            This month
          </button>
          <button
            type="button"
            className={rangeMode === 'custom' ? 'on' : ''}
            onClick={() => setRangeMode('custom')}
          >
            Custom
          </button>
        </div>
        <div className="emp-gantt-range" role="group" aria-label="Custom date range">
          <label>
            <span className="f-label">From</span>
            <input
              type="date"
              value={customStartYmd}
              onChange={(e) => onCustomStart(e.target.value)}
            />
          </label>
          <label>
            <span className="f-label">To</span>
            <input
              type="date"
              value={customEndYmd}
              onChange={(e) => onCustomEnd(e.target.value)}
            />
          </label>
        </div>
      </div>

      {loading ? <div className="plist-empty">Loading schedule Gantt…</div> : null}
      {error ? (
        <p className="pd-muted" style={{ marginBottom: 8 }}>
          Some schedules could not be updated: {error}
        </p>
      ) : null}
      {!loading && !visibleRows.length ? (
        <div className="plist-empty">
          No dated phases overlap this range. Widen the dates or clear the project filter.
        </div>
      ) : null}

      {!loading && visibleRows.length && bounds ? (
        <div className="gantt-scroll" ref={scrollerRef}>
          <div className="gantt-frame" style={{ minWidth: 260 + timelineWidth }}>
            <div className="gantt-head">
              <div className="gantt-label-col mono">Phase</div>
              <div className="gantt-timeline" style={{ width: timelineWidth }}>
                <div className="gantt-ticks">
                  {ticks.map((t) => {
                    const left = barLeftPct(t.date, bounds.start, totalDays);
                    return (
                      <div
                        key={`${t.date.toISOString()}-${t.label}`}
                        className={`gantt-tick ${t.major ? 'major' : ''}`}
                        style={{ left: `${left}%` }}
                      >
                        <span>{t.label}</span>
                      </div>
                    );
                  })}
                </div>
                {todayPct != null ? (
                  <div className="gantt-today-line" style={{ left: `${todayPct}%` }} title="Today" />
                ) : null}
              </div>
            </div>

            <div className="gantt-body">
              {visibleRows.map((row) => (
                <div
                  key={row.id}
                  className="gantt-row depth-0 kind-phase emp-gantt-row emp-gantt-project-row"
                >
                  <button
                    type="button"
                    className="gantt-label-col emp-gantt-project-label"
                    onClick={() => onOpenProject(row.projectKey)}
                    title={`${row.projectTitle}\n${row.phaseTitle}\n${fmtShort(row.start)} → ${fmtShort(row.end)}`}
                  >
                    <span className="gantt-kind-tag phase">Ph</span>
                    <span className="gantt-label-text">
                      {row.phaseTitle}
                      <span className="emp-gantt-seg-count mono">
                        {row.projectTitle}
                        {row.segments.length ? ` · ${row.segments.length} dated` : ''}
                      </span>
                    </span>
                  </button>
                  <div className="gantt-timeline" style={{ width: timelineWidth }}>
                    {todayPct != null ? (
                      <div className="gantt-today-line" style={{ left: `${todayPct}%` }} />
                    ) : null}
                    {row.segments.map((bar) => {
                      const clipped = visibleSpan(bar.start, bar.end, bounds.start, bounds.end);
                      if (!clipped) return null;
                      const left = barLeftPct(clipped.start, bounds.start, totalDays);
                      const width = Math.max(
                        barWidthPct(clipped.start, clipped.end, totalDays),
                        0.5,
                      );
                      const hi = selected?.id === bar.id;
                      if (bar.milestone) {
                        return (
                          <button
                            key={bar.id}
                            type="button"
                            className={`gantt-milestone tone-${bar.tone} emp-gantt-seg${hi ? ' selected' : ''}`}
                            style={{ left: `${left}%` }}
                            title={`${bar.label}\n${fmtShort(bar.start)}\nClick to edit dates`}
                            onClick={() => setSelected(bar)}
                          />
                        );
                      }
                      return (
                        <button
                          key={bar.id}
                          type="button"
                          className={`gantt-bar tone-${bar.tone} emp-gantt-seg${hi ? ' selected' : ''}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${bar.label}\n${fmtShort(bar.start)} → ${fmtShort(bar.end)}\nClick to edit dates`}
                          onClick={() => setSelected(bar)}
                        >
                          <span className="gantt-bar-label">{bar.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
