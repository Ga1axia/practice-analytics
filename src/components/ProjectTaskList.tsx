import { useEffect, useMemo, useState } from 'react';
import { AddScheduleTaskForm } from './AddScheduleTaskForm';
import { ScheduleDateInput } from './ScheduleDateInput';
import { matchProcessPhaseIndex, PROCESS_PHASES } from '../lib/architecturalProcess';
import {
  setTaskComplete,
  sortEmployeeTasks,
  tasksFromScheduleRows,
  type EmployeeTask,
} from '../lib/employeeTasks';
import { parseScheduleDate } from '../lib/scheduleDates';
import {
  deleteScheduleRow,
  phaseTitlesFromRows,
  renameScheduleTask,
  setScheduleRowDates,
} from '../lib/scheduleMutations';
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
  onRowsChange?: (rows: ScheduleRow[]) => void;
}) {
  const [view, setView] = useState<'open' | 'all' | 'done'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRows, setLocalRows] = useState(rows);
  const [openPhases, setOpenPhases] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [addPhase, setAddPhase] = useState('');

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

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

  async function onRename(task: EmployeeTask, name: string) {
    if (!task.writable || name.trim() === task.task) return;
    setBusyId(task.id);
    const res = await renameScheduleTask({
      projectKey,
      rowId: task.rowId,
      task: name,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    commitRows(localRows.map((r) => (r.id === task.rowId ? { ...r, task: name.trim() } : r)));
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
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    commitRows(
      localRows.map((r) => (r.id === task.rowId ? { ...r, [field]: value } : r)),
    );
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
        Check off work, edit names and dates inline, or add a task under any phase.
      </p>

      {adding && scheduleId ? (
        <div className="emp-add-task-inline">
          <AddScheduleTaskForm
            projectKey={projectKey}
            scheduleId={scheduleId}
            phaseOptions={phaseOptions}
            rows={localRows}
            defaultPhase={addPhase}
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

      {!tasks.length && !adding ? (
        <p className="pd-muted">No tasks on this project schedule yet.</p>
      ) : !filtered.length && !adding ? (
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
                      <div className="emp-project-task-item emp-project-task-item-edit">
                        <input
                          type="checkbox"
                          checked={t.complete}
                          disabled={!t.writable || busyId === t.id}
                          onChange={() => void onToggle(t)}
                          aria-label={`Mark ${t.task} ${t.complete ? 'incomplete' : 'complete'}`}
                        />
                        <div className="emp-project-task-body">
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
                            <strong>{t.task}</strong>
                          )}
                          <div className="emp-project-task-dates">
                            <label>
                              <span>Start</span>
                              {t.writable ? (
                                <ScheduleDateInput
                                  value={t.startRaw}
                                  disabled={busyId === t.id}
                                  ariaLabel={`Start for ${t.task}`}
                                  onCommit={(v) => void onDateChange(t, 'target_start', v)}
                                />
                              ) : (
                                <span className="mono soft">{t.startRaw || '—'}</span>
                              )}
                            </label>
                            <label>
                              <span>Due</span>
                              {t.writable ? (
                                <ScheduleDateInput
                                  value={t.dueRaw}
                                  disabled={busyId === t.id}
                                  ariaLabel={`Due for ${t.task}`}
                                  onCommit={(v) => void onDateChange(t, 'target_end', v)}
                                />
                              ) : (
                                <span className="mono soft">{t.dueRaw || '—'}</span>
                              )}
                            </label>
                            <span className="mono soft">
                              {t.kind === 'subtask' ? 'Subtask' : 'Task'}
                              {parseScheduleDate(t.endRaw)
                                ? ` · ended ${t.endRaw}`
                                : ''}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`emp-task-status ${t.complete ? 'complete' : 'incomplete'}`}
                        >
                          {t.status}
                        </span>
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
    </div>
  );
}
