import { useEffect, useMemo, useRef, useState } from 'react';
import { loadProjectSchedule } from '../lib/loadProjectSchedule';
import { startOfDay } from '../lib/scheduleDates';
import {
  barLeftPct,
  barWidthPct,
  buildGanttBars,
  daysBetween,
  ganttTicks,
  ganttTimelineBounds,
  type GanttFilter,
} from '../lib/scheduleGantt';

function fmtShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ScheduleGantt({
  projectKey,
  highlightPhase,
}: {
  projectKey: string;
  highlightPhase?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GanttFilter>('all');
  const [scale, setScale] = useState<'week' | 'month'>('month');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadProjectSchedule>>['rows']>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const todaySynced = useRef('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const res = await loadProjectSchedule(projectKey);
      if (cancelled) return;
      if (res.error) setError(res.error);
      setRows(res.rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  const bars = useMemo(() => buildGanttBars(rows, filter), [rows, filter]);
  const bounds = useMemo(() => ganttTimelineBounds(bars), [bars]);
  const totalDays = bounds ? Math.max(daysBetween(bounds.start, bounds.end), 1) : 1;
  const ticks = useMemo(
    () => (bounds ? ganttTicks(bounds.start, bounds.end, scale) : []),
    [bounds, scale],
  );

  const today = startOfDay(new Date());
  const todayPct =
    bounds && today.getTime() >= bounds.start.getTime() && today.getTime() <= bounds.end.getTime()
      ? barLeftPct(today, bounds.start, totalDays)
      : null;

  // Scroll today into view once per project load
  useEffect(() => {
    if (!bounds || todayPct == null || !scrollerRef.current) return;
    const key = `${projectKey}|${bounds.start.toISOString()}`;
    if (todaySynced.current === key) return;
    todaySynced.current = key;
    const el = scrollerRef.current;
    const timeline = el.querySelector('.gantt-timeline') as HTMLElement | null;
    if (!timeline) return;
    const x = (todayPct / 100) * timeline.scrollWidth - el.clientWidth * 0.35;
    el.scrollLeft = Math.max(0, x);
  }, [bounds, todayPct, projectKey]);

  const highlighted = useMemo(() => {
    const needle = (highlightPhase || '').trim().toLowerCase();
    if (!needle) return null;
    return bars.find(
      (b) =>
        b.kind === 'phase' &&
        (b.label.toLowerCase().includes(needle) ||
          needle.includes(b.label.toLowerCase().split(' ')[0] || '')),
    )?.id;
  }, [bars, highlightPhase]);

  const pxPerDay = scale === 'week' ? 18 : 8;
  const timelineWidth = bounds ? Math.max(totalDays * pxPerDay, 640) : 640;

  return (
    <div className="gantt">
      <div className="gantt-toolbar">
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
              className={filter === id ? 'on' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="exec-toggle" role="group" aria-label="Gantt scale">
          <button
            type="button"
            className={scale === 'month' ? 'on' : ''}
            onClick={() => setScale('month')}
          >
            Month
          </button>
          <button
            type="button"
            className={scale === 'week' ? 'on' : ''}
            onClick={() => setScale('week')}
          >
            Week
          </button>
        </div>
      </div>

      {loading ? <div className="plist-empty">Loading schedule…</div> : null}
      {error ? <div className="plist-upload-err">{error}</div> : null}
      {!loading && !error && !bars.length ? (
        <div className="plist-empty">
          No dated tasks or subtasks on this schedule yet. Add target dates in the schedule below.
        </div>
      ) : null}

      {!loading && bars.length && bounds ? (
        <div className="gantt-scroll" ref={scrollerRef}>
          <div className="gantt-frame" style={{ minWidth: 220 + timelineWidth }}>
            <div className="gantt-head">
              <div className="gantt-label-col mono">Task</div>
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
              {bars.map((bar) => {
                const left = barLeftPct(bar.start, bounds.start, totalDays);
                const width = Math.max(barWidthPct(bar.start, bar.end, totalDays), 0.6);
                const hi = highlighted === bar.id;
                return (
                  <div
                    key={bar.id}
                    className={`gantt-row depth-${bar.depth} kind-${bar.kind}${hi ? ' highlight' : ''}`}
                  >
                    <div className="gantt-label-col" title={bar.section}>
                      <span className={`gantt-kind-tag ${bar.kind}`}>
                        {bar.kind === 'phase' ? 'Ph' : bar.kind === 'task' ? 'Tk' : 'Sub'}
                      </span>
                      <span className="gantt-label-text">{bar.label}</span>
                    </div>
                    <div className="gantt-timeline" style={{ width: timelineWidth }}>
                      {ticks
                        .filter((t) => t.major)
                        .map((t) => (
                          <div
                            key={`grid-${bar.id}-${t.date.toISOString()}`}
                            className="gantt-gridline"
                            style={{ left: `${barLeftPct(t.date, bounds.start, totalDays)}%` }}
                          />
                        ))}
                      {todayPct != null ? (
                        <div className="gantt-today-line" style={{ left: `${todayPct}%` }} />
                      ) : null}
                      {bar.milestone ? (
                        <div
                          className={`gantt-milestone tone-${bar.tone}`}
                          style={{ left: `${left}%` }}
                          title={`${bar.label} · ${fmtShort(bar.start)}${bar.status ? ` · ${bar.status}` : ''}`}
                        />
                      ) : (
                        <div
                          className={`gantt-bar tone-${bar.tone}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${bar.label}\n${fmtShort(bar.start)} → ${fmtShort(bar.end)}${bar.status ? `\n${bar.status}` : ''}`}
                        >
                          <span className="gantt-bar-label">
                            {bar.kind === 'phase' ? bar.label : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="gantt-legend mono">
        <span className="gantt-legend-item">
          <i className="gantt-swatch tone-active" /> Active
        </span>
        <span className="gantt-legend-item">
          <i className="gantt-swatch tone-done" /> Completed
        </span>
        <span className="gantt-legend-item">
          <i className="gantt-swatch tone-date" /> Dated / TBD
        </span>
        <span className="gantt-legend-item">
          <i className="gantt-swatch tone-idle" /> Idle
        </span>
        <span className="gantt-legend-item">
          <i className="gantt-milestone-lg" /> Deadline
        </span>
        {todayPct != null ? (
          <span className="gantt-legend-item">
            <i className="gantt-today-swatch" /> Today
          </span>
        ) : null}
      </div>
    </div>
  );
}
