import type { CoreProjectPhase } from './scheduleCorePhases';
import {
  ensureCorePhaseLeads,
  loadCorePhases,
} from './scheduleCorePhases';
import { invalidateScheduleCache } from './scheduleCache';
import type { SchedulePresetKind } from './scheduleAutofill';
import { parseProjectStartDate } from './scheduleAutofill';
import { buildDatedScheduleRows } from './scheduleDating';
import { buildResyncedScheduleRows } from './scheduleCoreResyncMerge';
import type { ScheduleRow } from './scheduleTypes';
import { supabase } from './supabase';
import { syncProjectMembersFromTimeEntries } from './projectMembers';

export type ResyncStats = {
  phasesAligned: number;
  phasesAdded: number;
  tasksAdded: number;
  leadsEnsured: number;
};

export { buildResyncedScheduleRows } from './scheduleCoreResyncMerge';

export async function persistResyncedScheduleRows(input: {
  projectKey: string;
  scheduleId: string;
  merged: ScheduleRow[];
  existing: ScheduleRow[];
}): Promise<{ ok: true; rows: ScheduleRow[] } | { ok: false; error: string }> {
  const mergedIds = new Set(input.merged.filter((r) => r.id).map((r) => r.id));
  const toDelete = input.existing.filter((r) => r.id && !mergedIds.has(r.id)).map((r) => r.id);

  for (const id of toDelete) {
    const { error } = await supabase.from('pa_schedule_rows').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
  }

  const final: ScheduleRow[] = [];

  for (const row of input.merged) {
    const payload = {
      schedule_id: input.scheduleId,
      sort_order: row.sort_order,
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
    };

    if (row.id) {
      const { data, error } = await supabase
        .from('pa_schedule_rows')
        .update(payload)
        .eq('id', row.id)
        .select('*')
        .single();
      if (error || !data) return { ok: false, error: error?.message || 'Update failed' };
      final.push(data as ScheduleRow);
    } else {
      const { data, error } = await supabase
        .from('pa_schedule_rows')
        .insert(payload)
        .select('*')
        .single();
      if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };
      final.push(data as ScheduleRow);
    }
  }

  invalidateScheduleCache(input.projectKey);

  return { ok: true, rows: final };
}

export async function resyncProjectScheduleFromCore(input: {
  projectKey: string;
  scheduleId: string;
  kickoff?: Date;
  preset?: SchedulePresetKind;
  corePhases?: CoreProjectPhase[];
  headerManager?: string | null;
  projectTitle?: string;
  projectCode?: string | null;
  clientName?: string;
}): Promise<
  | { ok: true; rows: ScheduleRow[]; stats: ResyncStats }
  | { ok: false; error: string }
> {
  const projectKey = input.projectKey.trim();
  if (!projectKey || !input.scheduleId) {
    return { ok: false, error: 'Schedule not ready' };
  }

  const { data: existing, error: loadErr } = await supabase
    .from('pa_schedule_rows')
    .select('*')
    .eq('schedule_id', input.scheduleId)
    .order('sort_order', { ascending: true });

  if (loadErr) return { ok: false, error: loadErr.message };

  const corePhases =
    input.corePhases?.length ? input.corePhases : await loadCorePhases(projectKey);
  if (!corePhases.length) {
    return { ok: false, error: 'No CORE phases on this project — sync from CORE first.' };
  }

  const kickoff =
    input.kickoff ||
    parseProjectStartDate(
      (
        await supabase
          .from('pa_schedules')
          .select('start_date')
          .eq('id', input.scheduleId)
          .maybeSingle()
      ).data?.start_date as string,
    ) ||
    new Date();

  const templateDrafts = buildDatedScheduleRows(kickoff, {
    preset: input.preset,
    includeDates: false,
    corePhaseTitles: corePhases.map((p) => p.title),
  });

  const { rows: merged, stats } = buildResyncedScheduleRows({
    scheduleId: input.scheduleId,
    existing: (existing || []) as ScheduleRow[],
    corePhases,
    templateDrafts,
  });

  const saved = await persistResyncedScheduleRows({
    projectKey,
    scheduleId: input.scheduleId,
    merged,
    existing: (existing || []) as ScheduleRow[],
  });
  if (!saved.ok) return saved;

  const leads = await ensureCorePhaseLeads({
    projectKey,
    headerManager: input.headerManager,
    phases: corePhases,
  });
  if (leads.error) {
    return { ok: false, error: leads.error };
  }

  const leadNames = [
    ...new Set(
      [
        input.headerManager,
        ...corePhases.map((p) => p.manager),
      ]
        .map((n) => (n || '').trim())
        .filter(Boolean),
    ),
  ];
  await syncProjectMembersFromTimeEntries({
    projectKey,
    projectTitle: input.projectTitle || projectKey,
    projectFullName: projectKey,
    projectCode: input.projectCode ?? null,
    leadNames,
  });

  return {
    ok: true,
    rows: saved.rows,
    stats: {
      ...stats,
      leadsEnsured: leads.ensured,
    },
  };
}
