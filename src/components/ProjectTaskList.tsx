import { useEffect, useMemo, useState } from 'react';
import { matchProcessPhaseIndex, PROCESS_PHASES } from '../lib/architecturalProcess';
import {
  setTaskComplete,
  sortEmployeeTasks,
  tasksFromScheduleRows,
  type EmployeeTask,
} from '../lib/employeeTasks';
import type { ScheduleRow } from '../lib/scheduleTypes';

function phaseStyle(phase: string): { background: string; color: string } {
  const idx = matchProcessPhaseIndex(phase);
  if (idx >= 0) {
    const p = PROCESS_PHASES[idx]!;
    return { background: p.colorSoft, color: p.color };
  }
  return { background: '#EEF1F4', color: '#4A5568' };
}

export function ProjectTaskList({
  projectKey,
  projectTitle,
  clientName,
  employeeName,
  rows,
  writable = true,
  onRowsChange,
}: {
  projectKey: string;
  projectTitle: string;
  clientName: string;
  employeeName: string;
  rows: ScheduleRow[];
  writable?: boolean;
  /** Called after a successful checkmark so parent can refresh local rows. */
  onRowsChange?: (rows: ScheduleRow[]) => void;
}) {
  const [view, setView] = useState<'open' | 'all' | 'done'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState(rows);
  /** Phase sections start collapsed. */
  const [openPhases, setOpenPhases] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  const tasks = useMemo(
    () =>
      tasksFromScheduleRows(
        { key: projectKey, title: projectTitle, clientName },
        localRows,
        employeeName,
        writable,
      ),
    [projectKey, projectTitle, clientName, localRows, employeeName, writable],
  );

  const filtered = useMemo(() => {
    let list = tasks;
    if (view === 'open') list = list.filter((t) => !t.complete);
    else if (view === 'done') list = list.filter((t) => t.complete);
    return sortEmployeeTasks(list, 'due', 'asc');
  }, [tasks, view]);

  const byPhase = useMemo(() => {
    const map = new Map<string, EmployeeTask[]>();
    for (const t of filtered) {
      const list = map.get(t.phase) || [];
      list.push(t);
      map.set(t.phase, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => !t.complete).length;
    const done = tasks.filter((t) => t.complete).length;
    return { open, done, all: tasks.length };
  }, [tasks]);

  function togglePhase(phase: string) {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  function expandAll() {
    setOpenPhases(new Set(byPhase.map(([phase]) => phase)));
  }

  function collapseAll() {
    setOpenPhases(new Set());
  }

  async function onToggle(task: EmployeeTask) {
    if (busyId || !task.writable) return;
    setBusyId(task.id);
    setError(null);
    const next = !task.complete;
    const res = await setTaskComplete(task, next);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error || 'Could not update task');
      return;
    }
    const nextRows = localRows.map((r) =>
      r.id === task.rowId
        ? {
            ...r,
            budget_remaining: next ? 'Completed' : 'Incomplete',
            actual_end: res.endRaw,
          }
        : r,
    );
    setLocalRows(nextRows);
    onRowsChange?.(nextRows);
  }

  if (!tasks.length) {
    return <p className="pd-muted">No tasks on this project schedule yet.</p>;
  }

  return (
    <div className="emp-project-tasks">
      <div className="emp-filter-bar emp-project-tasks-bar">
        <div className="emp-status-toggle" role="group" aria-label="Task filter">
          <button
            type="button"
            className={view === 'open' ? 'on' : ''}
            onClick={() => setView('open')}
          >
            Open ({counts.open})
          </button>
          <button
            type="button"
            className={view === 'done' ? 'on' : ''}
            onClick={() => setView('done')}
          >
            Done ({counts.done})
          </button>
          <button
            type="button"
            className={view === 'all' ? 'on' : ''}
            onClick={() => setView('all')}
          >
            All ({counts.all})
          </button>
        </div>
        <div className="emp-status-toggle" role="group" aria-label="Expand phases">
          <button type="button" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" onClick={collapseAll}>
            Collapse all
          </button>
        </div>
      </div>

      <p className="pd-muted emp-project-tasks-hint">
        Phases start folded — open a phase to see and check off tasks.
      </p>

      {error ? <p className="plist-upload-err">{error}</p> : null}

      {!filtered.length ? (
        <p className="pd-muted">No tasks in this view.</p>
      ) : (
        byPhase.map(([phase, list]) => {
          const style = phaseStyle(phase);
          const expanded = openPhases.has(phase);
          const openInPhase = list.filter((t) => !t.complete).length;
          const nextDue = list.find((t) => !t.complete && t.dueRaw)?.dueRaw;
          return (
            <div
              key={phase}
              className={`emp-project-task-phase${expanded ? ' open' : ' folded'}`}
            >
              <button
                type="button"
                className="emp-project-task-phase-toggle"
                onClick={() => togglePhase(phase)}
                aria-expanded={expanded}
              >
                <span className="emp-project-task-chevron" aria-hidden>
                  {expanded ? '▾' : '▸'}
                </span>
                <span className="emp-phase-pill" style={style}>
                  {phase}
                </span>
                <span className="tag">{list.length}</span>
                <span className="emp-project-task-phase-meta mono">
                  {openInPhase ? `${openInPhase} open` : 'all done'}
                  {nextDue ? ` · next ${nextDue}` : ''}
                </span>
              </button>
              {expanded ? (
                <ul className="emp-project-task-list">
                  {list.map((t) => (
                    <li key={t.id} className={t.complete ? 'done' : ''}>
                      <label className="emp-project-task-item">
                        <input
                          type="checkbox"
                          checked={t.complete}
                          disabled={!t.writable || busyId === t.id}
                          onChange={() => void onToggle(t)}
                          aria-label={`Mark ${t.task} ${t.complete ? 'incomplete' : 'complete'}`}
                        />
                        <span className="emp-project-task-body">
                          <strong>{t.task}</strong>
                          <span className="mono soft">
                            {t.kind === 'subtask' ? 'Subtask' : 'Task'}
                            {t.dueRaw ? ` · due ${t.dueRaw}` : ''}
                            {t.startRaw ? ` · start ${t.startRaw}` : ''}
                          </span>
                        </span>
                        <span
                          className={`emp-task-status ${t.complete ? 'complete' : 'incomplete'}`}
                        >
                          {t.status}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
