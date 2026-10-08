import { matchProcessPhaseIndex } from './architecturalProcess';
import type { CoreProjectPhase } from './scheduleCorePhases';
import type { DatedDraft } from './scheduleDating';
import { serializePhaseRowMeta, parsePhaseRowMeta } from './schedulePhaseMeta';
import { groupScheduleSections, isSchedulePhaseRow } from './scheduleSections';
import type { ScheduleRow } from './scheduleTypes';

export type ResyncMergeStats = {
  phasesAligned: number;
  phasesAdded: number;
  tasksAdded: number;
};

function normTaskName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findMatchingSection(
  sections: ReturnType<typeof groupScheduleSections>,
  coreTitle: string,
  used: Set<string>,
) {
  const exact = sections.find(
    (s) => !used.has(s.id) && s.title.trim().toLowerCase() === coreTitle.trim().toLowerCase(),
  );
  if (exact) return exact;

  const idx = matchProcessPhaseIndex(coreTitle);
  if (idx < 0) return null;
  return (
    sections.find(
      (s) => !used.has(s.id) && matchProcessPhaseIndex(s.title) === idx,
    ) ?? null
  );
}

function templateItemsForCorePhase(
  coreTitle: string,
  templateDrafts: DatedDraft[],
): DatedDraft[] {
  const templateSections = groupScheduleSections(
    templateDrafts.map(
      (d, i) =>
        ({
          id: `t-${i}`,
          schedule_id: 'template',
          sort_order: d.sort_order,
          row_kind: d.row_kind,
          task: d.task,
          budget_remaining: d.budget_remaining,
          target_start: d.target_start,
          target_end: d.target_end,
          actual_start: d.actual_start,
          actual_end: d.actual_end,
          action: d.action,
          estimate_time: d.estimate_time,
          mdesigns_comments: d.mdesigns_comments,
          client_comments: d.client_comments,
          assignee_name: d.assignee_name,
        }) satisfies ScheduleRow,
    ),
  );
  const idx = matchProcessPhaseIndex(coreTitle);
  const hit =
    templateSections.find((s) => matchProcessPhaseIndex(s.title) === idx) ??
    templateSections.find(
      (s) => s.title.trim().toLowerCase() === coreTitle.trim().toLowerCase(),
    );
  if (!hit) return [];
  return hit.items.map((row, i) => ({
    sort_order: i,
    row_kind: row.row_kind,
    task: row.task,
    budget_remaining: row.budget_remaining,
    target_start: row.target_start,
    target_end: row.target_end,
    actual_start: row.actual_start,
    actual_end: row.actual_end,
    action: row.action,
    estimate_time: row.estimate_time,
    mdesigns_comments: row.mdesigns_comments,
    client_comments: row.client_comments,
    assignee_name: row.assignee_name,
  }));
}

function kickoffRowsBeforePhases(rows: ScheduleRow[]): ScheduleRow[] {
  const out: ScheduleRow[] = [];
  for (const row of rows) {
    if (isSchedulePhaseRow(row)) break;
    out.push(row);
  }
  return out;
}

/** Merge existing checklist with CORE phase order, managers, and missing template tasks. */
export function buildResyncedScheduleRows(input: {
  scheduleId: string;
  existing: ScheduleRow[];
  corePhases: CoreProjectPhase[];
  templateDrafts: DatedDraft[];
}): { rows: ScheduleRow[]; stats: ResyncMergeStats } {
  const sections = groupScheduleSections(input.existing);
  const usedSectionIds = new Set<string>();
  const out: ScheduleRow[] = [...kickoffRowsBeforePhases(input.existing)];
  let sortOrder = 0;
  let phasesAligned = 0;
  let phasesAdded = 0;
  let tasksAdded = 0;

  const pushRow = (row: ScheduleRow) => {
    out.push({ ...row, sort_order: sortOrder++ });
  };

  const draftToRow = (draft: DatedDraft, partial?: Partial<ScheduleRow>): ScheduleRow => ({
    id: partial?.id || '',
    schedule_id: input.scheduleId,
    sort_order: 0,
    row_kind: draft.row_kind,
    task: draft.task,
    budget_remaining: draft.budget_remaining,
    target_start: draft.target_start,
    target_end: draft.target_end,
    actual_start: draft.actual_start,
    actual_end: draft.actual_end,
    action: draft.action,
    estimate_time: draft.estimate_time,
    mdesigns_comments: draft.mdesigns_comments,
    client_comments: draft.client_comments,
    assignee_name: draft.assignee_name,
    ...partial,
  });

  for (const core of input.corePhases) {
    const section = findMatchingSection(sections, core.title, usedSectionIds);
    if (section) usedSectionIds.add(section.id);

    const existingNames = new Set(
      (section?.items ?? []).map((r) => normTaskName(r.task || '')).filter(Boolean),
    );

    let phaseRow: ScheduleRow;
    if (section?.phaseRow) {
      const { notes } = parsePhaseRowMeta(section.phaseRow.mdesigns_comments);
      const comments = serializePhaseRowMeta(notes, { manager: core.manager || undefined });
      const renamed = section.phaseRow.task.trim() !== core.title.trim();
      phaseRow = {
        ...section.phaseRow,
        task: core.title,
        mdesigns_comments: comments,
      };
      if (renamed || core.manager) phasesAligned += 1;
    } else {
      phasesAdded += 1;
      phaseRow = draftToRow(
        {
          sort_order: 0,
          row_kind: 'phase',
          task: core.title,
          budget_remaining: 'Active',
          target_start: '',
          target_end: '',
          actual_start: '',
          actual_end: '',
          action: '',
          estimate_time: '',
          mdesigns_comments: serializePhaseRowMeta('', { manager: core.manager || undefined }),
          client_comments: '',
          assignee_name: '',
        },
        { id: '' },
      );
    }
    pushRow(phaseRow);

    for (const item of section?.items ?? []) {
      pushRow(item);
    }

    for (const draft of templateItemsForCorePhase(core.title, input.templateDrafts)) {
      const name = normTaskName(draft.task);
      if (!name || existingNames.has(name)) continue;
      existingNames.add(name);
      tasksAdded += 1;
      pushRow(draftToRow(draft, { id: '' }));
    }
  }

  const coreTitleSet = new Set(
    input.corePhases.map((p) => p.title.trim().toLowerCase()).filter(Boolean),
  );

  for (const section of sections) {
    if (usedSectionIds.has(section.id)) continue;
    const title = section.title.trim();
    if (
      /^additional services$/i.test(title) &&
      title &&
      !coreTitleSet.has(title.toLowerCase())
    ) {
      continue;
    }
    if (section.phaseRow) pushRow(section.phaseRow);
    for (const item of section.items) pushRow(item);
  }

  return {
    rows: out,
    stats: { phasesAligned, phasesAdded, tasksAdded },
  };
}
