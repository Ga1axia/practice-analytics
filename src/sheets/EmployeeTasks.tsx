import { useEffect, useMemo, useRef, useState } from 'react';
import { AddScheduleTaskForm } from '../components/AddScheduleTaskForm';
import { TaskScopeToggle } from '../components/TaskScopeToggle';
import { useEmployeeTaskScope } from '../hooks/useEmployeeTaskScope';
import { ScheduleDateInput } from '../components/ScheduleDateInput';
import { TaskEditModal } from '../components/TaskEditModal';
import { useDemoMode } from '../hooks/useDemoMode';
import { matchProcessPhaseIndex, PROCESS_PHASES } from '../lib/architecturalProcess';
import {
  lifecycleStatusLabel,
  loadEmployeeTasks,
  projectPillColor,
  saveTaskPriority,
  setTaskComplete,
  sortEmployeeTasks,
  taskHasStarted,
  taskInCurrentWindow,
  taskLifecycleStatus,
  type EmployeeTask,
  type TaskLifecycleStatus,
  type TaskPriority,
  type TaskSortKey,
} from '../lib/employeeTasks';
import type { ProjectNode } from '../lib/projectListHierarchy';
import { ensureProjectSchedule } from '../lib/scheduleEnsure';
import { loadProjectMembers } from '../lib/projectMembers';
import {
  deleteScheduleRow,
  duplicateScheduleTask,
  phaseTitlesFromRows,
  setScheduleRowDates,
} from '../lib/scheduleMutations';
import type { ScheduleRow } from '../lib/scheduleTypes';
import { parseScheduleDate, startOfDay } from '../lib/scheduleDates';
import { applyEmployeeTaskScope } from '../lib/employeeTaskScope';
import {
  isExplicitlyActiveSchedulePhase,
  taskMatchesScheduleSearch,
} from '../lib/activeSchedulePhase';

type StatusView = 'current' | 'incomplete' | 'overdue' | 'not_started' | 'complete';

/** Render window — more rows append when the list is scrolled to the bottom. */
const TASK_PAGE_SIZE = 100;

const SORT_COLS: { key: TaskSortKey; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'phase', label: 'Phase' },
  { key: 'phaseManager', label: 'Phase PM' },
  { key: 'complete', label: '' },
  { key: 'priority', label: 'Priority' },
  { key: 'task', label: 'Task' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'start', label: 'Start' },
  { key: 'due', label: 'Due' },
  { key: 'end', label: 'End' },
  { key: 'status', label: 'Status' },
];

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
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

function DuplicateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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

function statusClass(s: TaskLifecycleStatus) {
  if (s === 'not_started') return 'not-started';
  return s;
}

function withLifecycle(task: EmployeeTask): EmployeeTask {
  return { ...task, status: taskLifecycleStatus(task) };
}

function applyStatusView(
  list: EmployeeTask[],
  view: StatusView,
  startedOnly: boolean,
  today: Date,
): EmployeeTask[] {
  let next = list;
  if (startedOnly && view !== 'not_started') {
    next = next.filter((t) => taskHasStarted(t, today));
  }
  if (view === 'current') next = next.filter((t) => taskInCurrentWindow(t, today));
  else if (view === 'incomplete') next = next.filter((t) => t.status === 'incomplete');
  else if (view === 'overdue') next = next.filter((t) => t.status === 'overdue');
  else if (view === 'not_started') next = next.filter((t) => t.status === 'not_started');
  else if (view === 'complete') next = next.filter((t) => t.status === 'complete');
  return next;
}

function matchesQuery(task: EmployeeTask, query: string): boolean {
  return taskMatchesScheduleSearch(
    { ...task, statusLabel: lifecycleStatusLabel(task.status) },
    query,
  );
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
  const { scope: taskScope, setScope: setTaskScope } = useEmployeeTaskScope(employeeName);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedDemo, setUsedDemo] = useState(false);
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [sortKey, setSortKey] = useState<TaskSortKey>('due');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useState<StatusView>('current');
  const [startedOnly, setStartedOnly] = useState(true);
  const [addAssignees, setAddAssignees] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searchWide, setSearchWide] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<EmployeeTask | null>(null);
  const [adding, setAdding] = useState(false);
  const [addProjectKey, setAddProjectKey] = useState('');
  const [addMeta, setAddMeta] = useState<{
    scheduleId: string;
    phases: string[];
    rows: ScheduleRow[];
  } | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(TASK_PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
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
    setAddAssignees([]);
    void loadProjectMembers(project.key).then((res) => {
      if (cancelled) return;
      const names = res.members.map((m) => m.employee_name);
      if (!names.includes(employeeName)) names.unshift(employeeName);
      setAddAssignees(names);
    });
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

  const today = useMemo(() => startOfDay(new Date()), []);

  const scopedTasks = useMemo(
    () => applyEmployeeTaskScope(tasks, employeeName, taskScope),
    [tasks, employeeName, taskScope],
  );

  const activeScoped = useMemo(() => {
    if (taskScope !== 'all') return scopedTasks;
    return scopedTasks.filter((t) => {
      const project = projects.find((p) => p.key === t.projectKey);
      return project ? isExplicitlyActiveSchedulePhase(project, t.phase) : false;
    });
  }, [scopedTasks, taskScope, projects]);

  const projectOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const t of activeScoped) {
      if (!byKey.has(t.projectKey)) byKey.set(t.projectKey, t.projectTitle);
    }
    return [...byKey.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }),
    );
  }, [activeScoped]);

  const phaseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of activeScoped) {
      if (projectFilter && t.projectKey !== projectFilter) continue;
      if (t.phase.trim()) set.add(t.phase);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [activeScoped, projectFilter]);

  useEffect(() => {
    if (projectFilter && !projectOptions.some(([key]) => key === projectFilter)) {
      setProjectFilter('');
    }
  }, [projectFilter, projectOptions]);

  useEffect(() => {
    if (phaseFilter && !phaseOptions.includes(phaseFilter)) setPhaseFilter('');
  }, [phaseFilter, phaseOptions]);

  const narrowed = useMemo(() => {
    let list = activeScoped;
    if (projectFilter) list = list.filter((t) => t.projectKey === projectFilter);
    if (phaseFilter) list = list.filter((t) => t.phase === phaseFilter);
    return list;
  }, [activeScoped, projectFilter, phaseFilter]);

  useEffect(() => {
    setSearchWide(false);
  }, [query, view, startedOnly, projectFilter, phaseFilter, taskScope]);

  const statusScoped = useMemo(
    () => (searchWide ? narrowed : applyStatusView(narrowed, view, startedOnly, today)),
    [narrowed, searchWide, view, startedOnly, today],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q ? statusScoped.filter((t) => matchesQuery(t, q)) : statusScoped;
    return sortEmployeeTasks(list, sortKey, sortDir);
  }, [statusScoped, query, sortKey, sortDir]);

  const searchHitsOutsideStatus = useMemo(() => {
    const q = query.trim();
    if (!q || searchWide) return 0;
    if (statusScoped.some((t) => matchesQuery(t, q))) return 0;
    return narrowed.filter((t) => matchesQuery(t, q)).length;
  }, [query, searchWide, statusScoped, narrowed]);

  const searchHitsOutsideProject = useMemo(() => {
    const q = query.trim();
    if (!q || (!projectFilter && !phaseFilter)) return 0;
    if (narrowed.some((t) => matchesQuery(t, q))) return 0;
    return activeScoped.filter((t) => matchesQuery(t, q)).length;
  }, [query, projectFilter, phaseFilter, narrowed, activeScoped]);

  // Reset the render window whenever the filtered set identity changes.
  useEffect(() => {
    setVisibleCount(TASK_PAGE_SIZE);
  }, [view, query, sortKey, sortDir, startedOnly, taskScope, projectsKey, projectFilter, phaseFilter]);

  const visibleTasks = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );
  const hasMoreTasks = visibleCount < filtered.length;

  const showAssignee = useMemo(
    () => tasks.some((t) => Boolean((t.assigneeName || '').trim())),
    [tasks],
  );
  const sortCols = useMemo(
    () => (showAssignee ? SORT_COLS : SORT_COLS.filter((c) => c.key !== 'assignee')),
    [showAssignee],
  );

  useEffect(() => {
    if (!hasMoreTasks) return;
    const root = scrollRef.current;
    const target = loadMoreRef.current;
    if (!root || !target) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisibleCount((n) => Math.min(n + TASK_PAGE_SIZE, filtered.length));
      },
      { root, rootMargin: '160px', threshold: 0 },
    );
    obs.observe(target);
    return () => obs.disconnect();
  }, [hasMoreTasks, filtered.length, visibleTasks.length]);

  const counts = useMemo(() => {
    const started = narrowed.filter((t) => taskHasStarted(t, today));
    const base = startedOnly ? started : narrowed;
    return {
      current: base.filter((t) => taskInCurrentWindow(t, today)).length,
      incomplete: base.filter((t) => t.status === 'incomplete').length,
      overdue: base.filter((t) => t.status === 'overdue').length,
      notStarted: narrowed.filter((t) => t.status === 'not_started').length,
      complete: base.filter((t) => t.status === 'complete').length,
    };
  }, [narrowed, startedOnly, today]);

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
      prev.map((t) => {
        if (t.id !== task.id) return t;
        return withLifecycle({
          ...t,
          complete: next,
          endRaw: res.endRaw,
          end: next ? new Date() : null,
        });
      }),
    );
  }

  function onPriorityChange(task: EmployeeTask, priority: TaskPriority) {
    saveTaskPriority(task.rowId, priority);
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, priority } : t)));
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
      cascade: false,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const byId = new Map(res.data.rows.map((r) => [r.id, r]));
    setTasks((prev) =>
      prev.map((t) => {
        if (t.projectKey !== task.projectKey) return t;
        const row = byId.get(t.rowId);
        if (!row) {
          if (t.id !== task.id) return t;
          const parsed = parseScheduleDate(value);
          if (field === 'target_start') {
            return withLifecycle({
              ...t,
              startRaw: value,
              start: parsed,
              datesAutofilled: false,
            });
          }
          return withLifecycle({
            ...t,
            dueRaw: value,
            due: parsed,
            datesAutofilled: false,
          });
        }
        const start = parseScheduleDate(row.target_start);
        const due = parseScheduleDate(row.target_end);
        return withLifecycle({
          ...t,
          startRaw: (row.target_start || '').trim(),
          dueRaw: (row.target_end || '').trim(),
          start,
          due,
          datesAutofilled: false,
        });
      }),
    );
  }

  async function onDuplicate(task: EmployeeTask) {
    if (!task.writable || busyId) return;
    if (!task.scheduleId) {
      setError('Schedule not ready yet');
      return;
    }
    setBusyId(task.id);
    setError(null);
    const res = await duplicateScheduleTask({
      projectKey: task.projectKey,
      scheduleId: task.scheduleId,
      rowId: task.rowId,
      phaseTitle: task.phase,
      task: task.task,
      kind: task.kind,
      targetStart: task.startRaw,
      targetEnd: task.dueRaw,
      assigneeName: task.assigneeName,
    });
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const row = res.data;
    const start = parseScheduleDate(row.target_start);
    const due = parseScheduleDate(row.target_end);
    saveTaskPriority(row.id, task.priority);
    const cloned: EmployeeTask = withLifecycle({
      ...task,
      id: `${task.projectKey}:${row.id}`,
      rowId: row.id,
      task: row.task,
      startRaw: (row.target_start || '').trim(),
      dueRaw: (row.target_end || '').trim(),
      endRaw: '',
      start,
      due,
      end: null,
      complete: false,
      datesAutofilled: false,
    });
    setTasks((prev) => [...prev, cloned]);
    setEditTask(cloned);
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
    <div className="emp-tasks emp-tasks-layout">
      <aside className="emp-tasks-nav" aria-label="Task filters">
        <p className="emp-tasks-nav-kicker">Filters</p>
        <TaskScopeToggle scope={taskScope} onChange={setTaskScope} />
        <p className="pd-muted emp-tasks-scope-note">
          {taskScope === 'assigned'
            ? 'Showing tasks assigned to you on your projects.'
            : 'Showing tasks in phases CORE marks Active.'}
        </p>
        <label className="emp-filter-field">
          <span>Project</span>
          <select
            className="emp-filter-select"
            value={projectFilter}
            onChange={(e) => {
              setProjectFilter(e.target.value);
              setPhaseFilter('');
            }}
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projectOptions.map(([key, title]) => (
              <option key={key} value={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="emp-filter-field">
          <span>Phase</span>
          <select
            className="emp-filter-select"
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            aria-label="Filter by phase"
          >
            <option value="">All phases</option>
            {phaseOptions.map((phase) => (
              <option key={phase} value={phase}>
                {phase}
              </option>
            ))}
          </select>
        </label>
        <label className={`emp-started-toggle${startedOnly ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={startedOnly}
            onChange={(e) => setStartedOnly(e.target.checked)}
          />
          <span>Started only</span>
        </label>
        <div className="emp-tasks-nav-filters" role="group" aria-label="Task filter">
          <button
            type="button"
            className={view === 'current' ? 'on' : ''}
            onClick={() => setView('current')}
          >
            Current <span className="emp-tasks-nav-count">{counts.current}</span>
          </button>
          <button
            type="button"
            className={view === 'incomplete' ? 'on' : ''}
            onClick={() => setView('incomplete')}
          >
            Incomplete <span className="emp-tasks-nav-count">{counts.incomplete}</span>
          </button>
          <button
            type="button"
            className={view === 'overdue' ? 'on' : ''}
            onClick={() => setView('overdue')}
          >
            Overdue <span className="emp-tasks-nav-count">{counts.overdue}</span>
          </button>
          <button
            type="button"
            className={view === 'not_started' ? 'on' : ''}
            onClick={() => setView('not_started')}
          >
            Not started <span className="emp-tasks-nav-count">{counts.notStarted}</span>
          </button>
          <button
            type="button"
            className={view === 'complete' ? 'on' : ''}
            onClick={() => setView('complete')}
          >
            Complete <span className="emp-tasks-nav-count">{counts.complete}</span>
          </button>
        </div>
        <label className="emp-search emp-tasks-nav-search">
          <span className="visually-hidden">Search tasks</span>
          <input
            type="search"
            placeholder="Search name, task, project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {query.trim() ? (
          <p className="pd-muted emp-tasks-search-note">
            {searchWide
              ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} in every status`
              : `${filtered.length} match${filtered.length === 1 ? '' : 'es'} in this filter`}
            {searchWide ? (
              <>
                {' '}
                <button type="button" className="sched-text-btn" onClick={() => setSearchWide(false)}>
                  Use status filter
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <button
          type="button"
          className="emp-primary-btn emp-tasks-nav-add"
          disabled={!projects.length}
          onClick={() => {
            setAddProjectKey(projects[0]?.key || '');
            setAdding((v) => !v);
          }}
        >
          {adding ? 'Close' : 'Add task'}
        </button>
      </aside>

      <div className="emp-tasks-main">
        <header className="emp-hero">
          <p className="pd-kicker">My tasks</p>
          <h1 className="display">Task schedule</h1>
          <p className="emp-lede">
            Create tasks, edit names and deadlines, and check work off across your assigned
            projects. Search stays inside the project, phase, and status you pick.
          </p>
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
                assigneeOptions={addAssignees}
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
        ) : !scopedTasks.length && tasks.length > 0 && taskScope === 'assigned' ? (
          <div className="plist-empty">
            No tasks are assigned to you yet.{' '}
            <button type="button" className="sched-text-btn" onClick={() => setTaskScope('all')}>
              Show all project tasks
            </button>
          </div>
        ) : !tasks.length ? (
          <div className="plist-empty">
            No schedule tasks yet. Use <strong>Add task</strong> or open a project to build the list.
          </div>
        ) : !filtered.length ? (
          <div className="plist-empty">
            {query.trim() ? (
              <>
                <p>No tasks match “{query.trim()}” in this filter.</p>
                {searchHitsOutsideStatus > 0 ? (
                  <button
                    type="button"
                    className="sched-text-btn"
                    onClick={() => setSearchWide(true)}
                  >
                    Show {searchHitsOutsideStatus} match
                    {searchHitsOutsideStatus === 1 ? '' : 'es'} in every status
                  </button>
                ) : null}
                {searchHitsOutsideProject > 0 ? (
                  <button
                    type="button"
                    className="sched-text-btn"
                    onClick={() => {
                      setProjectFilter('');
                      setPhaseFilter('');
                    }}
                  >
                    Clear project and phase ({searchHitsOutsideProject} match
                    {searchHitsOutsideProject === 1 ? '' : 'es'})
                  </button>
                ) : null}
              </>
            ) : taskScope === 'all' && !projectFilter && !phaseFilter ? (
              'No tasks in phases CORE marks Active.'
            ) : (
              'No tasks match this filter.'
            )}
          </div>
        ) : (
          <div className="emp-tasks-scroll" ref={scrollRef}>
            <table className="emp-tasks-table">
              <thead>
                <tr>
                  {sortCols.map((col) => (
                    <th
                      key={col.key}
                      className={
                        col.key === 'complete'
                          ? 'col-check'
                          : col.key === 'task'
                            ? 'col-task'
                            : col.key === 'priority'
                              ? 'col-priority'
                              : col.key === 'phaseManager'
                                ? 'col-phase-pm'
                                : col.key === 'start'
                                  ? 'col-start'
                                  : col.key === 'due'
                                    ? 'col-due'
                                    : col.key === 'end'
                                      ? 'col-end'
                                      : col.key === 'status'
                                        ? 'col-status'
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
                {visibleTasks.map((t) => {
                  const phaseStyle = phasePillStyle(t.phase);
                  return (
                    <tr
                      key={t.id}
                      className={t.status === 'complete' ? 'done' : ''}
                    >
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
                      <td className="col-phase-pm mono">
                        {t.phaseManagerName || '—'}
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
                      <td className="col-priority">
                        <select
                          className={`emp-task-priority ${priorityClass(t.priority)}`}
                          value={t.priority}
                          onChange={(e) =>
                            onPriorityChange(t, e.target.value as TaskPriority)
                          }
                          aria-label={`Priority for ${t.task}`}
                        >
                          <option value="Important">High</option>
                          <option value="Medium">Med</option>
                          <option value="Low">Low</option>
                        </select>
                      </td>
                      <td className="col-task">
                        <span className="emp-task-text">{t.task}</span>
                        {t.kind === 'subtask' ? (
                          <span className="emp-task-kind mono">subtask</span>
                        ) : null}
                      </td>
                      {showAssignee ? (
                        <td className="emp-task-assignee mono">{t.assigneeName || '—'}</td>
                      ) : null}
                      <td className="col-start">
                        {t.writable ? (
                          <ScheduleDateInput
                            value={t.startRaw}
                            disabled={busyId === t.id}
                            ariaLabel={`Start date for ${t.task}`}
                            autofilled={t.datesAutofilled && Boolean(t.startRaw)}
                            onCommit={(v) => void onDateChange(t, 'target_start', v)}
                          />
                        ) : (
                          <span
                            className={`mono${t.datesAutofilled && t.startRaw ? ' emp-date-autofilled' : ''}`}
                          >
                            {t.startRaw || '—'}
                          </span>
                        )}
                      </td>
                      <td className="col-due">
                        {t.writable ? (
                          <ScheduleDateInput
                            value={t.dueRaw}
                            disabled={busyId === t.id}
                            ariaLabel={`Due date for ${t.task}`}
                            autofilled={t.datesAutofilled && Boolean(t.dueRaw)}
                            onCommit={(v) => void onDateChange(t, 'target_end', v)}
                          />
                        ) : (
                          <span
                            className={`mono${t.datesAutofilled && t.dueRaw ? ' emp-date-autofilled' : ''}`}
                          >
                            {t.dueRaw || '—'}
                          </span>
                        )}
                      </td>
                      <td className="col-end mono">{t.endRaw || '—'}</td>
                      <td className="col-status">
                        <span className={`emp-task-status ${statusClass(t.status)}`}>
                          {lifecycleStatusLabel(t.status)}
                        </span>
                      </td>
                      <td className="col-actions">
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
                              className="emp-task-edit"
                              disabled={busyId === t.id}
                              title="Duplicate task"
                              aria-label={`Duplicate ${t.task}`}
                              onClick={() => void onDuplicate(t)}
                            >
                              <DuplicateIcon />
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hasMoreTasks ? (
              <div ref={loadMoreRef} className="emp-tasks-load-more" aria-live="polite">
                Showing {visibleTasks.length} of {filtered.length} — scroll for more
              </div>
            ) : filtered.length > TASK_PAGE_SIZE ? (
              <div className="emp-tasks-load-more soft">
                Showing all {filtered.length} tasks
              </div>
            ) : null}
          </div>
        )}
        </div>
      </div>

      <TaskEditModal
        task={editTask}
        open={!!editTask}
        onClose={() => setEditTask(null)}
        onSaved={() => void refresh()}
      />
    </div>
  );
}
