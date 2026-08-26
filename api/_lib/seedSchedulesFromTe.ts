import type { SupabaseClient } from '@supabase/supabase-js';
import {
  inferSchedulePresetKind,
  parseProjectStartDate,
} from '../../src/lib/scheduleAutofill';
import { parseScheduleDate, startOfDay } from '../../src/lib/scheduleDates';
import { buildDatedScheduleRows } from '../../src/lib/scheduleDating';
import { extractJobCode } from './projectHoursFilter.js';

function isoToMdY(iso: string): string | null {
  const m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${Number(m[2])}/${Number(m[3])}/${Number(m[1])}`;
}

function minIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return a < b ? a : b;
}

function withHistoricalStatus<
  T extends { budget_remaining: string; target_end: string; actual_end: string },
>(draft: T, today: Date): T {
  if (/^(n\/a|na|not\s*applicable)$/i.test(draft.budget_remaining)) return draft;
  const end = parseScheduleDate(draft.target_end);
  if (!end || startOfDay(end).getTime() >= today.getTime()) return draft;
  return {
    ...draft,
    budget_remaining: 'Completed',
    actual_end: draft.target_end,
  };
}

async function deleteRowsForSchedule(sb: SupabaseClient, scheduleId: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { data, error } = await sb
      .from('pa_schedule_rows')
      .delete()
      .eq('schedule_id', scheduleId)
      .select('id');
    if (error) throw new Error(error.message);
    const n = data?.length ?? 0;
    deleted += n;
    if (n === 0) break;
  }
  return deleted;
}

export type SeedSchedulesFromTeResult = {
  scannedTe: number;
  codesWithHours: number;
  projectHeaders: number;
  wouldUpdateStarts: number;
  wouldInsertSchedules: number;
  wouldFillRows: number;
  wouldSkipProtected: number;
  updatedStarts: number;
  insertedSchedules: number;
  filledRows: number;
  skippedProtected: number;
  deletedOldRows: number;
};

/**
 * From time entries: set schedule start_date = first work_date per job code,
 * create missing schedule shells, and seed firm checklist rows (dated from kickoff).
 * Skips schedules that already have hand-edited rows unless forceWipe is true.
 */
export async function seedSchedulesFromTimeEntries(
  sb: SupabaseClient,
  opts: { dryRun?: boolean; forceWipe?: boolean } = {},
): Promise<SeedSchedulesFromTeResult> {
  const dryRun = Boolean(opts.dryRun);
  const forceWipe = Boolean(opts.forceWipe);
  const today = startOfDay(new Date());

  const firstByCode = new Map<string, string>(); // code → YYYY-MM-DD
  let scannedTe = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_time_entries')
      .select('work_date, project_name, parent_project_name, actual_hours')
      .not('work_date', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    scannedTe += data.length;
    for (const row of data) {
      const hours = Number((row as { actual_hours?: number }).actual_hours) || 0;
      if (hours <= 0) continue;
      const iso = String((row as { work_date: string }).work_date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      for (const code of [
        extractJobCode((row as { parent_project_name?: string }).parent_project_name),
        extractJobCode((row as { project_name?: string }).project_name),
      ]) {
        if (!code) continue;
        firstByCode.set(code, minIso(firstByCode.get(code), iso));
      }
    }
    if (data.length < 1000) break;
  }

  const projects: { project: string; client: string | null; type: string | null; row_kind: string | null }[] =
    [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_projects')
      .select('project, client, type, row_kind')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    projects.push(...(data as typeof projects));
    if (data.length < 1000) break;
  }
  const headers = projects.filter((p) => p.row_kind === 'project');
  const typeByProject = new Map(headers.map((p) => [p.project, p.type]));

  const schedules: {
    id: string;
    project_key: string;
    client_name: string | null;
    title: string | null;
    start_date: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_schedules')
      .select('id, project_key, client_name, title, start_date')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    schedules.push(...(data as typeof schedules));
    if (data.length < 1000) break;
  }
  const scheduleByKey = new Map(schedules.map((s) => [s.project_key, s]));

  const rowCounts = new Map<string, number>();
  const handEdited = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_schedule_rows')
      .select('schedule_id, action')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data as { schedule_id: string; action: string | null }[]) {
      rowCounts.set(r.schedule_id, (rowCounts.get(r.schedule_id) || 0) + 1);
      const a = (r.action || '').toLowerCase();
      if (a && !a.includes('pa:autofill') && !a.includes('pa:preset')) {
        handEdited.add(r.schedule_id);
      }
    }
    if (data.length < 1000) break;
  }

  type Plan = {
    projectKey: string;
    client: string;
    title: string;
    startDate: string;
    scheduleId: string | null;
    needInsert: boolean;
    needStartUpdate: boolean;
    needFillRows: boolean;
    protected: boolean;
  };

  const plans: Plan[] = [];

  for (const h of headers) {
    const code = extractJobCode(h.project);
    if (!code) continue;
    const iso = firstByCode.get(code);
    if (!iso) continue;
    const startDate = isoToMdY(iso);
    if (!startDate || !parseProjectStartDate(startDate)) continue;

    const existing = scheduleByKey.get(h.project);
    const scheduleId = existing?.id || null;
    const needInsert = !existing;
    const needStartUpdate =
      !existing || (existing.start_date || '').trim() !== startDate;
    const count = scheduleId ? rowCounts.get(scheduleId) || 0 : 0;
    const isProtected = !!(scheduleId && handEdited.has(scheduleId) && !forceWipe);

    let fill = false;
    if (!isProtected) {
      if (count === 0) fill = true;
      else if (forceWipe) fill = true;
      else if (scheduleId && !handEdited.has(scheduleId)) fill = true;
    }

    plans.push({
      projectKey: h.project,
      client: h.client || existing?.client_name || '',
      title: existing?.title || h.project,
      startDate,
      scheduleId,
      needInsert,
      needStartUpdate,
      needFillRows: fill,
      protected: isProtected,
    });
  }

  const result: SeedSchedulesFromTeResult = {
    scannedTe,
    codesWithHours: firstByCode.size,
    projectHeaders: headers.length,
    wouldUpdateStarts: plans.filter((p) => p.needStartUpdate && !p.needInsert).length,
    wouldInsertSchedules: plans.filter((p) => p.needInsert).length,
    wouldFillRows: plans.filter((p) => p.needFillRows).length,
    wouldSkipProtected: plans.filter((p) => p.protected).length,
    updatedStarts: 0,
    insertedSchedules: 0,
    filledRows: 0,
    skippedProtected: plans.filter((p) => p.protected).length,
    deletedOldRows: 0,
  };

  if (dryRun) return result;

  for (const plan of plans) {
    let scheduleId = plan.scheduleId;

    if (plan.needInsert) {
      const { data, error } = await sb
        .from('pa_schedules')
        .insert({
          project_key: plan.projectKey,
          client_name: plan.client,
          title: plan.title,
          start_date: plan.startDate,
        })
        .select('id')
        .single();
      if (error) throw new Error(`Insert schedule ${plan.projectKey}: ${error.message}`);
      scheduleId = (data as { id: string }).id;
      result.insertedSchedules += 1;
    } else if (plan.needStartUpdate && scheduleId) {
      const { error } = await sb
        .from('pa_schedules')
        .update({ start_date: plan.startDate })
        .eq('id', scheduleId);
      if (error) throw new Error(`Update start ${plan.projectKey}: ${error.message}`);
      result.updatedStarts += 1;
    }

    if (!plan.needFillRows || !scheduleId) continue;

    result.deletedOldRows += await deleteRowsForSchedule(sb, scheduleId);

    const kickoff = parseProjectStartDate(plan.startDate)!;
    const explicit = typeByProject.get(plan.projectKey) ?? null;
    const preset = inferSchedulePresetKind(plan.projectKey, explicit);
    const drafts = buildDatedScheduleRows(kickoff, {
      preset,
      includeDates: true,
    }).map((d) => withHistoricalStatus(d, today));

    const payload = drafts.map((d) => ({
      schedule_id: scheduleId!,
      ...d,
    }));
    const { error } = await sb.from('pa_schedule_rows').insert(payload);
    if (error) throw new Error(`Fill rows ${plan.projectKey}: ${error.message}`);
    result.filledRows += 1;
  }

  return result;
}
