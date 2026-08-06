import { buildDemoProjectDetail } from './demoProjectDetail';
import { loadProjectSchedule } from './loadProjectSchedule';
import type { ProjectNode } from './projectListHierarchy';
import { parseScheduleDate, startOfDay } from './scheduleDates';
import { groupScheduleSections } from './scheduleSections';
import type { ScheduleRow } from './scheduleTypes';
import { supabase } from './supabase';

export type TaskPriority = 'Important' | 'Medium' | 'Low';

export type EmployeeTask = {
  id: string;
  rowId: string;
  scheduleId: string;
  projectKey: string;
  projectTitle: string;
  clientName: string;
  phase: string;
  kind: 'task' | 'subtask';
  task: string;
  startRaw: string;
  dueRaw: string;
  endRaw: string;
  start: Date | null;
  due: Date | null;
  end: Date | null;
  status: string;
  complete: boolean;
  priority: TaskPriority;
  mentionsEmployee: boolean;
  /** Demo rows can't be written back to Supabase. */
  writable: boolean;
};

export type TaskSortKey =
  | 'project'
  | 'phase'
  | 'complete'
  | 'priority'
  | 'task'
  | 'start'
  | 'due'
  | 'end'
  | 'status';

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

function mentionsName(task: string, employeeName: string): boolean {
  const first = employeeName.trim().split(/\s+/)[0] || '';
  if (first.length < 2) return false;
  const re = new RegExp(`(^|[^a-z])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
  return re.test(task);
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
): Promise<{ tasks: EmployeeTask[]; usedDemo: boolean }> {
  const priorities = loadPriorityMap();
  const tasks: EmployeeTask[] = [];
  let usedDemo = false;
  const slice = projects.slice(0, 50);

  await Promise.all(
    slice.map(async (p) => {
      const { rows: dbRows } = await loadProjectSchedule(p.key);
      const demo = buildDemoProjectDetail(p.key, p.clientName, managerFor(p, employeeName));
      const rows = dbRows.length ? dbRows : demo.rows;
      const writable = dbRows.length > 0;
      if (!dbRows.length) usedDemo = true;

      const sections = groupScheduleSections(rows);
      for (const section of sections) {
        for (const row of section.items) {
          if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
          const label = (row.task || '').trim();
          if (!label) continue;

          const { start, due, end } = rowDates(row);
          const status = statusLabel(row);
          const complete = isCompleteStatus(status);
          const priority = priorities[row.id] || inferPriority(due, complete);

          tasks.push({
            id: `${p.key}:${row.id}`,
            rowId: row.id,
            scheduleId: row.schedule_id,
            projectKey: p.key,
            projectTitle: p.title,
            clientName: p.clientName,
            phase: section.title,
            kind: row.row_kind,
            task: label,
            startRaw: start ? fmtDate(start) : (row.target_start || '').trim(),
            dueRaw: due ? fmtDate(due) : (row.target_end || '').trim(),
            endRaw: end ? fmtDate(end) : (row.actual_end || '').trim(),
            start,
            due,
            end,
            status: complete ? 'Complete' : status || 'Incomplete',
            complete,
            priority,
            mentionsEmployee: mentionsName(label, employeeName),
            writable,
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
      case 'complete':
        cmp = Number(a.complete) - Number(b.complete);
        break;
      case 'priority':
        cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        break;
      case 'task':
        cmp = a.task.localeCompare(b.task, undefined, { sensitivity: 'base' });
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
        cmp = a.status.localeCompare(b.status, undefined, { sensitivity: 'base' });
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
  return { ok: true, endRaw };
}
