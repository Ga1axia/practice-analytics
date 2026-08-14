import { parseScheduleDate, startOfDay } from './scheduleDates';
import { groupScheduleSections, statusTone, type StatusTone } from './scheduleSections';
import type { ScheduleRow } from './scheduleTypes';

export type GanttBar = {
  id: string;
  label: string;
  kind: 'phase' | 'task' | 'subtask';
  section: string;
  start: Date;
  end: Date;
  status: string;
  tone: StatusTone;
  milestone: boolean;
  /** 0 = phase rollup, 1 = task, 2 = subtask */
  depth: number;
};

export type GanttFilter = 'all' | 'tasks' | 'subtasks' | 'deadlines';

function dayMs(d: Date) {
  return startOfDay(d).getTime();
}

/** Resolve a row's date range, tolerating swapped status/date columns. */
export function rowDateRange(
  row: ScheduleRow,
): { start: Date; end: Date; milestone: boolean } | null {
  let start = parseScheduleDate(row.target_start);
  let end = parseScheduleDate(row.target_end);
  const statusAsDate = parseScheduleDate(row.budget_remaining);

  // Common export quirk: date in status column, status word in target_end
  if (!end && statusAsDate) end = statusAsDate;
  if (!start && !end && statusAsDate) {
    start = statusAsDate;
    end = statusAsDate;
  }

  if (!start && !end) return null;
  if (start && !end) return { start, end: start, milestone: true };
  if (!start && end) return { start: end, end, milestone: true };
  if (start!.getTime() > end!.getTime()) {
    const tmp = start!;
    start = end!;
    end = tmp;
  }
  const milestone = dayMs(start!) === dayMs(end!);
  return { start: start!, end: end!, milestone };
}

/** Resolve display status, tolerating swapped status/date columns. */
export function rowStatusLabel(row: ScheduleRow): string {
  const raw = (row.budget_remaining || '').trim();
  if (raw && !parseScheduleDate(raw)) return raw;
  // If status cell held a date, try target_end for a status word
  const end = (row.target_end || '').trim();
  if (end && !parseScheduleDate(end)) return end;
  return raw;
}

function statusOf(row: ScheduleRow): string {
  return rowStatusLabel(row);
}

/**
 * Build Gantt bars for tasks, subtasks, and phase rollups from flat schedule rows.
 */
export function buildGanttBars(
  rows: ScheduleRow[],
  filter: GanttFilter = 'all',
): GanttBar[] {
  const sections = groupScheduleSections(rows);
  const bars: GanttBar[] = [];

  for (const section of sections) {
    const childBars: GanttBar[] = [];

    for (const row of section.items) {
      if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;
      const range = rowDateRange(row);
      if (!range) continue;

      const status = statusOf(row);
      const bar: GanttBar = {
        id: row.id,
        label: row.task || 'Untitled',
        kind: row.row_kind,
        section: section.title,
        start: range.start,
        end: range.end,
        status,
        tone: statusTone(status),
        milestone: range.milestone,
        depth: row.row_kind === 'subtask' ? 2 : 1,
      };

      if (filter === 'tasks' && row.row_kind !== 'task') continue;
      if (filter === 'subtasks' && row.row_kind !== 'subtask') continue;
      if (filter === 'deadlines' && !range.milestone) continue;

      childBars.push(bar);
    }

    if (!childBars.length) continue;

    // Phase rollup from children (skip when filtering to subtasks/deadlines only)
    if (filter === 'all' || filter === 'tasks') {
      const minStart = childBars.reduce(
        (a, b) => (b.start.getTime() < a.getTime() ? b.start : a),
        childBars[0]!.start,
      );
      const maxEnd = childBars.reduce(
        (a, b) => (b.end.getTime() > a.getTime() ? b.end : a),
        childBars[0]!.end,
      );
      const phaseStatus = (section.phaseRow && statusOf(section.phaseRow)) || '';
      bars.push({
        id: `phase-${section.id}`,
        label: section.title,
        kind: 'phase',
        section: section.title,
        start: minStart,
        end: maxEnd,
        status: phaseStatus,
        tone: statusTone(phaseStatus),
        milestone: dayMs(minStart) === dayMs(maxEnd),
        depth: 0,
      });
    }

    bars.push(...childBars);
  }

  return bars;
}

export function ganttTimelineBounds(bars: GanttBar[]): { start: Date; end: Date } | null {
  if (!bars.length) return null;
  let min = bars[0]!.start.getTime();
  let max = bars[0]!.end.getTime();
  for (const b of bars) {
    min = Math.min(min, b.start.getTime());
    max = Math.max(max, b.end.getTime());
  }
  const start = startOfDay(new Date(min));
  const end = startOfDay(new Date(max));
  // Pad a bit so bars aren't flush to edges
  start.setDate(start.getDate() - 7);
  end.setDate(end.getDate() + 14);
  if (end.getTime() <= start.getTime()) end.setDate(start.getDate() + 30);
  return { start, end };
}

/** Today through the next 6 days (7-day current/upcoming week window). */
export function upcomingWeekBounds(from: Date = new Date()): { start: Date; end: Date } {
  const start = startOfDay(from);
  const end = startOfDay(from);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

/** First through last day of the calendar month containing `from`. */
export function currentMonthBounds(from: Date = new Date()): { start: Date; end: Date } {
  const start = startOfDay(new Date(from.getFullYear(), from.getMonth(), 1));
  const end = startOfDay(new Date(from.getFullYear(), from.getMonth() + 1, 0));
  return { start, end };
}

export type GanttTickScale = 'week' | 'month' | 'custom';

export type GanttTick = { date: Date; label: string; major: boolean };

/** Month ticks (major) with optional week/day ticks. */
export function ganttTicks(
  start: Date,
  end: Date,
  scale: GanttTickScale,
): GanttTick[] {
  const spanDays = Math.max(daysBetween(start, end), 0) + 1;

  // Short windows → one tick per day
  if (spanDays <= 16) {
    const ticks: GanttTick[] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      ticks.push({
        date: new Date(cursor),
        label: cursor.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'numeric',
          day: 'numeric',
        }),
        major: true,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return ticks;
  }

  // Medium custom / month windows → week ticks
  if (scale === 'custom' || scale === 'month' || (scale === 'week' && spanDays <= 45)) {
    if (spanDays <= 45) {
      const ticks: GanttTick[] = [];
      const cursor = new Date(start);
      // Align to Monday-ish: step by 7 from start
      while (cursor.getTime() <= end.getTime()) {
        ticks.push({
          date: new Date(cursor),
          label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          major: true,
        });
        cursor.setDate(cursor.getDate() + 7);
      }
      return ticks;
    }
  }

  const ticks: GanttTick[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor.getTime() <= end.getTime()) {
    ticks.push({
      date: new Date(cursor),
      label: cursor.toLocaleString('en-US', { month: 'short', year: '2-digit' }),
      major: true,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((dayMs(b) - dayMs(a)) / 86400000);
}

export function barLeftPct(barStart: Date, rangeStart: Date, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return (daysBetween(rangeStart, barStart) / totalDays) * 100;
}

export function barWidthPct(start: Date, end: Date, totalDays: number): number {
  if (totalDays <= 0) return 0;
  const span = Math.max(daysBetween(start, end), 0) + 1; // inclusive
  return (span / totalDays) * 100;
}
