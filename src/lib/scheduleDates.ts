import { displayPhaseTitle, isSchedulePhaseRow } from './scheduleSections';
import type { ScheduleRow } from './scheduleTypes';

const STATUS_WORDS =
  /^(completed|active|n\/a|na|tbd|done|not\s*active|not\s*applicable)/i;

/** Pull the first M/D/YYYY or YYYY-MM-DD date from a free-text schedule cell. */
export function parseScheduleDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || STATUS_WORDS.test(s)) return null;

  const iso = s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const us = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    let y = Number(us[3]);
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
}

export type DeadlineEvent = {
  id: string;
  rowId: string;
  task: string;
  kind: 'task' | 'subtask' | 'phase';
  section: string;
  date: Date;
  dateKey: string; // YYYY-MM-DD
  status: string;
  source: 'target_end' | 'target_start' | 'budget_remaining';
};

function dateKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pickDeadline(row: ScheduleRow): { date: Date; source: DeadlineEvent['source'] } | null {
  const end = parseScheduleDate(row.target_end);
  if (end) return { date: end, source: 'target_end' };
  const start = parseScheduleDate(row.target_start);
  if (start) return { date: start, source: 'target_start' };
  const statusDate = parseScheduleDate(row.budget_remaining);
  if (statusDate) return { date: statusDate, source: 'budget_remaining' };
  return null;
}

/**
 * Build calendar events for every task/subtask (and dated phases) on a schedule.
 * Dedupes identical task+date pairs that appear twice in exports.
 */
export function buildDeadlineEvents(
  rows: ScheduleRow[],
  sectionByRowId?: Map<string, string>,
): DeadlineEvent[] {
  const out: DeadlineEvent[] = [];
  const seen = new Set<string>();

  let section = 'Project';
  for (const row of rows) {
    if (isSchedulePhaseRow(row)) {
      section = displayPhaseTitle(row.task || 'Phase');
      continue; // calendar focuses on tasks/subtasks
    }
    if (row.row_kind !== 'task' && row.row_kind !== 'subtask') continue;

    const picked = pickDeadline(row);
    if (!picked) continue;
    const key = `${row.row_kind}|${(row.task || '').toLowerCase()}|${dateKey(picked.date)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${row.id}-${dateKey(picked.date)}`,
      rowId: row.id,
      task: row.task || 'Untitled',
      kind: row.row_kind,
      section: sectionByRowId?.get(row.id) || section,
      date: picked.date,
      dateKey: dateKey(picked.date),
      status: (row.budget_remaining || '').trim(),
      source: picked.source,
    });
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.task.localeCompare(b.task));
}

export function monthMatrix(year: number, monthIndex: number): (Date | null)[][] {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay(); // 0 Sun
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, monthIndex, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
