import { useEffect, useMemo, useState } from 'react';
import { AddScheduleTaskForm } from '../components/AddScheduleTaskForm';
import { EmployeeGantt } from '../components/EmployeeGantt';
import { ScheduleDateInput } from '../components/ScheduleDateInput';
import {
  loadEmployeeAgenda,
  type AgendaItem,
  type AgendaKind,
} from '../lib/employeeAgenda';
import { useDemoMode } from '../hooks/useDemoMode';
import { monthMatrix, parseScheduleDate, startOfDay } from '../lib/scheduleDates';
import type { ProjectNode } from '../lib/projectListHierarchy';
import { ensureProjectSchedule } from '../lib/scheduleEnsure';
import {
  formatScheduleDate,
  phaseTitlesFromRows,
  setScheduleRowDates,
} from '../lib/scheduleMutations';
import type { ScheduleRow } from '../lib/scheduleTypes';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = {
  projects: (ProjectNode & { clientName: string })[];
  employeeName: string;
  onOpenProject: (key: string) => void;
};

type CalView = 'month' | 'gantt';

function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function kindLabel(k: AgendaKind) {
  if (k === 'meeting') return 'Meeting';
  if (k === 'deadline') return 'Deadline';
  return 'Task';
}

function padYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function EmployeeCalendar({ projects, employeeName, onOpenProject }: Props) {
  const isDemo = useDemoMode();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [usedDemo, setUsedDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set());
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | AgendaKind>('all');
  const [view, setView] = useState<CalView>('gantt');
  const [reloadTick, setReloadTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addProjectKey, setAddProjectKey] = useState('');
  const [addMeta, setAddMeta] = useState<{
    scheduleId: string;
    phases: string[];
    rows: ScheduleRow[];
  } | null>(null);

  async function reload() {
    setReloadTick((n) => n + 1);
  }

  function jumpToToday() {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    setSelected(startOfDay(n));
    setView('month');
  }

  useEffect(() => {
    function onToday() {
      jumpToToday();
    }
    window.addEventListener('pa-emp-calendar-today', onToday);
    return () => window.removeEventListener('pa-emp-calendar-today', onToday);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { items: loaded, usedDemo: demo } = await loadEmployeeAgenda(projects, employeeName, {
        allowDemoSeed: isDemo,
      });
      if (cancelled) return;
      setItems(loaded);
      setUsedDemo(demo);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projects, employeeName, isDemo, reloadTick]);

  useEffect(() => {
    if (!adding) return;
    const key = addProjectKey || projects[0]?.key || '';
    if (!key) return;
    const project = projects.find((p) => p.key === key);
    if (!project) return;
    let cancelled = false;
    void ensureProjectSchedule({
      projectKey: project.key,
      clientName: project.clientName,
      title: project.title,
      autoSeed: false,
      autoDate: false,
    }).then((ensured) => {
      if (cancelled) return;
      setAddMeta({
        scheduleId: ensured.meta?.id || '',
        phases: phaseTitlesFromRows(ensured.rows),
        rows: ensured.rows,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [adding, addProjectKey, projects]);

  async function onMoveDeadline(item: AgendaItem, scheduleText: string) {
    if (!item.rowId || item.kind === 'meeting') return;
    setBusyId(item.id);
    setError(null);
    const field = item.dateField === 'target_start' ? 'target_start' : 'target_end';
    const res = await setScheduleRowDates({
      projectKey: item.projectKey,
      rowId: item.rowId,
      targetStart: field === 'target_start' ? scheduleText : undefined,
      targetEnd: field === 'target_end' ? scheduleText : undefined,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Cascade may move many deadlines — reload agenda.
    if (field === 'target_end') {
      void reload();
      return;
    }
    const nextDate = parseScheduleDate(scheduleText);
    if (!nextDate) {
      void reload();
      return;
    }
    const key = padYmd(nextDate);
    setItems((prev) =>
      prev.map((x) =>
        x.id === item.id ? { ...x, date: nextDate, dateKey: key } : x,
      ),
    );
    setSelected(startOfDay(nextDate));
  }

  const today = startOfDay(new Date());
  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const i of filtered) {
      const list = map.get(i.dateKey) || [];
      list.push(i);
      map.set(i.dateKey, list);
    }
    return map;
  }, [filtered]);

  const weeks = useMemo(
    () => monthMatrix(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  const selectedKey = dayKey(selected);
  const dayItems = byDay.get(selectedKey) || [];

  const upcoming = useMemo(() => {
    const t = today.getTime();
    return filtered.filter((i) => i.date.getTime() >= t).slice(0, 24);
  }, [filtered, today]);

  const overdue = useMemo(() => {
    const t = today.getTime();
    return filtered
      .filter(
        (i) =>
          i.kind !== 'meeting' &&
          i.date.getTime() < t &&
          !/completed|n\/a/i.test(i.status),
      )
      .slice(-12)
      .reverse();
  }, [filtered, today]);

  const meetingsUpcoming = useMemo(
    () => upcoming.filter((i) => i.kind === 'meeting'),
    [upcoming],
  );
  const workUpcoming = useMemo(
    () => upcoming.filter((i) => i.kind !== 'meeting'),
    [upcoming],
  );

  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <div className="emp-agenda">
      <header className="emp-hero emp-hero-row">
        <div>
          <p className="pd-kicker">
            My calendar
            {usedDemo ? <span className="emp-demo-tag"> · Includes demo seed</span> : null}
          </p>
          <h1 className="display">Upcoming work</h1>
          <p className="emp-lede">
            Meetings, deadlines, and tasks across your{' '}
            {projects.length} assigned project{projects.length === 1 ? '' : 's'}. Click a day number
            or a chip to open that day; use <strong>+N more</strong> to expand hidden items. Change
            due dates inline, or add a task on the selected day.
          </p>
        </div>
        <div className="emp-cal-controls">
          <button
            type="button"
            className="emp-primary-btn"
            disabled={!projects.length}
            onClick={() => {
              setAddProjectKey(projects[0]?.key || '');
              setAdding((v) => !v);
            }}
          >
            {adding ? 'Close' : 'Add task'}
          </button>
          <div className="emp-status-toggle" role="group" aria-label="Calendar view">
            <button
              type="button"
              className={view === 'gantt' ? 'on' : ''}
              onClick={() => setView('gantt')}
            >
              Gantt
            </button>
            <button
              type="button"
              className={view === 'month' ? 'on' : ''}
              onClick={() => setView('month')}
            >
              Month
            </button>
          </div>
          {view === 'month' ? (
            <div className="emp-status-toggle" role="group" aria-label="Agenda filter">
              {(
                [
                  ['all', 'All'],
                  ['meeting', 'Meetings'],
                  ['deadline', 'Deadlines'],
                  ['task', 'Tasks'],
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
          ) : null}
        </div>
      </header>

      {error ? <p className="plist-upload-err">{error}</p> : null}

      {adding ? (
        <div className="panel emp-add-task-panel">
          <div className="emp-add-task-project">
            <label>
              <span>Project</span>
              <select
                value={addProjectKey}
                onChange={(e) => {
                  setAddProjectKey(e.target.value);
                  setAddMeta(null);
                }}
              >
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.title} — {p.clientName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!addMeta?.scheduleId ? (
            <p className="pd-muted">Preparing schedule…</p>
          ) : (
            <AddScheduleTaskForm
              projectKey={addProjectKey}
              scheduleId={addMeta.scheduleId}
              phaseOptions={addMeta.phases}
              rows={addMeta.rows}
              defaultDueYmd={padYmd(selected)}
              onCancel={() => setAdding(false)}
              onCreated={() => {
                setAdding(false);
                void reload();
              }}
            />
          )}
        </div>
      ) : null}

      {view === 'gantt' ? (
        <section className="panel emp-gantt-panel">
          <h3>
            Schedule Gantt <span className="tag">Click a bar to edit dates</span>
          </h3>
          <EmployeeGantt
            projects={projects}
            onOpenProject={onOpenProject}
            reloadToken={reloadTick}
            onDatesChanged={() => void reload()}
          />
        </section>
      ) : null}

      {view === 'month' && loading ? <p className="pd-muted">Loading your calendar…</p> : null}

      {view === 'month' ? (
      <div className="emp-agenda-layout">
        <section className="panel emp-agenda-cal">
          <div className="cp-cal-toolbar">
            <div className="cp-cal-nav">
              <button type="button" className="cp-text-btn" onClick={() => shiftMonth(-1)}>
                ←
              </button>
              <h3 className="display">{monthLabel}</h3>
              <button type="button" className="cp-text-btn" onClick={() => shiftMonth(1)}>
                →
              </button>
            </div>
            <button
              type="button"
              className="cp-text-btn"
              onClick={() => jumpToToday()}
            >
              Today
            </button>
            <span className="cp-cal-count mono">
              {filtered.length} item{filtered.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="cp-cal-grid emp-cal-labeled" role="grid" aria-label="My calendar">
            <div className="cp-cal-weekdays">
              {WEEKDAYS.map((d) => (
                <div key={d} className="mono">
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="cp-cal-week" role="row">
                {week.map((day, di) => {
                  if (!day) return <div key={`e-${di}`} className="cp-cal-cell empty" />;
                  const key = dayKey(day);
                  const list = byDay.get(key) || [];
                  const isToday = sameDay(day, today);
                  const isSelected = sameDay(day, selected);
                  const hasOverdue = list.some(
                    (i) =>
                      i.kind !== 'meeting' &&
                      i.date.getTime() < today.getTime() &&
                      !/completed|n\/a/i.test(i.status),
                  );
                  const expanded = expandedDays.has(key);
                  const shown = expanded ? list : list.slice(0, 3);
                  const extra = expanded ? 0 : list.length - shown.length;
                  return (
                    <div
                      key={key}
                      role="gridcell"
                      className={`cp-cal-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${list.length ? ' has-events' : ''}${hasOverdue ? ' overdue' : ''}`}
                    >
                      <button
                        type="button"
                        className="cp-cal-daynum-btn"
                        title="Select this day"
                        aria-label={`Select ${day.toLocaleDateString()}`}
                        onClick={() => {
                          setSelected(startOfDay(day));
                          setFocusItemId(null);
                        }}
                      >
                        <span className="cp-cal-daynum">{day.getDate()}</span>
                      </button>
                      {shown.length ? (
                        <span className="cp-cal-labels">
                          {shown.map((i) => (
                            <button
                              key={i.id}
                              type="button"
                              className={`cp-cal-label ${i.kind}${focusItemId === i.id ? ' focus' : ''}`}
                              title={`${i.title} — open day detail`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(startOfDay(day));
                                setFocusItemId(i.id);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                onOpenProject(i.projectKey);
                              }}
                            >
                              {i.kind === 'meeting' ? 'Meet' : i.kind === 'deadline' ? 'Due' : 'Task'}
                              {' · '}
                              {i.title}
                            </button>
                          ))}
                          {extra > 0 ? (
                            <button
                              type="button"
                              className="cp-cal-label more"
                              title={`Show ${extra} more on this day`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(startOfDay(day));
                                setExpandedDays((prev) => {
                                  const next = new Set(prev);
                                  next.add(key);
                                  return next;
                                });
                              }}
                            >
                              +{extra} more
                            </button>
                          ) : null}
                          {expanded && list.length > 3 ? (
                            <button
                              type="button"
                              className="cp-cal-label more"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedDays((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                });
                              }}
                            >
                              Show less
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="emp-agenda-day">
            <p className="pd-kicker">Selected day</p>
            <h4>
              {selected.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h4>
            {!dayItems.length ? (
              <p className="pd-muted">Nothing scheduled this day. Use Add task to create one.</p>
            ) : (
              <ul className="emp-agenda-list emp-agenda-list-edit">
                {dayItems.map((i) => (
                  <li key={i.id} className={focusItemId === i.id ? 'emp-agenda-focus' : undefined}>
                    <div className="emp-agenda-edit-row">
                      <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                        <span className={`emp-agenda-kind ${i.kind}`}>{kindLabel(i.kind)}</span>
                        <strong>{i.title}</strong>
                        <span className="mono">
                          {i.projectTitle} · {i.clientName}
                        </span>
                      </button>
                      {i.rowId && i.kind !== 'meeting' ? (
                        <label className="emp-agenda-date-edit">
                          <span>Move</span>
                          <ScheduleDateInput
                            value={formatScheduleDate(i.date)}
                            disabled={busyId === i.id}
                            ariaLabel={`Move deadline for ${i.title}`}
                            onCommit={(v) => void onMoveDeadline(i, v)}
                          />
                        </label>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="emp-agenda-side">
          {overdue.length ? (
            <section className="panel warn">
              <h3>
                Past due <span className="tag">{overdue.length}</span>
              </h3>
              <ul className="emp-agenda-list emp-agenda-list-edit">
                {overdue.map((i) => (
                  <li key={i.id}>
                    <div className="emp-agenda-edit-row">
                      <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                        <span className="mono">{i.dateKey}</span>
                        <strong>{i.title}</strong>
                        <span className="mono soft">{i.projectTitle}</span>
                      </button>
                      {i.rowId ? (
                        <ScheduleDateInput
                          value={formatScheduleDate(i.date)}
                          disabled={busyId === i.id}
                          ariaLabel={`Reschedule ${i.title}`}
                          onCommit={(v) => void onMoveDeadline(i, v)}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {meetingsUpcoming.length ? (
            <section className="panel">
              <h3>
                Upcoming meetings <span className="tag">{meetingsUpcoming.length}</span>
              </h3>
              <ul className="emp-agenda-list">
                {meetingsUpcoming.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                      <span className={`emp-agenda-kind meeting`}>{i.dateKey}</span>
                      <strong>{i.title}</strong>
                      <span className="mono soft">
                        {i.projectTitle} · {i.clientName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel">
            <h3>
              Upcoming deadlines &amp; tasks <span className="tag">{workUpcoming.length}</span>
            </h3>
            {!workUpcoming.length ? (
              <p className="pd-muted">No upcoming dated work.</p>
            ) : (
              <ul className="emp-agenda-list emp-agenda-list-edit">
                {workUpcoming.map((i) => (
                  <li key={i.id}>
                    <div className="emp-agenda-edit-row">
                      <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                        <span className={`emp-agenda-kind ${i.kind}`}>{kindLabel(i.kind)}</span>
                        <span className="mono">{i.dateKey}</span>
                        <strong>{i.title}</strong>
                        <span className="mono soft">{i.projectTitle}</span>
                      </button>
                      {i.rowId ? (
                        <ScheduleDateInput
                          value={formatScheduleDate(i.date)}
                          disabled={busyId === i.id}
                          ariaLabel={`Reschedule ${i.title}`}
                          onCommit={(v) => void onMoveDeadline(i, v)}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      ) : null}
    </div>
  );
}
