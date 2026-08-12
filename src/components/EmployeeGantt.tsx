import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterEmployeeGanttBars,
  loadEmployeeGantt,
  type EmployeeGanttBar,
} from '../lib/employeeGantt';
import {
  barLeftPct,
  barWidthPct,
  daysBetween,
  ganttTicks,
  ganttTimelineBounds,
  type GanttFilter,
} from '../lib/scheduleGantt';
import { startOfDay } from '../lib/scheduleDates';
import type { ProjectNode } from '../lib/projectListHierarchy';

function fmtShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function EmployeeGantt({
  projects,
  onOpenProject,
  initialProjectKey = '',
}: {
  projects: (ProjectNode & { clientName: string })[];
  onOpenProject: (key: string) => void;
  /** Pre-select a project filter (e.g. from project detail). */
  initialProjectKey?: string;
}) {
  const [kindFilter, setKindFilter] = useState<GanttFilter>('all');
  const [projectKey, setProjectKey] = useState(initialProjectKey);
  const [scale, setScale] = useState<'week' | 'month'>('month');
  const [allBars, setAllBars] = useState<EmployeeGanttBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  }, [projectsKey]);

  useEffect(() => {
    if (initialProjectKey) setProjectKey(initialProjectKey);
  }, [initialProjectKey]);

  const bars = useMemo(
    () => filterEmployeeGanttBars(allBars, { kind: kindFilter, projectKey: projectKey || undefined }),
    [allBars, kindFilter, projectKey],
  );

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

  const pxPerDay = scale === 'week' ? 14 : 6;
  const timelineWidth = bounds ? Math.max(totalDays * pxPerDay, 720) : 720;

  return (
    <div className="gantt emp-gantt">
      <div className="gantt-toolbar emp-gantt-toolbar">
        <label className="emp-gantt-project">
          <span className="f-label">Project</span>
          <select
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            aria-label="Filter Gantt by project"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
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

      {loading ? <div className="plist-empty">Loading schedule Gantt…</div> : null}
      {error ? (
        <p className="pd-muted" style={{ marginBottom: 8 }}>
          Some schedules could not be updated: {error}
        </p>
      ) : null}
      {!loading && !bars.length ? (
        <div className="plist-empty">
          No dated work for this filter. Try another project or widen the kind filter.
        </div>
      ) : null}

      {!loading && bars.length && bounds ? (
        <div className="gantt-scroll" ref={scrollerRef}>
          <div className="gantt-frame" style={{ minWidth: 260 + timelineWidth }}>
            <div className="gantt-head">
              <div className="gantt-label-col mono">Work</div>
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
                const width = Math.max(barWidthPct(bar.start, bar.end, totalDays), 0.5);
                return (
                  <button
                    key={bar.id}
                    type="button"
                    className={`gantt-row depth-${bar.depth} kind-${bar.kind} emp-gantt-row`}
                    onClick={() => onOpenProject(bar.projectKey)}
                    title={`${bar.projectTitle}\n${bar.label}\n${fmtShort(bar.start)} → ${fmtShort(bar.end)}`}
                  >
                    <div className="gantt-label-col">
                      <span className={`gantt-kind-tag ${bar.kind}`}>
                        {bar.kind === 'phase' ? 'Ph' : bar.kind === 'task' ? 'Tk' : 'Sub'}
                      </span>
                      <span className="gantt-label-text">
                        {projectKey
                          ? bar.label.replace(`${bar.projectTitle} · `, '')
                          : bar.kind === 'phase'
                            ? bar.label
                            : `${bar.projectTitle} · ${bar.label}`}
                      </span>
                    </div>
                    <div className="gantt-timeline" style={{ width: timelineWidth }}>
                      {todayPct != null ? (
                        <div className="gantt-today-line" style={{ left: `${todayPct}%` }} />
                      ) : null}
                      {bar.milestone ? (
                        <div
                          className={`gantt-milestone tone-${bar.tone}`}
                          style={{ left: `${left}%` }}
                        />
                      ) : (
                        <div
                          className={`gantt-bar tone-${bar.tone}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <span className="gantt-bar-label">
                            {bar.kind === 'phase' && !projectKey ? bar.projectTitle : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
