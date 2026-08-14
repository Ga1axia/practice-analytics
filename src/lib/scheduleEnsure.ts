import {
  clearInflightSchedule,
  getCachedSchedule,
  getInflightSchedule,
  invalidateScheduleCache,
  setCachedSchedule,
  setInflightSchedule,
} from './scheduleCache';
import type { SchedulePresetKind } from './scheduleAutofill';
import { formatScheduleDate } from './scheduleMutations';
import {
  presetIncludesDates,
  setProjectStartDate,
} from './scheduleAutofill';
import {
  buildDatedScheduleRows,
  proposeMissingDates,
} from './scheduleDating';
import type { ScheduleMeta, ScheduleRow } from './scheduleTypes';
import { supabase } from './supabase';

const SCHEDULE_META_COLS = 'id, project_key, client_name, title, start_date';
const SCHEDULE_META_COLS_LEGACY = 'id, project_key, client_name, title';

async function loadScheduleMeta(projectKey: string): Promise<{
  meta: ScheduleMeta | null;
  error?: string;
}> {
  const full = await supabase
    .from('pa_schedules')
    .select(SCHEDULE_META_COLS)
    .eq('project_key', projectKey)
    .maybeSingle();

  if (!full.error) {
    return { meta: (full.data as ScheduleMeta | null) || null };
  }

  // Column missing until migration — fall back.
  if (/start_date/i.test(full.error.message)) {
    const legacy = await supabase
      .from('pa_schedules')
      .select(SCHEDULE_META_COLS_LEGACY)
      .eq('project_key', projectKey)
      .maybeSingle();
    if (legacy.error) return { meta: null, error: legacy.error.message };
    return { meta: (legacy.data as ScheduleMeta | null) || null };
  }

  return { meta: null, error: full.error.message };
}

async function persistScheduleStartDate(scheduleId: string, startDate: string) {
  const { error } = await supabase
    .from('pa_schedules')
    .update({ start_date: startDate })
    .eq('id', scheduleId);
  // Ignore missing-column until migration is applied.
  if (error && !/start_date/i.test(error.message)) {
    return error.message;
  }
  return null;
}

/** Save project start date for an existing schedule (local + DB when migrated). */
export async function saveProjectScheduleStartDate(input: {
  projectKey: string;
  scheduleId?: string | null;
  startDate: string;
}): Promise<{ ok: boolean; error?: string }> {
  setProjectStartDate(input.projectKey, input.startDate);
  if (input.scheduleId) {
    const err = await persistScheduleStartDate(input.scheduleId, input.startDate);
    if (err) return { ok: false, error: err };
  }
  return { ok: true };
}

export type EnsureScheduleResult = {
  projectKey: string;
  created: boolean;
  dated: number;
  error?: string;
  meta: ScheduleMeta | null;
  rows: ScheduleRow[];
};

export type EnsureScheduleOptions = {
  projectKey: string;
  clientName: string;
  title: string;
  kickoff?: Date;
  forceRefresh?: boolean;
  /**
   * When false, only load an existing schedule (do not create / seed).
   * Default true for admin/legacy callers.
   */
  autoSeed?: boolean;
  /**
   * When false, do not fill missing dates on existing undated rows.
   * Default true for admin/legacy callers.
   */
  autoDate?: boolean;
  /** Used when seeding / filling dates. */
  preset?: SchedulePresetKind;
};

async function ensureProjectScheduleUncached(
  input: EnsureScheduleOptions,
): Promise<EnsureScheduleResult> {
  const kickoff = input.kickoff || new Date();
  const kickoffText = formatScheduleDate(kickoff);
  const autoSeed = input.autoSeed !== false;
  const autoDate = input.autoDate !== false;

  const found = await loadScheduleMeta(input.projectKey);
  if (found.error) {
    return {
      projectKey: input.projectKey,
      created: false,
      dated: 0,
      error: found.error,
      meta: null,
      rows: [],
    };
  }
  const existing = found.meta;

  if (!existing) {
    if (!autoSeed) {
      return {
        projectKey: input.projectKey,
        created: false,
        dated: 0,
        meta: null,
        rows: [],
      };
    }

    const insertPayload: Record<string, string> = {
      project_key: input.projectKey,
      client_name: input.clientName,
      title: `Project Schedule — ${input.title}`,
      start_date: kickoffText,
    };

    let created: ScheduleMeta | null = null;
    let cErrMsg: string | undefined;

    {
      const { data, error } = await supabase
        .from('pa_schedules')
        .insert(insertPayload)
        .select(SCHEDULE_META_COLS)
        .single();
      if (error && /start_date/i.test(error.message)) {
        delete insertPayload.start_date;
        const legacy = await supabase
          .from('pa_schedules')
          .insert(insertPayload)
          .select(SCHEDULE_META_COLS_LEGACY)
          .single();
        created = (legacy.data as ScheduleMeta | null) || null;
        cErrMsg = legacy.error?.message;
      } else {
        created = (data as ScheduleMeta | null) || null;
        cErrMsg = error?.message;
      }
    }

    if (cErrMsg || !created) {
      // Concurrent create (unique project_key) — load the winner and continue seeding.
      if (cErrMsg && /duplicate|unique|already exists/i.test(cErrMsg)) {
        const again = await loadScheduleMeta(input.projectKey);
        if (again.meta) {
          const meta = again.meta;
          setProjectStartDate(input.projectKey, kickoffText);
          await persistScheduleStartDate(meta.id, kickoffText);
          const { data: existingRows } = await supabase
            .from('pa_schedule_rows')
            .select('*')
            .eq('schedule_id', meta.id)
            .order('sort_order');
          let list = (existingRows || []) as ScheduleRow[];
          if (!list.length && autoSeed) {
            const drafts = buildDatedScheduleRows(kickoff, {
              preset: input.preset,
              includeDates: input.preset ? presetIncludesDates(input.preset) : true,
            });
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
                meta: { ...meta, start_date: kickoffText },
                rows: [],
              };
            }
            list = (inserted || []) as ScheduleRow[];
          }
          return {
            projectKey: input.projectKey,
            created: false,
            dated: list.filter((r) => r.target_end).length,
            meta: { ...meta, start_date: kickoffText },
            rows: list,
          };
        }
      }
      return {
        projectKey: input.projectKey,
        created: false,
        dated: 0,
        error: cErrMsg || 'Failed to create schedule',
        meta: null,
        rows: [],
      };
    }

    setProjectStartDate(input.projectKey, kickoffText);
    await persistScheduleStartDate(created.id, kickoffText);

    const drafts = buildDatedScheduleRows(kickoff, {
      preset: input.preset,
      includeDates: input.preset ? presetIncludesDates(input.preset) : true,
    });
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
        meta: { ...created, start_date: kickoffText },
        rows: [],
      };
    }

    return {
      projectKey: input.projectKey,
      created: true,
      dated: (inserted || []).filter((r) => (r as ScheduleRow).target_end).length,
      meta: { ...created, start_date: kickoffText },
      rows: (inserted || []) as ScheduleRow[],
    };
  }

  const meta: ScheduleMeta = {
    ...existing,
    start_date: existing.start_date || '',
  };
  if (input.kickoff) {
    setProjectStartDate(input.projectKey, kickoffText);
    await persistScheduleStartDate(meta.id, kickoffText);
    meta.start_date = kickoffText;
  }
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
    if (!autoSeed) {
      return {
        projectKey: input.projectKey,
        created: false,
        dated: 0,
        meta,
        rows: [],
      };
    }
    const drafts = buildDatedScheduleRows(kickoff, {
      preset: input.preset,
      includeDates: input.preset ? presetIncludesDates(input.preset) : true,
    });
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
      dated: (inserted || []).filter((r) => (r as ScheduleRow).target_end).length,
      meta,
      rows: (inserted || []) as ScheduleRow[],
    };
  }

  if (!autoDate) {
    return {
      projectKey: input.projectKey,
      created: false,
      dated: 0,
      meta,
      rows: list,
    };
  }

  const missing = proposeMissingDates(list, kickoff, { preset: input.preset });
  let dated = 0;
  for (const u of missing) {
    const { error } = await supabase
      .from('pa_schedule_rows')
      .update({
        target_start: u.target_start,
        target_end: u.target_end,
        budget_remaining: u.budget_remaining,
        action: u.action,
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
 *
 * Pass `autoSeed: false` / `autoDate: false` from employee surfaces so new projects
 * wait for the start-schedule prompt instead of silent autofill.
 */
export async function ensureProjectSchedule(
  input: EnsureScheduleOptions,
): Promise<EnsureScheduleResult> {
  const key = input.projectKey;
  if (!input.forceRefresh) {
    const cached = getCachedSchedule(key);
    if (cached) return cached;
    const pending = getInflightSchedule(key);
    if (pending) return pending;
  }

  const promise = ensureProjectScheduleUncached(input)
    .then((result) => {
      // Only cache populated schedules (or hard errors). Empty / missing schedules
      // must not stick in cache or they block a later seed / Yes prompt apply.
      if (result.rows.length > 0 || result.error) setCachedSchedule(result);
      return result;
    })
    .finally(() => clearInflightSchedule(key));

  setInflightSchedule(key, promise);
  return promise;
}

/**
 * Employee said Yes on the start-schedule prompt: seed checklist from preset + kickoff.
 * Replaces empty / phase-only shells. Interior presets leave deadlines blank.
 */
export async function applyProjectSchedulePreset(input: {
  projectKey: string;
  clientName: string;
  title: string;
  kickoff: Date;
  preset: SchedulePresetKind;
}): Promise<EnsureScheduleResult> {
  invalidateScheduleCache(input.projectKey);

  const kickoff = input.kickoff;
  const kickoffText = formatScheduleDate(kickoff);
  const includeDates = presetIncludesDates(input.preset);

  const found = await loadScheduleMeta(input.projectKey);
  if (found.error) {
    return {
      projectKey: input.projectKey,
      created: false,
      dated: 0,
      error: found.error,
      meta: null,
      rows: [],
    };
  }

  let meta = found.meta;
  let created = false;

  if (!meta) {
    const insertPayload: Record<string, string> = {
      project_key: input.projectKey,
      client_name: input.clientName,
      title: `Project Schedule — ${input.title}`,
      start_date: kickoffText,
    };
    let { data, error } = await supabase
      .from('pa_schedules')
      .insert(insertPayload)
      .select(SCHEDULE_META_COLS)
      .single();

    if (error && /start_date/i.test(error.message)) {
      delete insertPayload.start_date;
      const legacy = await supabase
        .from('pa_schedules')
        .insert(insertPayload)
        .select(SCHEDULE_META_COLS_LEGACY)
        .single();
      data = legacy.data as typeof data;
      error = legacy.error;
    }

    if (error && /duplicate|unique|already exists/i.test(error.message)) {
      const again = await loadScheduleMeta(input.projectKey);
      meta = again.meta;
      if (!meta) {
        return {
          projectKey: input.projectKey,
          created: false,
          dated: 0,
          error: again.error || error.message,
          meta: null,
          rows: [],
        };
      }
    } else if (error || !data) {
      return {
        projectKey: input.projectKey,
        created: false,
        dated: 0,
        error: error?.message || 'Failed to create schedule',
        meta: null,
        rows: [],
      };
    } else {
      meta = data as ScheduleMeta;
      created = true;
    }
  }

  setProjectStartDate(input.projectKey, kickoffText);
  await persistScheduleStartDate(meta.id, kickoffText);
  meta = { ...meta, start_date: kickoffText };

  const { data: existingRows, error: loadErr } = await supabase
    .from('pa_schedule_rows')
    .select('*')
    .eq('schedule_id', meta.id)
    .order('sort_order');

  if (loadErr) {
    return {
      projectKey: input.projectKey,
      created,
      dated: 0,
      error: loadErr.message,
      meta,
      rows: [],
    };
  }

  let list = (existingRows || []) as ScheduleRow[];
  const hasTasks = list.some(
    (r) =>
      (r.row_kind === 'task' || r.row_kind === 'subtask') && Boolean((r.task || '').trim()),
  );

  // Empty or phase-only shell → wipe and seed the firm checklist.
  if (!hasTasks) {
    if (list.length) {
      const { error: delErr } = await supabase
        .from('pa_schedule_rows')
        .delete()
        .eq('schedule_id', meta.id);
      if (delErr) {
        return {
          projectKey: input.projectKey,
          created,
          dated: 0,
          error: delErr.message,
          meta,
          rows: list,
        };
      }
    }

    const drafts = buildDatedScheduleRows(kickoff, {
      preset: input.preset,
      includeDates,
    });
    const payload = drafts.map((d) => ({
      schedule_id: meta!.id,
      ...d,
    }));
    const { data: inserted, error: iErr } = await supabase
      .from('pa_schedule_rows')
      .insert(payload)
      .select('*');

    if (iErr || !inserted?.length) {
      return {
        projectKey: input.projectKey,
        created,
        dated: 0,
        error: iErr?.message || 'Checklist insert returned no rows',
        meta,
        rows: [],
      };
    }
    list = inserted as ScheduleRow[];
  } else if (includeDates) {
    const missing = proposeMissingDates(list, kickoff, { preset: input.preset });
    for (const u of missing) {
      await supabase
        .from('pa_schedule_rows')
        .update({
          target_start: u.target_start,
          target_end: u.target_end,
          budget_remaining: u.budget_remaining,
          action: u.action,
        })
        .eq('id', u.id);
    }
    if (missing.length) {
      const { data: refreshed } = await supabase
        .from('pa_schedule_rows')
        .select('*')
        .eq('schedule_id', meta.id)
        .order('sort_order');
      list = (refreshed || list) as ScheduleRow[];
    }
  }

  const result: EnsureScheduleResult = {
    projectKey: input.projectKey,
    created,
    dated: list.filter((r) => r.target_end).length,
    meta,
    rows: list,
  };
  setCachedSchedule(result);
  return result;
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
