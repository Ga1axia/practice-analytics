import {
  clearInflightSchedule,
  getCachedSchedule,
  getInflightSchedule,
  setCachedSchedule,
  setInflightSchedule,
} from './scheduleCache';
import {
  buildDatedScheduleRows,
  proposeMissingDates,
} from './scheduleDating';
import type { ScheduleMeta, ScheduleRow } from './scheduleTypes';
import { supabase } from './supabase';

export type EnsureScheduleResult = {
  projectKey: string;
  created: boolean;
  dated: number;
  error?: string;
  meta: ScheduleMeta | null;
  rows: ScheduleRow[];
};

async function ensureProjectScheduleUncached(input: {
  projectKey: string;
  clientName: string;
  title: string;
  kickoff?: Date;
}): Promise<EnsureScheduleResult> {
  const kickoff = input.kickoff || new Date();
  const { data: existing, error: findErr } = await supabase
    .from('pa_schedules')
    .select('id, project_key, client_name, title')
    .eq('project_key', input.projectKey)
    .maybeSingle();

  if (findErr) {
    return {
      projectKey: input.projectKey,
      created: false,
      dated: 0,
      error: findErr.message,
      meta: null,
      rows: [],
    };
  }

  if (!existing) {
    const { data: created, error: cErr } = await supabase
      .from('pa_schedules')
      .insert({
        project_key: input.projectKey,
        client_name: input.clientName,
        title: `Project Schedule — ${input.title}`,
      })
      .select('id, project_key, client_name, title')
      .single();

    if (cErr || !created) {
      return {
        projectKey: input.projectKey,
        created: false,
        dated: 0,
        error: cErr?.message || 'Failed to create schedule',
        meta: null,
        rows: [],
      };
    }

    const drafts = buildDatedScheduleRows(kickoff);
    const payload = drafts.map((d) => ({
      schedule_id: created.id as string,
      ...d,
    }));
    const { data: inserted, error: iErr } = await supabase
      .from('pa_schedule_rows')
      .insert(payload)
      .select('*');

    if (iErr) {
      return {
        projectKey: input.projectKey,
        created: true,
        dated: 0,
        error: iErr.message,
        meta: created as ScheduleMeta,
        rows: [],
      };
    }

    return {
      projectKey: input.projectKey,
      created: true,
      dated: (inserted || []).length,
      meta: created as ScheduleMeta,
      rows: (inserted || []) as ScheduleRow[],
    };
  }

  const meta = existing as ScheduleMeta;
  const { data: rows, error: rErr } = await supabase
    .from('pa_schedule_rows')
    .select('*')
    .eq('schedule_id', meta.id)
    .order('sort_order');

  if (rErr) {
    return {
      projectKey: input.projectKey,
      created: false,
      dated: 0,
      error: rErr.message,
      meta,
      rows: [],
    };
  }

  let list = (rows || []) as ScheduleRow[];

  // Empty schedule shell → seed full template
  if (!list.length) {
    const drafts = buildDatedScheduleRows(kickoff);
    const payload = drafts.map((d) => ({
      schedule_id: meta.id,
      ...d,
    }));
    const { data: inserted, error: iErr } = await supabase
      .from('pa_schedule_rows')
      .insert(payload)
      .select('*');
    if (iErr) {
      return {
        projectKey: input.projectKey,
        created: false,
        dated: 0,
        error: iErr.message,
        meta,
        rows: [],
      };
    }
    return {
      projectKey: input.projectKey,
      created: false,
      dated: (inserted || []).length,
      meta,
      rows: (inserted || []) as ScheduleRow[],
    };
  }

  const missing = proposeMissingDates(list, kickoff);
  let dated = 0;
  for (const u of missing) {
    const { error } = await supabase
      .from('pa_schedule_rows')
      .update({
        target_start: u.target_start,
        target_end: u.target_end,
        budget_remaining: u.budget_remaining,
      })
      .eq('id', u.id);
    if (!error) dated += 1;
  }

  if (dated) {
    const { data: refreshed } = await supabase
      .from('pa_schedule_rows')
      .select('*')
      .eq('schedule_id', meta.id)
      .order('sort_order');
    list = (refreshed || list) as ScheduleRow[];
  }

  return {
    projectKey: input.projectKey,
    created: false,
    dated,
    meta,
    rows: list,
  };
}

/**
 * Create a schedule from the firm template when missing; fill undated rows when present.
 * Results are session-cached so page swaps do not re-seed / re-query.
 */
export async function ensureProjectSchedule(input: {
  projectKey: string;
  clientName: string;
  title: string;
  kickoff?: Date;
  forceRefresh?: boolean;
}): Promise<EnsureScheduleResult> {
  const key = input.projectKey;
  if (!input.forceRefresh) {
    const cached = getCachedSchedule(key);
    if (cached) return cached;
    const pending = getInflightSchedule(key);
    if (pending) return pending;
  }

  const promise = ensureProjectScheduleUncached(input)
    .then((result) => {
      if (!result.error || result.rows.length) setCachedSchedule(result);
      return result;
    })
    .finally(() => clearInflightSchedule(key));

  setInflightSchedule(key, promise);
  return promise;
}

/** Ensure schedules for a list of projects (capped). */
export async function ensureProjectSchedules(
  projects: { key: string; clientName: string; title: string }[],
  opts?: { limit?: number },
): Promise<{ created: number; dated: number; errors: string[] }> {
  const limit = opts?.limit ?? 40;
  const slice = projects.slice(0, limit);
  let created = 0;
  let dated = 0;
  const errors: string[] = [];

  // Sequential to avoid stampeding RLS/inserts
  for (const p of slice) {
    const res = await ensureProjectSchedule({
      projectKey: p.key,
      clientName: p.clientName,
      title: p.title,
    });
    if (res.created) created += 1;
    dated += res.dated;
    if (res.error) errors.push(`${p.title}: ${res.error}`);
  }

  return { created, dated, errors };
}
