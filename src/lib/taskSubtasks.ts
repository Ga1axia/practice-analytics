import type { ScheduleRow } from './scheduleTypes';

/** Subtask rows immediately following a parent task (until next task or phase). */
export function subtasksForParent(
  rows: ScheduleRow[],
  parentRowId: string,
): ScheduleRow[] {
  const sorted = [...rows].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const idx = sorted.findIndex((r) => r.id === parentRowId);
  if (idx < 0) return [];
  const parent = sorted[idx]!;
  if (parent.row_kind !== 'task') return [];

  const out: ScheduleRow[] = [];
  for (let i = idx + 1; i < sorted.length; i += 1) {
    const row = sorted[i]!;
    if (row.row_kind === 'phase' || row.row_kind === 'task') break;
    if (row.row_kind === 'subtask') out.push(row);
  }
  return out;
}

export function isSubtaskComplete(row: ScheduleRow): boolean {
  const s = (row.budget_remaining || '').trim().toLowerCase();
  return s === 'completed' || s === 'done' || s === 'n/a';
}
