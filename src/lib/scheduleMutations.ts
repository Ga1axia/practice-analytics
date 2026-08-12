import {
  invalidateScheduleCache,
  patchCachedScheduleRow,
  getCachedSchedule,
  setCachedSchedule,
} from './scheduleCache';
import { parseScheduleDate, startOfDay } from './scheduleDates';
import { groupScheduleSections } from './scheduleSections';
import type { ScheduleRow, ScheduleRowKind } from './scheduleTypes';
import { supabase } from './supabase';

export type MutationResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/** Store dates as M/D/YYYY to match firm schedule cells. */
export function formatScheduleDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** `<input type="date">` value (YYYY-MM-DD) ↔ schedule cell text. */
export function toDateInputValue(raw: string | Date | null | undefined): string {
  const d = raw instanceof Date ? raw : parseScheduleDate(typeof raw === 'string' ? raw : '');
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInputValue(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return '';
  return formatScheduleDate(startOfDay(d));
}

function cachePatch(
  projectKey: string,
  rowId: string,
  patch: Partial<ScheduleRow>,
) {
  const ok = patchCachedScheduleRow(projectKey, rowId, patch as never);
  if (!ok) invalidateScheduleCache(projectKey);
}

export async function updateScheduleRowFields(
  projectKey: string,
  rowId: string,
  fields: Partial<
    Pick<
      ScheduleRow,
      | 'task'
      | 'budget_remaining'
      | 'target_start'
      | 'target_end'
      | 'actual_start'
      | 'actual_end'
      | 'action'
      | 'estimate_time'
      | 'mdesigns_comments'
      | 'client_comments'
    >
  >,
): Promise<MutationResult> {
  const { error } = await supabase.from('pa_schedule_rows').update(fields).eq('id', rowId);
  if (error) return { ok: false, error: error.message };
  cachePatch(projectKey, rowId, fields);
  return { ok: true, data: undefined };
}

export async function setScheduleRowDates(input: {
  projectKey: string;
  rowId: string;
  targetStart?: string;
  targetEnd?: string;
}): Promise<MutationResult<{ target_start: string; target_end: string }>> {
  const fields: { target_start?: string; target_end?: string } = {};
  if (input.targetStart !== undefined) fields.target_start = input.targetStart;
  if (input.targetEnd !== undefined) fields.target_end = input.targetEnd;
  const res = await updateScheduleRowFields(input.projectKey, input.rowId, fields);
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      target_start: fields.target_start ?? '',
      target_end: fields.target_end ?? '',
    },
  };
}

export async function renameScheduleTask(input: {
  projectKey: string;
  rowId: string;
  task: string;
}): Promise<MutationResult> {
  const task = input.task.trim();
  if (!task) return { ok: false, error: 'Task name is required' };
  return updateScheduleRowFields(input.projectKey, input.rowId, { task });
}

export async function createScheduleTask(input: {
  projectKey: string;
  scheduleId: string;
  /** Phase title to insert under (matches section title). */
  phaseTitle: string;
  task: string;
  kind?: 'task' | 'subtask';
  targetStart?: string;
  targetEnd?: string;
  /** Existing rows for sort_order placement (optional — reads cache if omitted). */
  rows?: ScheduleRow[];
}): Promise<MutationResult<ScheduleRow>> {
  const task = input.task.trim();
  if (!task) return { ok: false, error: 'Task name is required' };
  if (!input.scheduleId) return { ok: false, error: 'Schedule not ready yet' };

  const rows =
    input.rows ||
    getCachedSchedule(input.projectKey)?.rows ||
    (
      await supabase
        .from('pa_schedule_rows')
        .select('*')
        .eq('schedule_id', input.scheduleId)
        .order('sort_order', { ascending: true })
    ).data ||
    [];

  const sections = groupScheduleSections(rows as ScheduleRow[]);
  const section =
    sections.find((s) => s.title === input.phaseTitle) ||
    sections.find((s) => s.title.toLowerCase() === input.phaseTitle.toLowerCase()) ||
    null;

  let sortOrder: number;
  if (section) {
    const last = section.items[section.items.length - 1];
    const after = last?.sort_order ?? section.phaseRow?.sort_order ?? 0;
    sortOrder = after + 1;
  } else {
    const max = (rows as ScheduleRow[]).reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
    sortOrder = max + 1;
  }

  // Shift following rows so the new task sits in the right phase block.
  const toShift = (rows as ScheduleRow[]).filter((r) => (r.sort_order || 0) >= sortOrder);
  if (toShift.length) {
    await Promise.all(
      toShift.map((r) =>
        supabase
          .from('pa_schedule_rows')
          .update({ sort_order: (r.sort_order || 0) + 1 })
          .eq('id', r.id),
      ),
    );
  }

  const kind: ScheduleRowKind = input.kind || 'task';
  const draft = {
    schedule_id: input.scheduleId,
    sort_order: sortOrder,
    row_kind: kind,
    task,
    budget_remaining: 'Active',
    target_start: input.targetStart || '',
    target_end: input.targetEnd || '',
    actual_start: '',
    actual_end: '',
    action: '',
    estimate_time: '',
    mdesigns_comments: '',
    client_comments: '',
  };

  const { data, error } = await supabase
    .from('pa_schedule_rows')
    .insert(draft)
    .select('*')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message || 'Could not create task' };
  }

  const created = data as ScheduleRow;
  const cached = getCachedSchedule(input.projectKey);
  if (cached) {
    const nextRows = cached.rows
      .map((r) =>
        (r.sort_order || 0) >= sortOrder ? { ...r, sort_order: (r.sort_order || 0) + 1 } : r,
      )
      .concat([created])
      .sort((a, b) => a.sort_order - b.sort_order);
    setCachedSchedule({ ...cached, rows: nextRows });
  } else {
    invalidateScheduleCache(input.projectKey);
  }

  return { ok: true, data: created };
}

export async function deleteScheduleRow(input: {
  projectKey: string;
  rowId: string;
}): Promise<MutationResult> {
  const { error } = await supabase.from('pa_schedule_rows').delete().eq('id', input.rowId);
  if (error) return { ok: false, error: error.message };
  invalidateScheduleCache(input.projectKey);
  return { ok: true, data: undefined };
}

/** Distinct phase titles from schedule rows (for add-task pickers). */
export function phaseTitlesFromRows(rows: ScheduleRow[]): string[] {
  return groupScheduleSections(rows)
    .filter((s) => s.phaseRow || s.items.length)
    .map((s) => s.title);
}
