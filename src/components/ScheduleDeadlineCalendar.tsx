import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDeadlineEvents,
  monthMatrix,
  startOfDay,
  type DeadlineEvent,
} from '../lib/scheduleDates';
import { groupScheduleSections, statusTone } from '../lib/scheduleSections';
import type { ScheduleMeta, ScheduleRow } from '../lib/scheduleTypes';
import { supabase } from '../lib/supabase';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAYS_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDay(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function EventList({ events, empty }: { events: DeadlineEvent[]; empty: string }) {
  if (!events.length) return <p className="cp-comms-hint">{empty}</p>;
  return (
    <ul className="cp-cal-event-list">
      {events.map((e) => (
        <li key={e.id} className={`kind-${e.kind}`}>
          <span className="sec mono">{e.section}</span>
          <strong>{e.task}</strong>
          <span className="meta">
            {e.dateKey} · {e.kind}
            {e.status ? ` · ${e.status}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScheduleDeadlineCalendar({
  projectKey,
  corner = true,
  rowsOverride = null,
  layout = 'split',
}: {
  projectKey: string;
  /** Compact corner widget that expands for detail (default). */
  corner?: boolean;
  /** When set, skip Supabase and render these rows (demo / seeded data). */
  rowsOverride?: ScheduleRow[] | null;
  /** Embedded full calendar: split (grid + side lists) or calendar-only. */
  layout?: 'split' | 'calendar';
}) {
  const [rows, setRows] = useState<ScheduleRow[]>(rowsOverride || []);
  const [loading, setLoading] = useState(!rowsOverride);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState<Date>(() => startOfDay(new Date()));

  const load = useCallback(async () => {
    if (rowsOverride) {
      setRows(rowsOverride);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: scheds, error: sErr } = await supabase
      .from('pa_schedules')
      .select('id, project_key')
      .order('project_key');
    if (sErr) {
      setError(sErr.message);
      setRows([]);
      setLoading(false);
      return;
    }
    const list = (scheds || []) as Pick<ScheduleMeta, 'id' | 'project_key'>[];
    const needle = projectKey.toLowerCase();
    const hit =
      list.find((s) => s.project_key === projectKey) ||
      list.find((s) => {
        const k = s.project_key.toLowerCase();
        return k.includes(needle) || needle.includes(k);
      }) ||
      null;
    if (!hit) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error: rErr } = await supabase
      .from('pa_schedule_rows')
      .select('*')
      .eq('schedule_id', hit.id)
      .order('sort_order');
    if (rErr) {
      setError(rErr.message);
      setRows([]);
    } else {
      setRows((data || []) as ScheduleRow[]);
    }
    setLoading(false);
  }, [projectKey, rowsOverride]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const events = useMemo(() => {
    const sections = groupScheduleSections(rows);
    const map = new Map<string, string>();
    for (const s of sections) {
      for (const item of s.items) map.set(item.id, s.title);
      if (s.phaseRow) map.set(s.phaseRow.id, s.title);
    }
    return buildDeadlineEvents(rows, map).filter((e) => e.kind !== 'phase');
  }, [rows]);

  const byDay = useMemo(() => {
    const map = new Map<string, DeadlineEvent[]>();
    for (const e of events) {
      const list = map.get(e.dateKey) || [];
      list.push(e);
      map.set(e.dateKey, list);
    }
    return map;
  }, [events]);

  const weeks = useMemo(
    () => monthMatrix(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  const today = startOfDay(new Date());
  const selectedKey = dayKey(selected);
  const dayEvents = byDay.get(selectedKey) || [];

  const upcoming = useMemo(() => {
    const t = today.getTime();
    return events.filter((e) => e.date.getTime() >= t).slice(0, 16);
  }, [events, today]);

  const overdue = useMemo(() => {
    const t = today.getTime();
    return events
      .filter((e) => e.date.getTime() < t && !/completed|n\/a/i.test(e.status))
      .slice(-10)
      .reverse();
  }, [events, today]);

  const nextUp = upcoming[0] || null;
  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const monthShort = cursor.toLocaleString(undefined, { month: 'short', year: 'numeric' });

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  function openDay(day: Date) {
    setSelected(startOfDay(day));
    if (corner && !expanded) setExpanded(true);
  }

  function renderGrid(compact: boolean) {
    const labels = compact ? WEEKDAYS : WEEKDAYS_FULL;
    return (
      <div
        className={`cp-cal-grid${compact ? ' compact' : ' emp-cal-labeled'}`}
        role="grid"
        aria-label="Deadline calendar"
      >
        <div className="cp-cal-weekdays">
          {labels.map((d, i) => (
            <div key={`${d}-${i}`} className="mono">
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
                (e) => e.date.getTime() < today.getTime() && !/completed|n\/a/i.test(e.status),
              );
              const shown = list.slice(0, compact ? 2 : 3);
              const extra = list.length - shown.length;
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  className={`cp-cal-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${list.length ? ' has-events' : ''}${hasOverdue ? ' overdue' : ''}`}
                  onClick={() => openDay(day)}
                  title={list.length ? list.map((e) => e.task).join(' · ') : undefined}
                >
                  <span className="cp-cal-daynum">{day.getDate()}</span>
                  {list.length && compact ? (
                    <span className="cp-cal-dots" aria-hidden="true">
                      {shown.map((e) => (
                        <i key={e.id} className={`dot ${statusTone(e.status)}`} />
                      ))}
                      {extra > 0 ? <span className="more">+{extra}</span> : null}
                    </span>
                  ) : null}
                  {list.length && !compact ? (
                    <span className="cp-cal-labels">
                      {shown.map((e) => (
                        <span
                          key={e.id}
                          className={`cp-cal-label ${e.kind === 'subtask' ? 'task' : 'deadline'} ${statusTone(e.status)}`}
                          title={e.task}
                        >
                          {e.kind === 'subtask' ? 'Task' : 'Due'} · {e.task}
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
    );
  }

  const detailBody = (
    <div className={`cp-cal-layout${layout === 'calendar' ? ' calendar-only' : ''}`}>
      <div>
        <div className="cp-cal-toolbar">
          <div className="cp-cal-nav">
            <button type="button" className="cp-text-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ←
            </button>
            <h3 className="display">{monthLabel}</h3>
            <button type="button" className="cp-text-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
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
            {events.length} dated task{events.length === 1 ? '' : 's'} / subtasks
          </span>
        </div>
        {renderGrid(false)}
        {layout === 'calendar' ? (
          <div className="cp-cal-day-panel emp-cal-selected">
            <p className="customer-kicker">Selected day · {formatDay(selected)}</p>
            <EventList events={dayEvents} empty="No task deadlines on this day." />
          </div>
        ) : null}
      </div>
      {layout === 'split' ? (
        <div className="cp-cal-side">
          <div className="cp-cal-day-panel">
            <p className="customer-kicker">Selected day</p>
            <h4>{formatDay(selected)}</h4>
            <EventList events={dayEvents} empty="No task deadlines on this day." />
          </div>
          {overdue.length ? (
            <div className="cp-cal-day-panel warn">
              <p className="customer-kicker">Past due</p>
              <EventList events={overdue} empty="" />
            </div>
          ) : null}
          <div className="cp-cal-day-panel">
            <p className="customer-kicker">Upcoming</p>
            <EventList events={upcoming} empty="No upcoming dated tasks on the schedule." />
          </div>
        </div>
      ) : null}
    </div>
  );

  if (loading && !rows.length) {
    return corner ? (
      <aside className="cp-cal-corner" aria-busy="true">
        <p className="cp-cal-corner-status">Loading…</p>
      </aside>
    ) : (
      <p className="cp-status">Loading deadline calendar…</p>
    );
  }

  if (error) {
    return corner ? (
      <aside className="cp-cal-corner">
        <p className="cp-cal-corner-status err">{error}</p>
      </aside>
    ) : (
      <p className="cp-status err">{error}</p>
    );
  }

  if (!corner) {
    if (!rows.length) {
      return (
        <p className="cp-comms-hint">
          No project schedule is linked yet — deadlines will appear here once tasks have target dates.
        </p>
      );
    }
    return <div className="cp-cal">{detailBody}</div>;
  }

  // Corner widget
  return (
    <>
      <aside className="cp-cal-corner" aria-label="Deadline calendar">
        <div className="cp-cal-corner-head">
          <div>
            <p className="customer-kicker">Deadlines</p>
            <strong>{monthShort}</strong>
          </div>
          <div className="cp-cal-corner-actions">
            <button type="button" className="cp-text-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ←
            </button>
            <button type="button" className="cp-text-btn" onClick={() => shiftMonth(1)} aria-label="Next month">
              →
            </button>
            <button
              type="button"
              className="cp-cal-expand-btn"
              onClick={() => setExpanded(true)}
            >
              Expand
            </button>
          </div>
        </div>

        {!rows.length ? (
          <p className="cp-cal-corner-status">No dated tasks yet</p>
        ) : (
          <>
            {renderGrid(true)}
            <div className="cp-cal-corner-foot">
              <span className="mono">
                {events.length} dated · {overdue.length ? `${overdue.length} past due` : 'on track'}
              </span>
              {nextUp ? (
                <button type="button" className="cp-cal-next" onClick={() => setExpanded(true)}>
                  Next: {nextUp.task}
                </button>
              ) : (
                <button type="button" className="cp-cal-next" onClick={() => setExpanded(true)}>
                  View all deadlines
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      {expanded ? (
        <div
          className="cp-cal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Deadline calendar detail"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExpanded(false);
          }}
        >
          <div className="cp-cal-overlay-panel">
            <div className="cp-cal-overlay-bar">
              <div>
                <p className="customer-kicker">Task &amp; subtask calendar</p>
                <strong>Deadlines for this project</strong>
              </div>
              <button type="button" className="cp-cal-expand-btn" onClick={() => setExpanded(false)}>
                Close
              </button>
            </div>
            <div className="cp-cal-overlay-body">{detailBody}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
