import { useEffect, useMemo, useState } from 'react';
import {
  loadEmployeeAgenda,
  type AgendaItem,
  type AgendaKind,
} from '../lib/employeeAgenda';
import { useDemoMode } from '../hooks/useDemoMode';
import { monthMatrix, startOfDay } from '../lib/scheduleDates';
import type { ProjectNode } from '../lib/projectListHierarchy';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = {
  projects: (ProjectNode & { clientName: string })[];
  employeeName: string;
  onOpenProject: (key: string) => void;
};

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
  const [filter, setFilter] = useState<'all' | AgendaKind>('all');

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
  }, [projects, employeeName, isDemo]);

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
            {projects.length} assigned project{projects.length === 1 ? '' : 's'}.
          </p>
        </div>
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
      </header>

      {loading ? <p className="pd-muted">Loading your calendar…</p> : null}

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
              onClick={() => {
                const n = new Date();
                setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
                setSelected(startOfDay(n));
              }}
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
                  const shown = list.slice(0, 3);
                  const extra = list.length - shown.length;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="gridcell"
                      className={`cp-cal-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${list.length ? ' has-events' : ''}${hasOverdue ? ' overdue' : ''}`}
                      onClick={() => setSelected(startOfDay(day))}
                    >
                      <span className="cp-cal-daynum">{day.getDate()}</span>
                      {shown.length ? (
                        <span className="cp-cal-labels">
                          {shown.map((i) => (
                            <span key={i.id} className={`cp-cal-label ${i.kind}`} title={i.title}>
                              {i.kind === 'meeting' ? 'Meet' : i.kind === 'deadline' ? 'Due' : 'Task'}
                              {' · '}
                              {i.title}
                            </span>
                          ))}
                          {extra > 0 ? <span className="cp-cal-label more">+{extra} more</span> : null}
                        </span>
                      ) : null}
                    </button>
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
              <p className="pd-muted">Nothing scheduled this day.</p>
            ) : (
              <ul className="emp-agenda-list">
                {dayItems.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                      <span className={`emp-agenda-kind ${i.kind}`}>{kindLabel(i.kind)}</span>
                      <strong>{i.title}</strong>
                      <span className="mono">
                        {i.projectTitle} · {i.clientName}
                      </span>
                    </button>
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
              <ul className="emp-agenda-list">
                {overdue.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                      <span className="mono">{i.dateKey}</span>
                      <strong>{i.title}</strong>
                      <span className="mono soft">{i.projectTitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel">
            <h3>
              Upcoming meetings <span className="tag">{meetingsUpcoming.length}</span>
            </h3>
            {!meetingsUpcoming.length ? (
              <p className="pd-muted">No upcoming meetings.</p>
            ) : (
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
            )}
          </section>

          <section className="panel">
            <h3>
              Upcoming deadlines &amp; tasks <span className="tag">{workUpcoming.length}</span>
            </h3>
            {!workUpcoming.length ? (
              <p className="pd-muted">No upcoming dated work.</p>
            ) : (
              <ul className="emp-agenda-list">
                {workUpcoming.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                      <span className={`emp-agenda-kind ${i.kind}`}>{kindLabel(i.kind)}</span>
                      <span className="mono">{i.dateKey}</span>
                      <strong>{i.title}</strong>
                      <span className="mono soft">{i.projectTitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
