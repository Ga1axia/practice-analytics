import type { ScheduleRow } from './scheduleTypes';

export type ScheduleSection = {
  id: string;
  title: string;
  phaseRow: ScheduleRow | null;
  items: ScheduleRow[];
};

/**
 * Spreadsheet headers that were stored as `phase` but belong under a parent
 * process phase (Value Engineering sits inside Contractor Selection).
 */
export function isScheduleSubphaseTitle(title: string): boolean {
  return /^value engineering\b/i.test((title || '').trim());
}

export function isSchedulePhaseRow(row: Pick<ScheduleRow, 'row_kind' | 'task'>): boolean {
  return row.row_kind === 'phase' && !isScheduleSubphaseTitle(row.task);
}

const INTERIOR_PHASE_NOTE =
  /\s*\(\s*Schedule more defined once scope and timing of when we are starting is defined\s*\)\s*/i;

/** Phase labels shown in the UI (drops leftover spreadsheet notes). */
export function displayPhaseTitle(title: string): string {
  const cleaned = (title || '').replace(INTERIOR_PHASE_NOTE, '').trim();
  return cleaned || title || 'Untitled phase';
}

function asSectionTask(row: ScheduleRow): ScheduleRow {
  return row.row_kind === 'task' ? row : { ...row, row_kind: 'task' };
}

/** Group flat schedule rows into phase sections (plus a kickoff block before the first phase). */
export function groupScheduleSections(rows: ScheduleRow[]): ScheduleSection[] {
  const sections: ScheduleSection[] = [];
  let current: ScheduleSection = {
    id: 'kickoff',
    title: 'Project kickoff',
    phaseRow: null,
    items: [],
  };

  for (const row of rows) {
    if (row.row_kind === 'phase' && isScheduleSubphaseTitle(row.task) && (current.phaseRow || current.items.length)) {
      current.items.push(asSectionTask(row));
      continue;
    }
    if (isSchedulePhaseRow(row)) {
      if (current.items.length > 0 || current.phaseRow) {
        sections.push(current);
      } else if (sections.length === 0 && current.items.length === 0) {
        // drop empty kickoff if first row is a phase
      }
      current = {
        id: row.id,
        title: displayPhaseTitle(row.task),
        phaseRow: row,
        items: [],
      };
      continue;
    }
    current.items.push(row);
  }

  if (current.phaseRow || current.items.length) {
    sections.push(current);
  }

  return sections;
}

export function sectionStatus(section: ScheduleSection): string {
  const fromPhase = (section.phaseRow?.budget_remaining || '').trim();
  if (fromPhase) return fromPhase;

  const statuses = section.items
    .map((r) => r.budget_remaining.trim())
    .filter(Boolean);
  if (!statuses.length) return '';
  if (statuses.some((s) => /active/i.test(s) && !/not\s*active/i.test(s))) return 'Active';
  if (statuses.every((s) => /completed|n\/a/i.test(s))) return 'Completed';
  return '';
}

export type StatusTone = 'done' | 'active' | 'idle' | 'na' | 'date' | 'muted';

export function statusTone(value: string): StatusTone {
  const v = value.trim().toLowerCase();
  if (!v) return 'muted';
  if (v === 'completed' || v === 'done') return 'done';
  if (v === 'n/a' || v.includes('not applicable')) return 'na';
  if (v.includes('not active')) return 'idle';
  if (v === 'active' || (v.includes('active') && !v.includes('not'))) return 'active';
  if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v) || v === 'tbd') return 'date';
  return 'muted';
}

export function sectionProgress(section: ScheduleSection) {
  const countable = section.items.filter((r) => {
    const t = statusTone(r.budget_remaining);
    return t === 'done' || t === 'active' || t === 'idle' || t === 'date' || t === 'na';
  });
  const done = countable.filter((r) => {
    const t = statusTone(r.budget_remaining);
    return t === 'done' || t === 'na';
  }).length;
  return { done, total: countable.length || section.items.length };
}

export function defaultExpandedSectionIds(
  sections: ScheduleSection[],
  highlightPhase?: string | null,
): string[] {
  if (!sections.length) return [];
  const needle = (highlightPhase || '').trim().toLowerCase();
  if (needle) {
    const hit = sections.find((s) => {
      const title = s.title.toLowerCase();
      return title.includes(needle) || needle.includes(title) || title.includes(needle.split(' ')[0] || '');
    });
    if (hit) return [hit.id];
  }
  const active = sections.find((s) => /active/i.test(sectionStatus(s)) && !/not\s*active/i.test(sectionStatus(s)));
  if (active) return [active.id];
  return [];
}

/** Nest flat section items into task → subtask trees (by sort order). */
export type ScheduleTaskNode = {
  task: ScheduleRow;
  subtasks: ScheduleRow[];
};

export function nestSectionItems(items: ScheduleRow[]): ScheduleTaskNode[] {
  const trees: ScheduleTaskNode[] = [];
  let current: ScheduleTaskNode | null = null;
  for (const row of items) {
    if (row.row_kind === 'task') {
      current = { task: row, subtasks: [] };
      trees.push(current);
      continue;
    }
    if (row.row_kind === 'subtask') {
      if (current) current.subtasks.push(row);
      else trees.push({ task: row, subtasks: [] });
    }
  }
  return trees;
}
