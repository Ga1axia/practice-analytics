import { matchProcessPhaseIndex } from './architecturalProcess';
import { buildDemoProjectDetail } from './demoProjectDetail';
import { loadProjectSchedule } from './loadProjectSchedule';
import type { ProjectNode } from './projectListHierarchy';
import { isAutofilledAction } from './scheduleAutofill';
import { patchCachedScheduleRow } from './scheduleCache';
import { parseScheduleDate, startOfDay } from './scheduleDates';
import { ensureProjectSchedule } from './scheduleEnsure';
import { groupScheduleSections } from './scheduleSections';
import type { ScheduleRow } from './scheduleTypes';
import { supabase } from './supabase';

export type TaskPriority = 'Important' | 'Medium' | 'Low';

/** Derived schedule status shown in employee task views. */
export type TaskLifecycleStatus = 'complete' | 'overdue' | 'not_started' | 'incomplete';

export type EmployeeTask = {
  id: string;
  rowId: string;
  scheduleId: string;
  projectKey: string;
  projectTitle: string;
  clientName: string;
  phase: string;
  /** Stable section id for UI grouping (avoids duplicate phase-title keys). */
  phaseId: string;
  kind: 'task' | 'subtask';
  task: string;
  startRaw: string;
  dueRaw: string;
  endRaw: string;
  start: Date | null;
  due: Date | null;
  end: Date | null;
  status: TaskLifecycleStatus;
  complete: boolean;
  priority: TaskPriority;
  assigneeName: string;
  /** Project List manager for this schedule phase (falls back to project PM). */
  phaseManagerName: string;
  /** Demo rows can't be written back to Supabase. */
  writable: boolean;
  /** Target dates came from a schedule preset autofill. */
  datesAutofilled: boolean;
};

const LIFECYCLE_ORDER: Record<TaskLifecycleStatus, number> = {
  overdue: 0,
  incomplete: 1,
  not_started: 2,
  complete: 3,
};

export function taskLifecycleStatus(
  task: Pick<EmployeeTask, 'complete' | 'start' | 'due'>,
  today: Date = startOfDay(new Date()),
): TaskLifecycleStatus {
  if (task.complete) return 'complete';
  const t = today.getTime();
  if (task.start && startOfDay(task.start).getTime() > t) return 'not_started';
  if (task.due && startOfDay(task.due).getTime() < t) return 'overdue';
  return 'incomplete';
}

/** True when the task is available to work (start date reached, or no start set). */
export function taskHasStarted(
  task: Pick<EmployeeTask, 'start'>,
  today: Date = startOfDay(new Date()),
): boolean {
  if (!task.start) return true;
  return startOfDay(task.start).getTime() <= today.getTime();
}

/** Days of past schedule activity kept in the employee "Current" filter. */
export const CURRENT_TASK_LOOKBACK_DAYS = 7;

/**
 * True when a task belongs in the Current filter: its latest start/due/end
 * is not older than `lookbackDays` before today. Undated tasks stay visible.
 */
export function taskInCurrentWindow(
  task: Pick<EmployeeTask, 'start' | 'due' | 'end'>,
  today: Date = startOfDay(new Date()),
  lookbackDays: number = CURRENT_TASK_LOOKBACK_DAYS,
): boolean {
  const cutoff = startOfDay(today);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffTs = cutoff.getTime();
  const dates = [task.end, task.due, task.start].filter((d): d is Date => !!d);
  if (!dates.length) return true;
  const latest = Math.max(...dates.map((d) => startOfDay(d).getTime()));
  return latest >= cutoffTs;
}

export function lifecycleStatusLabel(status: TaskLifecycleStatus): string {
  if (status === 'not_started') return 'Not started';
  if (status === 'complete') return 'Complete';
  if (status === 'overdue') return 'Overdue';
  return 'Incomplete';
}

export type TaskSortKey =
  | 'project'
  | 'phase'
  | 'phaseManager'
  | 'complete'
  | 'priority'
  | 'task'
  | 'assignee'
  | 'start'
  | 'due'
  | 'end'
  | 'status';

/** Resolve Project List phase manager for a schedule section title. */
export function resolvePhaseManager(
  project: {
    row?: { manager?: string | null } | null;
    phases?: { label: string; row: { manager?: string | null; phase?: string | null } }[];
  },
  schedulePhaseTitle: string,
): string {
  const header = (project.row?.manager || '').trim();
  const phases = project.phases || [];
  if (!phases.length) return header;

  const sectionIdx = matchProcessPhaseIndex(schedulePhaseTitle);
  if (sectionIdx >= 0) {
    const hit = phases.find(
      (ph) => matchProcessPhaseIndex(ph.label || ph.row.phase || '') === sectionIdx,
    );
    const name = (hit?.row.manager || '').trim();
    if (name) return name;
  }

  const n = schedulePhaseTitle.toLowerCase().trim();
  if (n) {
    const fuzzy = phases.find((ph) => {
      const label = (ph.label || ph.row.phase || '').toLowerCase().trim();
      return Boolean(label && (n.includes(label) || label.includes(n)));
    });
    const name = (fuzzy?.row.manager || '').trim();
    if (name) return name;
  }

  return header;
}

const PRIORITY_KEY = 'pa-emp-task-priority-v1';
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  Important: 0,
  Medium: 1,
  Low: 2,
};

const PROJECT_PILL_COLORS = [
  '#F3D4C4',
  '#E4D4F0',
  '#F5D0D0',
  '#D4E8D8',
  '#D6E4F2',
  '#E8E4D4',
  '#F0E0C8',
  '#D8E8F0',
  '#E8D8E0',
  '#DCE8E0',
];

function managerFor(p: ProjectNode & { clientName: string }, fallback: string) {
  return (
    p.row?.manager ||
    p.phases.find((ph) => ph.row.manager)?.row.manager ||
    fallback
  );
}

function isCompleteStatus(status: string): boolean {
  return /^(completed|complete|done)$/i.test(status.trim());
}

function loadPriorityMap(): Record<string, TaskPriority> {
  try {
    const raw = localStorage.getItem(PRIORITY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, TaskPriority> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'Important' || v === 'Medium' || v === 'Low') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTaskPriority(rowId: string, priority: TaskPriority) {
  const map = loadPriorityMap();
  map[rowId] = priority;
  try {
    localStorage.setItem(PRIORITY_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Default priority from due date when none saved. */
export function inferPriority(due: Date | null, complete: boolean): TaskPriority {
  if (complete) return 'Low';
  if (!due) return 'Medium';
  const today = startOfDay(new Date()).getTime();
  const d = startOfDay(due).getTime();
  const days = Math.round((d - today) / 86400000);
  if (days < 0 || days <= 7) return 'Important';
  if (days <= 30) return 'Medium';
  return 'Low';
}

export function projectPillColor(projectKey: string): string {
  let h = 0;
  for (let i = 0; i < projectKey.length; i++) h = (h * 31 + projectKey.charCodeAt(i)) >>> 0;
  return PROJECT_PILL_COLORS[h % PROJECT_PILL_COLORS.length]!;
}

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function rowDates(row: ScheduleRow) {
  let start = parseScheduleDate(row.target_start);
  let due = parseScheduleDate(row.target_end);
  const statusDate = parseScheduleDate(row.budget_remaining);
  if (!due && statusDate) due = statusDate;
  const end = parseScheduleDate(row.actual_end);
  return { start, due, end };
}

function statusLabel(row: ScheduleRow): string {
  const raw = (row.budget_remaining || '').trim();
  if (raw && !parseScheduleDate(raw)) return raw;
  const end = (row.target_end || '').trim();
  if (end && !parseScheduleDate(end)) return end;
  return raw || 'Incomplete';
}

/** Flatten schedule tasks/subtasks across an employee's projects. */
export async function loadEmployeeTasks(
  projects: (ProjectNode & { clientName: string })[],
  employeeName: string,
  options?: { allowDemoSeed?: boolean },
): Promise<{ tasks: EmployeeTask[]; usedDemo: boolean }> {
  const allowDemoSeed = options?.allowDemoSeed === true;
  const priorities = loadPriorityMap();
  const tasks: EmployeeTask[] = [];
  let usedDemo = false;
  const slice = projects.slice(0, 50);

  await Promise.all(
    slice.map(async (p) => {
      const ensured = await ensureProjectSchedule({
        projectKey: p.key,
        clientName: p.clientName,
        title: p.title,
        autoSeed: false,
        autoDate: false,
      });
      let dbRows = ensured.rows;
      if (!dbRows.length && !ensured.error) {
        const loaded = await loadProjectSchedule(p.key);
        dbRows = loaded.rows;
      }
      const demo = allowDemoSeed
        ? buildDemoProjectDetail(p.key, p.clientName, managerFor(p, employeeName))
        : null;
      const rows = dbRows.length ? dbRows : demo?.rows || [];
      const writable = dbRows.length > 0;
      if (allowDemoSeed && !dbRows.length) usedDemo = true;

      const sections = groupScheduleSections(rows);
      for (const section of sections) {
        for (const row of section.items) {
          if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
          const label = (row.task || '').trim();
          if (!label) continue;

          const { start, due, end } = rowDates(row);
          const rawStatus = statusLabel(row);
          const complete = isCompleteStatus(rawStatus);
          const priority = priorities[row.id] || inferPriority(due, complete);
          const draft = { complete, start, due };
          const status = taskLifecycleStatus(draft);

          tasks.push({
            id: `${p.key}:${row.id}`,
            rowId: row.id,
            scheduleId: row.schedule_id,
            projectKey: p.key,
            projectTitle: p.title,
            clientName: p.clientName,
            phase: section.title,
            phaseId: section.id,
            kind: row.row_kind,
            task: label,
            startRaw: start ? fmtDate(start) : (row.target_start || '').trim(),
            dueRaw: due ? fmtDate(due) : (row.target_end || '').trim(),
            endRaw: end ? fmtDate(end) : (row.actual_end || '').trim(),
            start,
            due,
            end,
            status,
            complete,
            priority,
            assigneeName: (row.assignee_name || '').trim(),
            phaseManagerName: resolvePhaseManager(p, section.title),
            writable,
            datesAutofilled: isAutofilledAction(row.action),
          });
        }
      }
    }),
  );

  return { tasks, usedDemo };
}

export function sortEmployeeTasks(
  tasks: EmployeeTask[],
  key: TaskSortKey,
  dir: 'asc' | 'desc',
): EmployeeTask[] {
  const mul = dir === 'asc' ? 1 : -1;
  const dateVal = (d: Date | null) => (d ? d.getTime() : dir === 'asc' ? Number.POSITIVE_INFINITY : -1);

  return [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'project':
        cmp = a.projectTitle.localeCompare(b.projectTitle, undefined, { sensitivity: 'base' });
        break;
      case 'phase':
        cmp = a.phase.localeCompare(b.phase, undefined, { sensitivity: 'base' });
        break;
      case 'phaseManager':
        cmp = (a.phaseManagerName || '—').localeCompare(b.phaseManagerName || '—', undefined, {
          sensitivity: 'base',
        });
        break;
      case 'complete':
        cmp = Number(a.complete) - Number(b.complete);
        break;
      case 'priority':
        cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        break;
      case 'task':
        cmp = a.task.localeCompare(b.task, undefined, { sensitivity: 'base' });
        break;
      case 'assignee':
        cmp = (a.assigneeName || '—').localeCompare(b.assigneeName || '—', undefined, {
          sensitivity: 'base',
        });
        break;
      case 'start':
        cmp = dateVal(a.start) - dateVal(b.start);
        break;
      case 'due':
        cmp = dateVal(a.due) - dateVal(b.due);
        break;
      case 'end':
        cmp = dateVal(a.end) - dateVal(b.end);
        break;
      case 'status':
        cmp = LIFECYCLE_ORDER[a.status] - LIFECYCLE_ORDER[b.status];
        break;
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp * mul;
    return a.task.localeCompare(b.task, undefined, { sensitivity: 'base' });
  });
}

export async function setTaskComplete(
  task: EmployeeTask,
  complete: boolean,
): Promise<{ ok: boolean; error?: string; endRaw: string }> {
  const endRaw = complete ? fmtDate(startOfDay(new Date())) : '';
  const status = complete ? 'Completed' : 'Incomplete';
  if (!task.writable) {
    return { ok: true, endRaw };
  }
  const { error } = await supabase
    .from('pa_schedule_rows')
    .update({
      budget_remaining: status,
      actual_end: endRaw,
    })
    .eq('id', task.rowId);
  if (error) return { ok: false, error: error.message, endRaw };
  patchCachedScheduleRow(task.projectKey, task.rowId, {
    budget_remaining: status,
    actual_end: endRaw,
  });
  return { ok: true, endRaw };
}

/** Build EmployeeTask rows for a single project from schedule rows (already loaded). */
export function tasksFromScheduleRows(
  project: {
    key: string;
    title: string;
    clientName: string;
    row?: { manager?: string | null } | null;
    phases?: { label: string; row: { manager?: string | null; phase?: string | null } }[];
  },
  rows: ScheduleRow[],
  _employeeName: string,
  writable = true,
): EmployeeTask[] {
  const priorities = loadPriorityMap();
  const tasks: EmployeeTask[] = [];
  const sections = groupScheduleSections(rows);
  for (const section of sections) {
    for (const row of section.items) {
      if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
      const label = (row.task || '').trim();
      if (!label) continue;
      const { start, due, end } = rowDates(row);
      const rawStatus = statusLabel(row);
      const complete = isCompleteStatus(rawStatus);
      const priority = priorities[row.id] || inferPriority(due, complete);
      const status = taskLifecycleStatus({ complete, start, due });
      tasks.push({
        id: `${project.key}:${row.id}`,
        rowId: row.id,
        scheduleId: row.schedule_id,
        projectKey: project.key,
        projectTitle: project.title,
        clientName: project.clientName,
        phase: section.title,
        phaseId: section.id,
        kind: row.row_kind,
        task: label,
        startRaw: start ? fmtDate(start) : (row.target_start || '').trim(),
        dueRaw: due ? fmtDate(due) : (row.target_end || '').trim(),
        endRaw: end ? fmtDate(end) : (row.actual_end || '').trim(),
        start,
        due,
        end,
        status,
        complete,
        priority,
        assigneeName: (row.assignee_name || '').trim(),
        phaseManagerName: resolvePhaseManager(project, section.title),
        writable,
        datesAutofilled: isAutofilledAction(row.action),
      });
    }
  }
  return tasks;
}
