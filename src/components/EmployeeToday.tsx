import { useEffect, useMemo, useState } from 'react';
import { KpiRow } from './KpiRow';
import { useDemoMode } from '../hooks/useDemoMode';
import {
  loadEmployeeAgenda,
  type AgendaItem,
} from '../lib/employeeAgenda';
import {
  isProjectLead,
  type ProjectMemberRole,
} from '../lib/projectMembers';
import type { ProjectNode } from '../lib/projectListHierarchy';
import { startOfDay } from '../lib/scheduleDates';

type ProjectWithClient = ProjectNode & { clientName: string };

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function EmployeeToday({
  projects,
  employeeName,
  memberRoles,
  isPm,
  onOpenProject,
  onGoTasks,
  onGoCalendar,
  onGoTimecard,
  onGoProjects,
}: {
  projects: ProjectWithClient[];
  employeeName: string;
  memberRoles: Map<string, ProjectMemberRole>;
  isPm: boolean;
  onOpenProject: (key: string) => void;
  onGoTasks: () => void;
  onGoCalendar: () => void;
  onGoTimecard: () => void;
  onGoProjects: () => void;
}) {
  const isDemo = useDemoMode();
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const today = useMemo(() => startOfDay(new Date()), []);
  const weekEnd = useMemo(() => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + 7);
    return d;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await loadEmployeeAgenda(projects, employeeName, {
        allowDemoSeed: isDemo,
      });
      if (cancelled) return;
      setItems(res.items.filter((i) => i.kind !== 'meeting'));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projects, employeeName, isDemo]);

  const overdue = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.date.getTime() < today.getTime() && !/completed|n\/a/i.test(i.status || ''),
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 8),
    [items, today],
  );

  const dueSoon = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.date.getTime() >= today.getTime() &&
            i.date.getTime() <= weekEnd.getTime() &&
            !/completed|n\/a/i.test(i.status || ''),
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .slice(0, 8),
    [items, today, weekEnd],
  );

  const dueToday = useMemo(
    () => dueSoon.filter((i) => sameDay(i.date, today)),
    [dueSoon, today],
  );

  const leadCount = useMemo(
    () =>
      projects.filter((p) => isProjectLead(p, employeeName, memberRoles.get(p.key) || null))
        .length,
    [projects, employeeName, memberRoles],
  );

  return (
    <div className="emp-today">
      <header className="emp-hero emp-hero-row">
        <div>
          <p className="pd-kicker">{isPm ? 'Today · Project lead' : 'Today · Workspace'}</p>
          <h1 className="display">Good focus, {employeeName.split(/\s+/)[0] || employeeName}</h1>
          <p className="emp-lede">
            {isPm
              ? `You lead ${leadCount} project${leadCount === 1 ? '' : 's'}. Start with overdue work, then today’s deadlines.`
              : 'Overdue items, due-soon deadlines, and quick jumps into tasks and calendar.'}
          </p>
        </div>
        <div className="emp-today-actions">
          <button type="button" className="emp-primary-btn" onClick={onGoTasks}>
            My tasks
          </button>
          <button type="button" className="cp-text-btn" onClick={onGoCalendar}>
            Calendar
          </button>
          <button type="button" className="cp-text-btn" onClick={onGoTimecard}>
            Timecard
          </button>
          <button type="button" className="cp-text-btn" onClick={onGoProjects}>
            Projects
          </button>
        </div>
      </header>

      <KpiRow
        className="emp-kpi-row"
        items={[
          { k: 'Overdue', v: String(overdue.length), cls: overdue.length ? 'accent-gold' : undefined },
          { k: 'Due today', v: String(dueToday.length), cls: 'accent-teal' },
          { k: 'Next 7 days', v: String(dueSoon.length) },
          { k: 'Active projects', v: String(projects.length) },
          ...(isPm ? [{ k: 'Leading', v: String(leadCount) }] : []),
        ]}
      />

      {loading ? <p className="pd-muted">Loading today’s work…</p> : null}

      <div className="grid grid-2 emp-today-grid">
        <section className="panel">
          <h3>
            Overdue <span className="tag">{overdue.length}</span>
          </h3>
          {!loading && !overdue.length ? (
            <p className="pd-muted">Nothing overdue. Nice.</p>
          ) : (
            <ul className="emp-agenda-list">
              {overdue.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                    <span className="emp-agenda-kind deadline">{fmtShort(i.date)}</span>
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
            Due in 7 days <span className="tag">{dueSoon.length}</span>
          </h3>
          {!loading && !dueSoon.length ? (
            <p className="pd-muted">No dated work in the next week.</p>
          ) : (
            <ul className="emp-agenda-list">
              {dueSoon.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpenProject(i.projectKey)}>
                    <span className={`emp-agenda-kind ${sameDay(i.date, today) ? 'deadline' : 'task'}`}>
                      {sameDay(i.date, today) ? 'Today' : fmtShort(i.date)}
                    </span>
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
      </div>
    </div>
  );
}
