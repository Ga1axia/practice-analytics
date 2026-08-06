import { useEffect, useMemo, useState } from 'react';
import { matchProcessPhaseIndex, PROCESS_PHASES } from '../lib/architecturalProcess';
import {
  loadEmployeeTasks,
  projectPillColor,
  saveTaskPriority,
  setTaskComplete,
  sortEmployeeTasks,
  type EmployeeTask,
  type TaskPriority,
  type TaskSortKey,
} from '../lib/employeeTasks';
import type { ProjectNode } from '../lib/projectListHierarchy';

type StatusView = 'open' | 'all' | 'mine' | 'done';

const SORT_COLS: { key: TaskSortKey; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'phase', label: 'Phase' },
  { key: 'complete', label: '' },
  { key: 'priority', label: 'Priority' },
  { key: 'task', label: 'Task' },
  { key: 'start', label: 'Start Date' },
  { key: 'due', label: 'Due Date' },
  { key: 'end', label: 'End Date' },
  { key: 'status', label: 'Status' },
];

function phasePillStyle(phase: string): { background: string; color: string } {
  const idx = matchProcessPhaseIndex(phase);
  if (idx >= 0) {
    const p = PROCESS_PHASES[idx]!;
    return { background: p.colorSoft, color: p.color };
  }
  return { background: '#EEF1F4', color: '#4A5568' };
}

function priorityClass(p: TaskPriority) {
  if (p === 'Important') return 'important';
  if (p === 'Medium') return 'medium';
  return 'low';
}

export function EmployeeTasks({
  projects,
  employeeName,
  onOpenProject,
}: {
  projects: (ProjectNode & { clientName: string })[];
  employeeName: string;
  onOpenProject?: (projectKey: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedDemo, setUsedDemo] = useState(false);
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [sortKey, setSortKey] = useState<TaskSortKey>('due');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<StatusView>('open');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await loadEmployeeTasks(projects, employeeName);
        if (cancelled) return;
        setTasks(res.tasks);
        setUsedDemo(res.usedDemo);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load tasks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projects, employeeName]);

  function toggleSort(key: TaskSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'due' || key === 'start' || key === 'end' ? 'asc' : 'asc');
    }
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (view === 'open') list = list.filter((t) => !t.complete);
    else if (view === 'done') list = list.filter((t) => t.complete);
    else if (view === 'mine') {
      list = list.filter((t) => t.mentionsEmployee && !t.complete);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.task.toLowerCase().includes(q) ||
          t.projectTitle.toLowerCase().includes(q) ||
          t.clientName.toLowerCase().includes(q) ||
          t.phase.toLowerCase().includes(q) ||
          t.status.toLowerCase().includes(q) ||
          t.priority.toLowerCase().includes(q),
      );
    }
    return sortEmployeeTasks(list, sortKey, sortDir);
  }, [tasks, view, query, sortKey, sortDir]);

  const counts = useMemo(() => {
    const open = tasks.filter((t) => !t.complete).length;
    const mine = tasks.filter((t) => t.mentionsEmployee && !t.complete).length;
    const done = tasks.filter((t) => t.complete).length;
    return { open, mine, done, all: tasks.length };
  }, [tasks]);

  async function onToggleComplete(task: EmployeeTask) {
    if (busyId) return;
    setBusyId(task.id);
    const next = !task.complete;
    const res = await setTaskComplete(task, next);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error || 'Could not update task');
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? {
              ...t,
              complete: next,
              status: next ? 'Complete' : 'Incomplete',
              endRaw: res.endRaw,
              end: next ? new Date() : null,
            }
          : t,
      ),
    );
  }

  function onPriorityChange(task: EmployeeTask, priority: TaskPriority) {
    saveTaskPriority(task.rowId, priority);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, priority } : t)));
  }

  return (
    <div className="emp-tasks">
      <header className="emp-hero emp-hero-row">
        <div>
          <p className="pd-kicker">My tasks</p>
          <h1 className="display">Task schedule</h1>
          <p className="emp-lede">
            Everything on your assigned projects — sort any column, mark complete, set priority.
          </p>
        </div>
        <div className="emp-filter-bar">
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
              className={view === 'mine' ? 'on' : ''}
              onClick={() => setView('mine')}
            >
              Mentions me ({counts.mine})
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
          <label className="emp-search">
            <span className="visually-hidden">Search tasks</span>
            <input
              type="search"
              placeholder="Search task, project, phase…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </header>

      {usedDemo ? (
        <p className="emp-tasks-note">
          Some projects use demo schedule rows until a live schedule is uploaded.
        </p>
      ) : null}
      {error ? <p className="plist-upload-err">{error}</p> : null}

      <div className="panel emp-tasks-panel">
        {loading ? (
          <div className="plist-empty">Loading your tasks…</div>
        ) : !tasks.length ? (
          <div className="plist-empty">
            No schedule tasks on your assigned projects yet. Open a project and add dates in the
            schedule.
          </div>
        ) : !filtered.length ? (
          <div className="plist-empty">No tasks match this filter.</div>
        ) : (
          <div className="emp-tasks-scroll">
            <table className="emp-tasks-table">
              <thead>
                <tr>
                  {SORT_COLS.map((col) => (
                    <th
                      key={col.key}
                      className={
                        col.key === 'complete'
                          ? 'col-check'
                          : col.key === 'task'
                            ? 'col-task'
                            : undefined
                      }
                    >
                      <button
                        type="button"
                        className={`emp-tasks-sort${sortKey === col.key ? ' on' : ''}`}
                        onClick={() => toggleSort(col.key)}
                        title={`Sort by ${col.label || 'complete'}`}
                      >
                        {col.key === 'complete' ? (
                          <span className="visually-hidden">Complete</span>
                        ) : (
                          col.label
                        )}
                        {sortKey === col.key ? (
                          <span className="emp-tasks-dir" aria-hidden>
                            {sortDir === 'asc' ? '↑' : '↓'}
                          </span>
                        ) : col.label ? (
                          <span className="emp-tasks-dir soft" aria-hidden>
                            ↕
                          </span>
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const phaseStyle = phasePillStyle(t.phase);
                  return (
                    <tr key={t.id} className={t.complete ? 'done' : ''}>
                      <td>
                        <button
                          type="button"
                          className="emp-task-project-pill"
                          style={{ background: projectPillColor(t.projectKey) }}
                          title={t.clientName}
                          onClick={() => onOpenProject?.(t.projectKey)}
                        >
                          {t.projectTitle}
                        </button>
                      </td>
                      <td>
                        <span className="emp-task-phase-pill" style={phaseStyle}>
                          {t.phase}
                        </span>
                      </td>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={t.complete}
                          disabled={busyId === t.id}
                          aria-label={`Mark ${t.task} complete`}
                          onChange={() => void onToggleComplete(t)}
                        />
                      </td>
                      <td>
                        <select
                          className={`emp-task-priority ${priorityClass(t.priority)}`}
                          value={t.priority}
                          onChange={(e) =>
                            onPriorityChange(t, e.target.value as TaskPriority)
                          }
                          aria-label={`Priority for ${t.task}`}
                        >
                          <option value="Important">Important</option>
                          <option value="Medium">Medium</option>
                          <option value="Low">Low</option>
                        </select>
                      </td>
                      <td className="col-task">
                        <span className="emp-task-text">{t.task}</span>
                        {t.kind === 'subtask' ? (
                          <span className="emp-task-kind mono">subtask</span>
                        ) : null}
                      </td>
                      <td className="mono">{t.startRaw || '—'}</td>
                      <td className="mono">{t.dueRaw || '—'}</td>
                      <td className="mono">{t.endRaw || '—'}</td>
                      <td>
                        <span
                          className={`emp-task-status ${t.complete ? 'complete' : 'incomplete'}`}
                        >
                          {t.complete ? 'Complete' : 'Incomplete'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
