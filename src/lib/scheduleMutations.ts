import { clearScheduleDateSourceMarker } from './scheduleAutofill';
import {
  cascadeRowsAfterEndEdit,
  formatScheduleDate,
} from './scheduleCascade';
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

export { cascadeRowsAfterEndEdit, formatScheduleDate } from './scheduleCascade';

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
      | 'assignee_name'
    >
  >,
): Promise<MutationResult> {
  const { error } = await supabase.from('pa_schedule_rows').update(fields).eq('id', rowId);
  if (error) return { ok: false, error: error.message };
  cachePatch(projectKey, rowId, fields);
  return { ok: true, data: undefined };
}

async function loadRowsForProject(projectKey: string, scheduleIdHint?: string): Promise<ScheduleRow[]> {
  const cached = getCachedSchedule(projectKey)?.rows;
  if (cached?.length) return cached;

  let scheduleId = scheduleIdHint || '';
  if (!scheduleId) {
    const { data: meta } = await supabase
      .from('pa_schedules')
      .select('id')
      .eq('project_key', projectKey)
      .maybeSingle();
    scheduleId = (meta?.id as string) || '';
  }
  if (!scheduleId) return [];

  const { data } = await supabase
    .from('pa_schedule_rows')
    .select('*')
    .eq('schedule_id', scheduleId)
    .order('sort_order');
  return (data || []) as ScheduleRow[];
}

export async function setScheduleRowDates(input: {
  projectKey: string;
  rowId: string;
  targetStart?: string;
  targetEnd?: string;
  /** Current action cell — used to clear autofill marker after a manual edit. */
  action?: string;
  /** Optional in-memory rows (avoids a reload; cascade uses these). */
  rows?: ScheduleRow[];
}): Promise<
  MutationResult<{
    target_start: string;
    target_end: string;
    action: string;
    /** Full row list after cascade (when end date shifted followers). */
    rows: ScheduleRow[];
  }>
> {
  const baseRows =
    input.rows ||
    (await loadRowsForProject(
      input.projectKey,
      getCachedSchedule(input.projectKey)?.meta?.id,
    ));

  // End-date edits cascade later deadlines; start-only edits stay local.
  if (input.targetEnd !== undefined) {
    const nextRows = cascadeRowsAfterEndEdit(baseRows, input.rowId, input.targetEnd);
    // If start was also provided on the edited row, apply it after cascade.
    const withStart =
      input.targetStart !== undefined
        ? nextRows.map((r) =>
            r.id === input.rowId
              ? {
                  ...r,
                  target_start: input.targetStart!,
                  action: clearScheduleDateSourceMarker(r.action),
                }
              : r,
          )
        : nextRows;

    const changed = withStart.filter((r) => {
      const prev = baseRows.find((b) => b.id === r.id);
      if (!prev) return true;
      return (
        prev.target_start !== r.target_start ||
        prev.target_end !== r.target_end ||
        prev.action !== r.action
      );
    });

    for (const r of changed) {
      const { error } = await supabase
        .from('pa_schedule_rows')
        .update({
          target_start: r.target_start,
          target_end: r.target_end,
          action: r.action,
        })
        .eq('id', r.id);
      if (error) return { ok: false, error: error.message };
    }

    const cached = getCachedSchedule(input.projectKey);
    if (cached) {
      setCachedSchedule({ ...cached, rows: withStart });
    } else {
      invalidateScheduleCache(input.projectKey);
    }

    const edited = withStart.find((r) => r.id === input.rowId);
    return {
      ok: true,
      data: {
        target_start: edited?.target_start ?? input.targetStart ?? '',
        target_end: edited?.target_end ?? input.targetEnd ?? '',
        action: edited?.action ?? '',
        rows: withStart,
      },
    };
  }

  const fields: { target_start?: string; target_end?: string; action?: string } = {};
  if (input.targetStart !== undefined) fields.target_start = input.targetStart;
  if (input.action !== undefined) {
    fields.action = clearScheduleDateSourceMarker(input.action);
  } else {
    const cached = baseRows.find((r) => r.id === input.rowId);
    if (cached) fields.action = clearScheduleDateSourceMarker(cached.action);
  }
  const res = await updateScheduleRowFields(input.projectKey, input.rowId, fields);
  if (!res.ok) return res;

  const nextRows = baseRows.map((r) =>
    r.id === input.rowId ? { ...r, ...fields } : r,
  );
  const cached = getCachedSchedule(input.projectKey);
  if (cached) setCachedSchedule({ ...cached, rows: nextRows });

  return {
    ok: true,
    data: {
      target_start: fields.target_start ?? '',
      target_end: '',
      action: fields.action ?? '',
      rows: nextRows,
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

export async function setScheduleAssignee(input: {
  projectKey: string;
  rowId: string;
  assigneeName: string;
}): Promise<MutationResult> {
  return updateScheduleRowFields(input.projectKey, input.rowId, {
    assignee_name: input.assigneeName.trim(),
  });
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
  assigneeName?: string;
  /** Place the new row immediately after this row (clone). */
  afterRowId?: string;
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

  const afterRow = input.afterRowId
    ? (rows as ScheduleRow[]).find((r) => r.id === input.afterRowId)
    : null;

  let sortOrder: number;
  if (afterRow) {
    sortOrder = (afterRow.sort_order || 0) + 1;
  } else if (section) {
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
    assignee_name: (input.assigneeName || '').trim(),
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

function cloneTaskName(name: string): string {
  const trimmed = name.trim();
  const m = trimmed.match(/^(.*) \(copy(?: (\d+))?\)$/i);
  if (m) {
    const n = m[2] ? Number(m[2]) + 1 : 2;
    return `${m[1]} (copy ${n})`;
  }
  return `${trimmed} (copy)`;
}

/** Clone a task into the same phase, immediately after the source row. */
export async function duplicateScheduleTask(input: {
  projectKey: string;
  scheduleId: string;
  rowId: string;
  phaseTitle: string;
  task: string;
  kind?: 'task' | 'subtask';
  targetStart?: string;
  targetEnd?: string;
  assigneeName?: string;
}): Promise<MutationResult<ScheduleRow>> {
  return createScheduleTask({
    projectKey: input.projectKey,
    scheduleId: input.scheduleId,
    phaseTitle: input.phaseTitle,
    task: cloneTaskName(input.task),
    kind: input.kind,
    targetStart: input.targetStart,
    targetEnd: input.targetEnd,
    assigneeName: input.assigneeName,
    afterRowId: input.rowId,
  });
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
