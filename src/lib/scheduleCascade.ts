import { clearScheduleDateSourceMarker } from './scheduleAutofill';
import { parseScheduleDate, startOfDay } from './scheduleDates';
import type { ScheduleRow } from './scheduleTypes';

/** Store dates as M/D/YYYY to match firm schedule cells. */
export function formatScheduleDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function shiftScheduleDateText(raw: string, deltaDays: number): string {
  const d = parseScheduleDate(raw);
  if (!d || !deltaDays) return raw;
  return formatScheduleDate(addDays(d, deltaDays));
}

/**
 * When a row's target_end moves, shift every later row's start/end by the same
 * day delta so relative gaps stay intact.
 */
export function cascadeRowsAfterEndEdit(
  rows: ScheduleRow[],
  rowId: string,
  newTargetEnd: string,
): ScheduleRow[] {
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx < 0) return rows;

  const edited = rows[idx]!;
  const oldEnd = parseScheduleDate(edited.target_end);
  const nextEnd = parseScheduleDate(newTargetEnd);
  if (!oldEnd || !nextEnd) {
    return rows.map((r) =>
      r.id === rowId
        ? {
            ...r,
            target_end: newTargetEnd,
            action: clearScheduleDateSourceMarker(r.action),
          }
        : r,
    );
  }

  const deltaDays = Math.round(
    (startOfDay(nextEnd).getTime() - startOfDay(oldEnd).getTime()) / 86_400_000,
  );
  if (!deltaDays) {
    return rows.map((r) =>
      r.id === rowId
        ? {
            ...r,
            target_end: newTargetEnd,
            action: clearScheduleDateSourceMarker(r.action),
          }
        : r,
    );
  }

  const editedSort = edited.sort_order ?? idx;

  return rows.map((r, i) => {
    if (r.id === rowId) {
      return {
        ...r,
        target_end: newTargetEnd,
        action: clearScheduleDateSourceMarker(r.action),
      };
    }
    const sort = r.sort_order ?? i;
    if (sort <= editedSort) return r;

    const nextStart = r.target_start
      ? shiftScheduleDateText(r.target_start, deltaDays)
      : r.target_start;
    const nextEndText = r.target_end
      ? shiftScheduleDateText(r.target_end, deltaDays)
      : r.target_end;
    if (nextStart === r.target_start && nextEndText === r.target_end) return r;
    return {
      ...r,
      target_start: nextStart,
      target_end: nextEndText,
    };
  });
}
