import { useEffect, useMemo, useRef, useState } from 'react';
import { AddScheduleTaskForm } from './AddScheduleTaskForm';
import { ScheduleDateInput } from './ScheduleDateInput';
import { TaskEditModal } from './TaskEditModal';
import { loadProjectSchedule } from '../lib/loadProjectSchedule';
import { matchProcessPhaseIndex, PROCESS_PHASES } from '../lib/architecturalProcess';
import {
  lifecycleStatusLabel,
  setTaskComplete,
  sortEmployeeTasks,
  taskLifecycleStatus,
  tasksFromScheduleRows,
  type EmployeeTask,
} from '../lib/employeeTasks';
import { parseScheduleDate } from '../lib/scheduleDates';
import {
  deleteScheduleRow,
  phaseTitlesFromRows,
  setScheduleAssignee,
  setScheduleRowDates,
} from '../lib/scheduleMutations';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { applyEmployeeTaskScope } from '../lib/employeeTaskScope';
import { useEmployeeTaskScope } from '../hooks/useEmployeeTaskScope';
import { TaskScopeToggle } from './TaskScopeToggle';

function statusClass(task: EmployeeTask) {
  const s = taskLifecycleStatus(task);
  if (s === 'not_started') return 'not-started';
  return s;
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  canAssign = false,
  assigneeOptions = [],
  onRowsChange,
  onStartSchedule,
  isLead = false,
}: {
  projectKey: string;
  projectTitle: string;
  clientName: string;
  employeeName: string;
  rows: ScheduleRow[];
  writable?: boolean;
  canAssign?: boolean;
  /** When false, member can toggle assigned-only vs full project task list. */
  isLead?: boolean;
  assigneeOptions?: string[];
  onRowsChange?: (rows: ScheduleRow[]) => void;
  /** Shown when there are zero checklist tasks. */
  onStartSchedule?: () => void;
}) {
  const [view, setView] = useState<'open' | 'all' | 'done'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'any' | 'incomplete' | 'overdue' | 'not_started'
  >('any');
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState(rows);
  const [openPhases, setOpenPhases] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [addPhase, setAddPhase] = useState('');
  const [editTask, setEditTask] = useState<EmployeeTask | null>(null);
  const expandedOnce = useRef(false);
  const { scope: taskScope, setScope: setTaskScope } = useEmployeeTaskScope(employeeName);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    expandedOnce.current = false;
    setOpenPhases(new Set());
    setPhaseFilter('');
    setAssigneeFilter('');
    setStatusFilter('any');
    setQuery('');
    setMineOnly(false);
    setFiltersOpen(false);
  }, [projectKey]);

  useEffect(() => {
    if (!filtersOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!filterRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [filtersOpen]);

  const scheduleId = localRows[0]?.schedule_id || '';
  const phaseOptions = useMemo(() => phaseTitlesFromRows(localRows), [localRows]);

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

  const scopedTasks = useMemo(
    () => applyEmployeeTaskScope(tasks, employeeName, taskScope, { isLead }),
    [tasks, employeeName, taskScope, isLead],
  );

  const counts = useMemo(() => {
    const open = scopedTasks.filter((t) => !t.complete).length;
    const done = scopedTasks.filter((t) => t.complete).length;
    return { open, done, all: scopedTasks.length };
  }, [scopedTasks]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (phaseFilter) n += 1;
    if (assigneeFilter) n += 1;
    if (statusFilter !== 'any') n += 1;
    if (query.trim()) n += 1;
    if (mineOnly) n += 1;
    return n;
  }, [phaseFilter, assigneeFilter, statusFilter, query, mineOnly]);

  const filtered = useMemo(() => {
    let list = scopedTasks;
    if (view === 'open') list = list.filter((t) => !t.complete);
    else if (view === 'done') list = list.filter((t) => t.complete);
    if (mineOnly) {
      list = list.filter(
        (t) => t.assigneeName.toLowerCase() === employeeName.trim().toLowerCase(),
      );
    }
    if (phaseFilter) list = list.filter((t) => t.phase === phaseFilter);
    if (assigneeFilter === '__unassigned__') {
      list = list.filter((t) => !t.assigneeName.trim());
    } else if (assigneeFilter) {
      list = list.filter((t) => t.assigneeName === assigneeFilter);
    }
    if (statusFilter === 'incomplete') {
      list = list.filter((t) => taskLifecycleStatus(t) === 'incomplete');
    } else if (statusFilter === 'overdue') {
      list = list.filter((t) => taskLifecycleStatus(t) === 'overdue');
    } else if (statusFilter === 'not_started') {
      list = list.filter((t) => taskLifecycleStatus(t) === 'not_started');
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.task.toLowerCase().includes(q) ||
          t.phase.toLowerCase().includes(q) ||
          t.assigneeName.toLowerCase().includes(q) ||
          t.phaseManagerName.toLowerCase().includes(q),
      );
    }
    return sortEmployeeTasks(list, 'due', 'asc');
  }, [
    scopedTasks,
    view,
    mineOnly,
    employeeName,
    phaseFilter,
    assigneeFilter,
    statusFilter,
    query,
  ]);

  function clearFilters() {
    setPhaseFilter('');
    setAssigneeFilter('');
    setStatusFilter('any');
    setQuery('');
    setMineOnly(false);
  }

  const byPhase = useMemo(() => {
    const map = new Map<string, { title: string; list: EmployeeTask[] }>();
    for (const t of filtered) {
      const id = t.phaseId || t.phase;
      const entry = map.get(id) || { title: t.phase, list: [] };
      entry.list.push(t);
      map.set(id, entry);
    }
    return [...map.entries()].map(([id, entry]) => ({
      id,
      phase: entry.title,
      list: entry.list,
    }));
  }, [filtered]);

  // Expand all phases once per project so completed tasks are visible immediately.
  useEffect(() => {
    if (expandedOnce.current || !byPhase.length) return;
    expandedOnce.current = true;
    setOpenPhases(new Set(byPhase.map((g) => g.phase)));
  }, [byPhase]);

  function togglePhase(phase: string) {
    setOpenPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }

  function expandAll() {
    setOpenPhases(new Set(byPhase.map((g) => g.phase)));
  }

  function collapseAll() {
    setOpenPhases(new Set());
  }

  function commitRows(nextRows: ScheduleRow[]) {
    setLocalRows(nextRows);
    onRowsChange?.(nextRows);
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
    commitRows(
      localRows.map((r) =>
        r.id === task.rowId
          ? {
              ...r,
              budget_remaining: next ? 'Completed' : 'Incomplete',
              actual_end: res.endRaw,
            }
          : r,
      ),
    );
  }

  async function onTaskModalSaved() {
    const loaded = await loadProjectSchedule(projectKey);
    commitRows(loaded.rows);
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
      projectKey,
      rowId: task.rowId,
      targetStart: field === 'target_start' ? value : undefined,
      targetEnd: field === 'target_end' ? value : undefined,
      rows: localRows,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    commitRows(res.data.rows);
  }

  async function onDelete(task: EmployeeTask) {
    if (!task.writable || busyId) return;
    if (!window.confirm(`Delete “${task.task}”?`)) return;
    setBusyId(task.id);
    const res = await deleteScheduleRow({ projectKey, rowId: task.rowId });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    commitRows(localRows.filter((r) => r.id !== task.rowId));
  }

  async function onAssigneeChange(task: EmployeeTask, assigneeName: string) {
    if (!canAssign || !task.writable || busyId) return;
    if (assigneeName === task.assigneeName) return;
    setBusyId(task.id);
    setError(null);
    const res = await setScheduleAssignee({
      projectKey,
      rowId: task.rowId,
      assigneeName,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    commitRows(
      localRows.map((r) =>
        r.id === task.rowId ? { ...r, assignee_name: assigneeName } : r,
      ),
    );
  }

  const assignNames = useMemo(() => {
    const set = new Set(assigneeOptions);
    if (employeeName) set.add(employeeName);
    for (const t of tasks) {
      if (t.assigneeName) set.add(t.assigneeName);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [assigneeOptions, employeeName, tasks]);

  return (
    <div className="emp-project-tasks">
      <div className="emp-filter-bar emp-project-tasks-bar">
        {!isLead ? (
          <TaskScopeToggle scope={taskScope} onChange={setTaskScope} compact />
        ) : null}
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
        <div className="emp-task-filter-wrap" ref={filterRef}>
          <button
            type="button"
            className={`emp-filter-trigger${filtersOpen ? ' on' : ''}${activeFilterCount ? ' has-filters' : ''}`}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
          {filtersOpen ? (
            <div className="emp-task-filter-pop" role="dialog" aria-label="Task filters">
              <label className="emp-filter-field">
                <span>Phase</span>
                <select
                  className="emp-filter-select"
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                >
                  <option value="">All phases</option>
                  {phaseOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="emp-filter-field">
                <span>Status</span>
                <select
                  className="emp-filter-select"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as typeof statusFilter)
                  }
                >
                  <option value="any">Any status</option>
                  <option value="incomplete">Incomplete</option>
                  <option value="overdue">Overdue</option>
                  <option value="not_started">Not started</option>
                </select>
              </label>
              {canAssign || assignNames.length > 1 ? (
                <label className="emp-filter-field">
                  <span>Assignee</span>
                  <select
                    className="emp-filter-select"
                    value={assigneeFilter}
                    onChange={(e) => setAssigneeFilter(e.target.value)}
                  >
                    <option value="">Anyone</option>
                    <option value="__unassigned__">Unassigned</option>
                    {assignNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {(isLead || taskScope === 'all') && (
                <label className={`emp-started-toggle${mineOnly ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={mineOnly}
                    onChange={(e) => setMineOnly(e.target.checked)}
                  />
                  <span>Assigned to me</span>
                </label>
              )}
              <label className="emp-filter-field">
                <span>Search</span>
                <input
                  type="search"
                  className="emp-filter-select"
                  placeholder="Task, phase, assignee…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {activeFilterCount ? (
                <button type="button" className="sched-text-btn" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {writable && scheduleId ? (
          <button
            type="button"
            className="emp-primary-btn"
            onClick={() => {
              setAddPhase(phaseOptions[0] || '');
              setAdding((v) => !v);
            }}
          >
            {adding ? 'Close' : 'Add task'}
          </button>
        ) : null}
      </div>

      <p className="pd-muted emp-project-tasks-hint">
        Phases come from the Project List (CORE). Check off work or use the edit button for details
        and subtasks; project leads can start the checklist when it is empty.
      </p>

      {adding && scheduleId ? (
        <div className="emp-add-task-inline">
          <AddScheduleTaskForm
            projectKey={projectKey}
            scheduleId={scheduleId}
            phaseOptions={phaseOptions}
            rows={localRows}
            defaultPhase={addPhase}
            assigneeOptions={canAssign ? assignNames : undefined}
            onCancel={() => setAdding(false)}
            onCreated={(row) => {
              setAdding(false);
              setOpenPhases((prev) => new Set(prev).add(addPhase || phaseOptions[0] || ''));
              commitRows(
                [...localRows, row].sort((a, b) => a.sort_order - b.sort_order),
              );
            }}
          />
        </div>
      ) : null}

      {error ? <p className="plist-upload-err">{error}</p> : null}

      {!scopedTasks.length && tasks.length > 0 && !isLead && taskScope === 'assigned' ? (
        <p className="pd-muted">
          No tasks assigned to you on this project.{' '}
          <button type="button" className="sched-text-btn" onClick={() => setTaskScope('all')}>
            Show all project tasks
          </button>
        </p>
      ) : !tasks.length && !adding ? (
        <div className="emp-task-empty-start">
          <p className="pd-muted">No tasks on this project schedule yet.</p>
          {onStartSchedule ? (
            <button type="button" className="emp-primary-btn" onClick={onStartSchedule}>
              Start schedule
            </button>
          ) : null}
        </div>
      ) : !filtered.length && !adding ? (
        <p className="pd-muted">
          No tasks match this filter.
          {activeFilterCount ? (
            <>
              {' '}
              <button type="button" className="sched-text-btn" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : counts.all > 0 && view !== 'all' ? (
            <>
              {' '}
              <button type="button" className="sched-text-btn" onClick={() => setView('all')}>
                Show all ({counts.all})
              </button>
            </>
          ) : null}
        </p>
      ) : (
        byPhase.map(({ id, phase, list }) => {
          const style = phaseStyle(phase);
          const expanded = openPhases.has(phase);
          const openInPhase = list.filter((t) => !t.complete).length;
          const nextDue = list.find((t) => !t.complete && t.dueRaw)?.dueRaw;
          return (
            <div
              key={id}
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
                      <div className="emp-project-task-item emp-project-task-item-edit">
                        <input
                          type="checkbox"
                          checked={t.complete}
                          disabled={!t.writable || busyId === t.id}
                          onChange={() => void onToggle(t)}
                          aria-label={`Mark ${t.task} ${t.complete ? 'incomplete' : 'complete'}`}
                        />
                        <div className="emp-project-task-body">
                          <strong>{t.task}</strong>
                          <div className="emp-project-task-dates">
                            <label>
                              <span>Start</span>
                              {t.writable ? (
                                <ScheduleDateInput
                                  value={t.startRaw}
                                  disabled={busyId === t.id}
                                  ariaLabel={`Start for ${t.task}`}
                                  autofilled={t.datesAutofilled && Boolean(t.startRaw)}
                                  onCommit={(v) => void onDateChange(t, 'target_start', v)}
                                />
                              ) : (
                                <span
                                  className={`mono soft${t.datesAutofilled && t.startRaw ? ' emp-date-autofilled' : ''}`}
                                >
                                  {t.startRaw || '—'}
                                </span>
                              )}
                            </label>
                            <label>
                              <span>Due</span>
                              {t.writable ? (
                                <ScheduleDateInput
                                  value={t.dueRaw}
                                  disabled={busyId === t.id}
                                  ariaLabel={`Due for ${t.task}`}
                                  autofilled={t.datesAutofilled && Boolean(t.dueRaw)}
                                  onCommit={(v) => void onDateChange(t, 'target_end', v)}
                                />
                              ) : (
                                <span
                                  className={`mono soft${t.datesAutofilled && t.dueRaw ? ' emp-date-autofilled' : ''}`}
                                >
                                  {t.dueRaw || '—'}
                                </span>
                              )}
                            </label>
                            <label>
                              <span>Assignee</span>
                              {canAssign && t.writable ? (
                                <select
                                  className="emp-task-assignee-select"
                                  value={t.assigneeName}
                                  disabled={busyId === t.id}
                                  aria-label={`Assignee for ${t.task}`}
                                  onChange={(e) => void onAssigneeChange(t, e.target.value)}
                                >
                                  <option value="">Unassigned</option>
                                  {assignNames.map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="mono soft">{t.assigneeName || '—'}</span>
                              )}
                            </label>
                            <label>
                              <span>Phase PM</span>
                              <span className="mono soft">{t.phaseManagerName || '—'}</span>
                            </label>
                            <span className="mono soft">
                              {t.kind === 'subtask' ? 'Subtask' : 'Task'}
                              {parseScheduleDate(t.endRaw)
                                ? ` · ended ${t.endRaw}`
                                : ''}
                            </span>
                          </div>
                        </div>
                        <div className="emp-project-task-side">
                          <span className={`emp-task-status ${statusClass(t)}`}>
                            {lifecycleStatusLabel(taskLifecycleStatus(t))}
                          </span>
                          {t.writable ? (
                            <div className="emp-task-actions">
                              <button
                                type="button"
                                className="emp-task-edit"
                                disabled={busyId === t.id}
                                title="Edit task"
                                aria-label={`Edit ${t.task}`}
                                onClick={() => setEditTask(t)}
                              >
                                <PencilIcon />
                              </button>
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
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                  {writable ? (
                    <li className="emp-project-task-add-row">
                      <button
                        type="button"
                        className="cp-text-btn"
                        onClick={() => {
                          setAddPhase(phase);
                          setAdding(true);
                          setOpenPhases((prev) => new Set(prev).add(phase));
                        }}
                      >
                        + Add under {phase}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          );
        })
      )}

      <TaskEditModal
        task={editTask}
        open={!!editTask}
        onClose={() => setEditTask(null)}
        onSaved={() => void onTaskModalSaved()}
      />
    </div>
  );
}
