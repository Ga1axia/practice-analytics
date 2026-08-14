import {
  AUTOFILL_MARKER,
  PRESET_PHASE_DAYS,
  PRESET_STRUCTURE_MARKER,
  presetIncludesDates,
  type SchedulePresetKind,
  withAutofillMarker,
  withPresetStructureMarker,
} from './scheduleAutofill';
import skeleton from './data/firmScheduleSkeleton.json';
import { matchProcessPhaseIndex, PROCESS_PHASES } from './architecturalProcess';
import { isSchedulePhaseRow } from './scheduleSections';
import { parseScheduleDate } from './scheduleDates';
import type { ScheduleRow, ScheduleRowKind } from './scheduleTypes';

type SkeletonRow = {
  sort_order: number;
  row_kind: ScheduleRowKind;
  task: string;
  na: boolean;
};

/** Fallback phase lengths when no preset is supplied (legacy / admin auto-seed). */
const PHASE_DAYS: Record<string, number> = {
  'pre-design': 28,
  schematic: 56,
  planning: 112,
  /** Includes selection + optional value-engineering window */
  contractor: 42,
  'design-dev': 21,
  cd: 90,
  construction: 14,
  additional: 60,
};

function phaseDaysForTitle(title: string, preset?: SchedulePresetKind): number {
  const idx = matchProcessPhaseIndex(title);
  const phaseId = idx >= 0 ? PROCESS_PHASES[idx]?.id : undefined;
  if (preset && phaseId) {
    const fromPreset = PRESET_PHASE_DAYS[preset][phaseId];
    if (fromPreset) return fromPreset;
  }
  if (phaseId && PHASE_DAYS[phaseId]) return PHASE_DAYS[phaseId]!;

  const t = title.toLowerCase();
  if (t.includes('value')) return 14;
  if (t.includes('interior')) return 70;
  if (t.includes('contractor')) return 28;
  if (t.includes('construction document')) return 90;
  if (t.includes('design development')) return 21;
  if (t.includes('planning')) return 112;
  if (t.includes('schematic')) return 56;
  if (t.includes('pre-design') || t.includes('predesign')) return 28;
  return 21;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function fmtUS(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function isNAStatus(s: string): boolean {
  return /^(n\/a|na|not\s*applicable)$/i.test(s.trim());
}

function isCompleteStatus(s: string): boolean {
  return /^(completed|complete|done)$/i.test(s.trim());
}

function hasDate(row: Pick<ScheduleRow, 'target_start' | 'target_end' | 'budget_remaining'>): boolean {
  return !!(
    parseScheduleDate(row.target_start) ||
    parseScheduleDate(row.target_end) ||
    parseScheduleDate(row.budget_remaining)
  );
}

export type DatedDraft = {
  sort_order: number;
  row_kind: ScheduleRowKind;
  task: string;
  budget_remaining: string;
  target_start: string;
  target_end: string;
  actual_start: string;
  actual_end: string;
  action: string;
  estimate_time: string;
  mdesigns_comments: string;
  client_comments: string;
  assignee_name: string;
};

export type BuildScheduleOptions = {
  /** Project kind — drives phase gap table. */
  preset?: SchedulePresetKind;
  /**
   * When false, seed checklist rows with empty target dates (Interior).
   * Defaults to true unless preset is Interior.
   */
  includeDates?: boolean;
};

/**
 * Build firm checklist rows with cascading target dates from kickoff.
 * Phases get rollup start/end; tasks/subtasks are spaced inside each phase.
 */
export function buildDatedScheduleRows(
  kickoff: Date = new Date(),
  options?: BuildScheduleOptions,
): DatedDraft[] {
  const preset = options?.preset;
  const includeDates =
    options?.includeDates ?? (preset ? presetIncludesDates(preset) : true);
  const rows = skeleton as SkeletonRow[];
  const out: DatedDraft[] = [];

  type PhaseBlock = { phase?: SkeletonRow; items: SkeletonRow[] };
  const blocks: PhaseBlock[] = [];
  let kickoffItems: SkeletonRow[] = [];
  let current: PhaseBlock | null = null;

  for (const r of rows) {
    if (r.row_kind === 'phase') {
      if (current) blocks.push(current);
      current = { phase: r, items: [] };
      continue;
    }
    if (!current) {
      kickoffItems.push(r);
      continue;
    }
    current.items.push(r);
  }
  if (current) blocks.push(current);

  let cursor = addDays(kickoff, 0);

  // Pre-phase kickoff tasks (contract, etc.) — 2-day steps before phase work
  for (const item of kickoffItems) {
    const start = cursor;
    const end = addDays(start, item.na ? 0 : 2);
    out.push(draftFromSkeleton(item, start, end, item.na ? 'N/A' : 'Active', includeDates));
    if (!item.na) cursor = addDays(end, 1);
  }

  for (const block of blocks) {
    const phaseTitle = block.phase?.task || 'Phase';
    const days = phaseDaysForTitle(phaseTitle, preset);
    const phaseStart = cursor;
    const phaseEnd = addDays(phaseStart, Math.max(days, 7));

    const activeItems = block.items.filter((i) => !i.na);
    const step =
      activeItems.length > 0 ? Math.max(2, Math.floor(days / Math.max(activeItems.length, 1))) : 7;

    if (block.phase) {
      out.push(draftFromSkeleton(block.phase, phaseStart, phaseEnd, 'Active', includeDates));
    }

    let itemCursor = phaseStart;
    for (const item of block.items) {
      if (item.na) {
        out.push(draftFromSkeleton(item, phaseStart, phaseStart, 'N/A', includeDates));
        continue;
      }
      const start = itemCursor;
      const end = addDays(start, Math.max(1, Math.floor(step * 0.7)));
      out.push(draftFromSkeleton(item, start, end, 'Active', includeDates));
      itemCursor = addDays(itemCursor, step);
      if (itemCursor.getTime() > phaseEnd.getTime()) itemCursor = phaseEnd;
    }

    cursor = addDays(phaseEnd, 1);
  }

  return out;
}

function draftFromSkeleton(
  item: SkeletonRow,
  start: Date,
  end: Date,
  status: string,
  includeDates: boolean,
): DatedDraft {
  const dated = includeDates && status !== 'N/A';
  return {
    sort_order: item.sort_order,
    row_kind: item.row_kind,
    task: item.task,
    budget_remaining: status,
    target_start: dated ? fmtUS(start) : '',
    target_end: dated ? fmtUS(end) : '',
    actual_start: '',
    actual_end: '',
    action: dated
      ? withAutofillMarker()
      : status === 'N/A'
        ? ''
        : withPresetStructureMarker(),
    estimate_time: '',
    mdesigns_comments: '',
    client_comments: '',
    assignee_name: '',
  };
}

/**
 * Fill empty dates on existing schedule rows in place (no overwrite of dated/completed/N/A).
 */
export function proposeMissingDates(
  rows: ScheduleRow[],
  kickoff: Date = new Date(),
  options?: { preset?: SchedulePresetKind },
): {
  id: string;
  target_start: string;
  target_end: string;
  budget_remaining: string;
  action: string;
}[] {
  const updates: {
    id: string;
    target_start: string;
    target_end: string;
    budget_remaining: string;
    action: string;
  }[] = [];

  let cursor = kickoff;
  let phaseDays = 28;
  let phaseEnd = addDays(kickoff, phaseDays);
  let itemsInPhase = 0;
  let step = 5;
  let itemCursor = kickoff;

  // First pass: count items per phase for spacing
  const phaseItemCounts = new Map<number, number>();
  let phaseIdx = -1;
  for (const row of rows) {
    if (isSchedulePhaseRow(row)) {
      phaseIdx += 1;
      phaseItemCounts.set(phaseIdx, 0);
      continue;
    }
    if (phaseIdx < 0) continue;
    if (!isNAStatus(row.budget_remaining) && !isCompleteStatus(row.budget_remaining)) {
      phaseItemCounts.set(phaseIdx, (phaseItemCounts.get(phaseIdx) || 0) + 1);
    }
  }

  phaseIdx = -1;
  for (const row of rows) {
    if (isSchedulePhaseRow(row)) {
      phaseIdx += 1;
      phaseDays = phaseDaysForTitle(row.task, options?.preset);
      phaseEnd = addDays(cursor, phaseDays);
      itemsInPhase = phaseItemCounts.get(phaseIdx) || 1;
      step = Math.max(2, Math.floor(phaseDays / Math.max(itemsInPhase, 1)));
      itemCursor = cursor;

      if (!hasDate(row) && !isCompleteStatus(row.budget_remaining) && !isNAStatus(row.budget_remaining)) {
        updates.push({
          id: row.id,
          target_start: fmtUS(cursor),
          target_end: fmtUS(phaseEnd),
          budget_remaining: row.budget_remaining?.trim() || 'Active',
          action: withAutofillMarker(row.action),
        });
      }
      cursor = addDays(phaseEnd, 1);
      continue;
    }

    if (isNAStatus(row.budget_remaining) || isCompleteStatus(row.budget_remaining)) continue;
    if (hasDate(row)) {
      const end = parseScheduleDate(row.target_end) || parseScheduleDate(row.target_start);
      if (end && end.getTime() >= itemCursor.getTime()) itemCursor = addDays(end, 1);
      continue;
    }

    const start = itemCursor;
    const end = addDays(start, Math.max(1, Math.floor(step * 0.7)));
    updates.push({
      id: row.id,
      target_start: fmtUS(start),
      target_end: fmtUS(end),
      budget_remaining: row.budget_remaining?.trim() || 'Active',
      action: withAutofillMarker(row.action),
    });
    itemCursor = addDays(itemCursor, step);
  }

  return updates;
}

/** Re-export markers for callers that only import dating. */
export { AUTOFILL_MARKER, PRESET_STRUCTURE_MARKER };
