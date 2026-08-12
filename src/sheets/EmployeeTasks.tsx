import { useEffect, useMemo, useState } from 'react';
import { AddScheduleTaskForm } from '../components/AddScheduleTaskForm';
import { ScheduleDateInput } from '../components/ScheduleDateInput';
import { useDemoMode } from '../hooks/useDemoMode';
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
import { ensureProjectSchedule } from '../lib/scheduleEnsure';
import {
  deleteScheduleRow,
  phaseTitlesFromRows,
  renameScheduleTask,
  setScheduleRowDates,
} from '../lib/scheduleMutations';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { parseScheduleDate } from '../lib/scheduleDates';

type StatusView = 'open' | 'all' | 'mine' | 'done';

const SORT_COLS: { key: TaskSortKey; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'phase', label: 'Phase' },
  { key: 'complete', label: '' },
  { key: 'priority', label: 'Priority' },
  { key: 'task', label: 'Task' },
  { key: 'start', label: 'Start' },
  { key: 'due', label: 'Due' },
  { key: 'end', label: 'End' },
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
  active = true,
}: {
  projects: (ProjectNode & { clientName: string })[];
  employeeName: string;
  onOpenProject?: (projectKey: string) => void;
  active?: boolean;
}) {
  const isDemo = useDemoMode();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedDemo, setUsedDemo] = useState(false);
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [sortKey, setSortKey] = useState<TaskSortKey>('due');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<StatusView>('open');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addProjectKey, setAddProjectKey] = useState('');
  const [addMeta, setAddMeta] = useState<{
    scheduleId: string;
    phases: string[];
    rows: ScheduleRow[];
  } | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const projectsKey = useMemo(() => projects.map((p) => p.key).join('|'), [projects]);

  async function refresh() {
    const res = await loadEmployeeTasks(projects, employeeName, { allowDemoSeed: isDemo });
    setTasks(res.tasks);
    setUsedDemo(res.usedDemo);
  }

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading((prev) => (tasks.length ? prev : true));
    setError(null);
    void (async () => {
      try {
        const res = await loadEmployeeTasks(projects, employeeName, { allowDemoSeed: isDemo });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when shown / book changes
  }, [active, projectsKey, employeeName, isDemo]);

  useEffect(() => {
    if (!adding) return;
    const key = addProjectKey || projects[0]?.key || '';
    if (!key) return;
    if (addProjectKey !== key) setAddProjectKey(key);
    const project = projects.find((p) => p.key === key);
    if (!project) return;
    let cancelled = false;
    setAddBusy(true);
    void ensureProjectSchedule({
      projectKey: project.key,
      clientName: project.clientName,
      title: project.title,
    }).then((ensured) => {
      if (cancelled) return;
      setAddMeta({
        scheduleId: ensured.meta?.id || '',
        phases: phaseTitlesFromRows(ensured.rows),
        rows: ensured.rows,
      });
      setAddBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [adding, addProjectKey, projects]);

  function toggleSort(key: TaskSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
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
    if (busyId || !task.writable) return;
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

  async function onRename(task: EmployeeTask, name: string) {
    if (!task.writable || name.trim() === task.task) return;
    setBusyId(task.id);
    const res = await renameScheduleTask({
      projectKey: task.projectKey,
      rowId: task.rowId,
      task: name,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, task: name.trim() } : t)),
    );
  }

  async function onDateChange(
    task: EmployeeTask,
    field: 'target_start' | 'target_end',
    value: string,
  ) {
    if (!task.writable) return;
    setBusyId(task.id);
    setError(null);
    const res = await setScheduleRowDates({
      projectKey: task.projectKey,
      rowId: task.rowId,
      targetStart: field === 'target_start' ? value : undefined,
      targetEnd: field === 'target_end' ? value : undefined,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const parsed = parseScheduleDate(value);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== task.id) return t;
        if (field === 'target_start') {
          return { ...t, startRaw: value, start: parsed };
        }
        return { ...t, dueRaw: value, due: parsed };
      }),
    );
  }

  async function onDelete(task: EmployeeTask) {
    if (!task.writable || busyId) return;
    if (!window.confirm(`Delete “${task.task}”?`)) return;
    setBusyId(task.id);
    const res = await deleteScheduleRow({
      projectKey: task.projectKey,
      rowId: task.rowId,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  }

  return (
    <div className="emp-tasks">
      <header className="emp-hero emp-hero-row">
        <div>
          <p className="pd-kicker">My tasks</p>
          <h1 className="display">Task schedule</h1>
          <p className="emp-lede">
            Create tasks, edit names and deadlines, and check work off across your assigned
            projects.
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
        </div>
      </header>

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
          {addBusy || !addMeta?.scheduleId ? (
            <p className="pd-muted">Preparing schedule…</p>
          ) : (
            <AddScheduleTaskForm
              projectKey={addProjectKey}
              scheduleId={addMeta.scheduleId}
              phaseOptions={addMeta.phases}
              rows={addMeta.rows}
              onCancel={() => setAdding(false)}
              onCreated={() => {
                setAdding(false);
                void refresh();
              }}
            />
          )}
        </div>
      ) : null}

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
            No schedule tasks yet. Use <strong>Add task</strong> or open a project to build the list.
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
                  <th className="col-actions">
                    <span className="visually-hidden">Actions</span>
                  </th>
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
                          disabled={!t.writable || busyId === t.id}
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
                        {t.writable ? (
                          <input
                            type="text"
                            className="emp-task-name-input"
                            defaultValue={t.task}
                            key={`${t.id}:${t.task}`}
                            disabled={busyId === t.id}
                            aria-label="Task name"
                            onBlur={(e) => void onRename(t, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />
                        ) : (
                          <span className="emp-task-text">{t.task}</span>
                        )}
                        {t.kind === 'subtask' ? (
                          <span className="emp-task-kind mono">subtask</span>
                        ) : null}
                      </td>
                      <td>
                        {t.writable ? (
                          <ScheduleDateInput
                            value={t.startRaw}
                            disabled={busyId === t.id}
                            ariaLabel={`Start date for ${t.task}`}
                            onCommit={(v) => void onDateChange(t, 'target_start', v)}
                          />
                        ) : (
                          <span className="mono">{t.startRaw || '—'}</span>
                        )}
                      </td>
                      <td>
                        {t.writable ? (
                          <ScheduleDateInput
                            value={t.dueRaw}
                            disabled={busyId === t.id}
                            ariaLabel={`Due date for ${t.task}`}
                            onCommit={(v) => void onDateChange(t, 'target_end', v)}
                          />
                        ) : (
                          <span className="mono">{t.dueRaw || '—'}</span>
                        )}
                      </td>
                      <td className="mono">{t.endRaw || '—'}</td>
                      <td>
                        <span
                          className={`emp-task-status ${t.complete ? 'complete' : 'incomplete'}`}
                        >
                          {t.complete ? 'Complete' : 'Incomplete'}
                        </span>
                      </td>
                      <td className="col-actions">
                        {t.writable ? (
                          <button
                            type="button"
                            className="emp-task-delete"
                            disabled={busyId === t.id}
                            title="Delete task"
                            aria-label={`Delete ${t.task}`}
                            onClick={() => void onDelete(t)}
                          >
                            ×
                          </button>
                        ) : null}
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
