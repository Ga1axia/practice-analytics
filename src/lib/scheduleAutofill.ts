import { classifyWorkType, type WorkType } from './workType';
import type { ScheduleRow } from './scheduleTypes';

/** Stored in `pa_schedule_rows.action` when dates came from a preset. */
export const AUTOFILL_MARKER = 'pa:autofill';

/** Stored when the firm checklist was seeded without dates (e.g. Interior). */
export const PRESET_STRUCTURE_MARKER = 'pa:preset';

const DISMISS_KEY = 'pa-sched-start-dismiss-v1';
const SESSION_LATER_KEY = 'pa-sched-start-later-v1';

/** The five schedule presets employees start from. */
export type SchedulePresetKind =
  | 'new_residence'
  | 'remodel'
  | 'adu'
  | 'interior'
  | 'commercial';

export const SCHEDULE_PRESET_KINDS: SchedulePresetKind[] = [
  'new_residence',
  'remodel',
  'adu',
  'interior',
  'commercial',
];

export const SCHEDULE_PRESET_LABELS: Record<SchedulePresetKind, string> = {
  new_residence: 'New residence',
  remodel: 'Remodel',
  adu: 'ADU',
  interior: 'Interior',
  commercial: 'Commercial',
};

/**
 * Phase length in calendar days from kickoff cascade.
 * Placeholder averages — replace with firm gaps when provided.
 */
export const PRESET_PHASE_DAYS: Record<SchedulePresetKind, Record<string, number>> = {
  new_residence: {
    'pre-design': 28,
    schematic: 56,
    planning: 112,
    contractor: 42,
    'design-dev': 21,
    cd: 90,
    construction: 14,
    additional: 60,
  },
  remodel: {
    'pre-design': 21,
    schematic: 42,
    planning: 70,
    contractor: 35,
    'design-dev': 21,
    cd: 70,
    construction: 14,
    additional: 45,
  },
  adu: {
    'pre-design': 21,
    schematic: 42,
    planning: 90,
    contractor: 35,
    'design-dev': 18,
    cd: 60,
    construction: 14,
    additional: 40,
  },
  /** Interior dates are manual — gaps unused when includeDates is false. */
  interior: {
    'pre-design': 14,
    schematic: 28,
    planning: 28,
    contractor: 21,
    'design-dev': 21,
    cd: 42,
    construction: 10,
    additional: 30,
  },
  commercial: {
    'pre-design': 35,
    schematic: 70,
    planning: 120,
    contractor: 49,
    'design-dev': 28,
    cd: 100,
    construction: 21,
    additional: 60,
  },
};

export function workTypeToPresetKind(workType: WorkType): SchedulePresetKind {
  switch (workType) {
    case 'New':
      return 'new_residence';
    case 'Remodel':
      return 'remodel';
    case 'ADU':
      return 'adu';
    case 'Interior':
      return 'interior';
    case 'Commercial':
      return 'commercial';
    default:
      return 'new_residence';
  }
}

export function inferSchedulePresetKind(
  projectTitle: string,
  explicitType?: string | null,
): SchedulePresetKind {
  return workTypeToPresetKind(classifyWorkType(projectTitle, explicitType));
}

/** Interior (and any future kinds) leave deadlines blank for manual entry. */
export function presetIncludesDates(kind: SchedulePresetKind): boolean {
  return kind !== 'interior';
}

export function isAutofilledAction(action: string | null | undefined): boolean {
  const a = (action || '').trim();
  return a === AUTOFILL_MARKER || a.startsWith(`${AUTOFILL_MARKER}|`);
}

export function isPresetStructureAction(action: string | null | undefined): boolean {
  const a = (action || '').trim();
  return a === PRESET_STRUCTURE_MARKER || a.startsWith(`${PRESET_STRUCTURE_MARKER}|`);
}

export function withAutofillMarker(existing?: string): string {
  const rest = (existing || '').trim();
  if (!rest || isAutofilledAction(rest) || isPresetStructureAction(rest)) return AUTOFILL_MARKER;
  return `${AUTOFILL_MARKER}|${rest}`;
}

export function withPresetStructureMarker(existing?: string): string {
  const rest = (existing || '').trim();
  if (!rest || isAutofilledAction(rest) || isPresetStructureAction(rest)) {
    return PRESET_STRUCTURE_MARKER;
  }
  return `${PRESET_STRUCTURE_MARKER}|${rest}`;
}

/** Strip autofill/preset markers when the user edits dates by hand. */
export function clearScheduleDateSourceMarker(action: string | null | undefined): string {
  const a = (action || '').trim();
  if (!a) return '';
  if (a === AUTOFILL_MARKER || a === PRESET_STRUCTURE_MARKER) return '';
  if (a.startsWith(`${AUTOFILL_MARKER}|`)) return a.slice(AUTOFILL_MARKER.length + 1);
  if (a.startsWith(`${PRESET_STRUCTURE_MARKER}|`)) {
    return a.slice(PRESET_STRUCTURE_MARKER.length + 1);
  }
  return a;
}

type DismissMap = Record<string, true>;

function readDismissMap(): DismissMap {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DismissMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDismissMap(map: DismissMap) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

function readSessionLater(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_LATER_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSessionLater(set: Set<string>) {
  try {
    sessionStorage.setItem(SESSION_LATER_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function isScheduleStartDismissed(projectKey: string): boolean {
  return Boolean(readDismissMap()[projectKey]);
}

export function isScheduleStartLaterThisSession(projectKey: string): boolean {
  return readSessionLater().has(projectKey);
}

export function dismissScheduleStartForever(projectKey: string) {
  const map = readDismissMap();
  map[projectKey] = true;
  writeDismissMap(map);
}

export function dismissScheduleStartLater(projectKey: string) {
  const set = readSessionLater();
  set.add(projectKey);
  writeSessionLater(set);
}

/**
 * True when the project has no real checklist tasks yet (needs the start prompt).
 * Phase-only shells or blank rows still count as "not started".
 */
export function scheduleNeedsStartPrompt(
  rowsLengthOrRows: number | Pick<ScheduleRow, 'row_kind' | 'task'>[],
  _hasMeta?: boolean,
): boolean {
  if (typeof rowsLengthOrRows === 'number') return rowsLengthOrRows === 0;
  return !rowsLengthOrRows.some(
    (r) =>
      (r.row_kind === 'task' || r.row_kind === 'subtask') && Boolean((r.task || '').trim()),
  );
}

export function shouldShowScheduleStartPrompt(
  projectKey: string,
  rows: number | Pick<ScheduleRow, 'row_kind' | 'task'>[],
  hasMeta = false,
): boolean {
  if (!scheduleNeedsStartPrompt(rows, hasMeta)) return false;
  // "Don't show again" only suppresses the big form — callers still show a Start CTA.
  if (isScheduleStartDismissed(projectKey)) return false;
  if (isScheduleStartLaterThisSession(projectKey)) return false;
  return true;
}

/** Clear forever + session dismiss so the start prompt can return. */
export function clearScheduleStartDismiss(projectKey: string) {
  const map = readDismissMap();
  delete map[projectKey];
  writeDismissMap(map);
  const later = readSessionLater();
  later.delete(projectKey);
  writeSessionLater(later);
}

const START_DATE_KEY = 'pa-project-start-date-v1';

type StartDateMap = Record<string, string>;

function readStartDateMap(): StartDateMap {
  try {
    const raw = localStorage.getItem(START_DATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StartDateMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStartDateMap(map: StartDateMap) {
  try {
    localStorage.setItem(START_DATE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Stored as M/D/YYYY (firm schedule text). */
export function getProjectStartDate(projectKey: string): string {
  return (readStartDateMap()[projectKey] || '').trim();
}

export function setProjectStartDate(projectKey: string, scheduleText: string) {
  const map = readStartDateMap();
  const v = scheduleText.trim();
  if (!v) delete map[projectKey];
  else map[projectKey] = v;
  writeStartDateMap(map);
}

/** Parse M/D/YYYY or return null. */
export function parseProjectStartDate(scheduleText: string): Date | null {
  const m = scheduleText.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
