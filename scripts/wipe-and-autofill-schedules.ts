/**
 * Wipe schedule rows and autofill the firm checklist from each schedule's
 * start_date. Every non-N/A task/phase gets target_start + target_end cascaded
 * from kickoff (including Interior). Rows whose end is before today are marked
 * Completed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/wipe-and-autofill-schedules.ts
 *   npx tsx --env-file=.env.local scripts/wipe-and-autofill-schedules.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import {
  inferSchedulePresetKind,
  parseProjectStartDate,
  type SchedulePresetKind,
} from '../src/lib/scheduleAutofill';
import { parseScheduleDate, startOfDay } from '../src/lib/scheduleDates';
import { buildDatedScheduleRows } from '../src/lib/scheduleDating';
import { classifyWorkType } from '../src/lib/workType';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');
const CODE_RE = /\b(\d{2}-\d{3})\b/;

if (!url || !service) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAll<T extends Record<string, unknown>>(
  table: string,
  cols: string,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb.from(table).select(cols).range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

function isoToMdY(iso: string): string | null {
  const m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${Number(m[2])}/${Number(m[3])}/${Number(m[1])}`;
}

function extractCode(s: string): string | null {
  const m = String(s || '').match(CODE_RE);
  return m ? m[1] : null;
}

function fmtUS(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

async function firstTimeEntryDate(code: string): Promise<string | null> {
  const { data, error } = await sb
    .from('pa_time_entries')
    .select('work_date')
    .or(`project_name.ilike.%${code}%,parent_project_name.ilike.%${code}%`)
    .not('work_date', 'is', null)
    .order('work_date', { ascending: true })
    .limit(1);
  if (error) {
    console.warn(`TE lookup failed for ${code}:`, error.message);
    return null;
  }
  const iso = data?.[0]?.work_date ? String(data[0].work_date).slice(0, 10) : '';
  return isoToMdY(iso);
}

async function earliestRowDate(scheduleId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('pa_schedule_rows')
    .select('target_start, target_end')
    .eq('schedule_id', scheduleId)
    .limit(200);
  if (error || !data?.length) return null;
  let min: Date | null = null;
  for (const row of data) {
    const a = parseScheduleDate(row.target_start);
    const b = parseScheduleDate(row.target_end);
    for (const d of [a, b]) {
      if (!d) continue;
      if (!min || d.getTime() < min.getTime()) min = d;
    }
  }
  return min ? fmtUS(min) : null;
}

async function resolveStartDate(
  raw: string,
  projectKey: string,
  title: string | null,
  scheduleId: string,
): Promise<{ date: string; source: 'column' | 'time-entry' | 'existing-row' } | null> {
  const trimmed = (raw || '').trim();
  if (trimmed && parseProjectStartDate(trimmed)) {
    return { date: trimmed, source: 'column' };
  }
  const iso = isoToMdY(trimmed);
  if (iso && parseProjectStartDate(iso)) return { date: iso, source: 'column' };

  const code = extractCode(projectKey) || extractCode(title || '');
  if (code) {
    const fromTe = await firstTimeEntryDate(code);
    if (fromTe) return { date: fromTe, source: 'time-entry' };
  }
  const fromRow = await earliestRowDate(scheduleId);
  return fromRow ? { date: fromRow, source: 'existing-row' } : null;
}

function withHistoricalStatus<T extends { budget_remaining: string; target_end: string; actual_end: string }>(
  draft: T,
  today: Date,
): T {
  if (/^(n\/a|na|not\s*applicable)$/i.test(draft.budget_remaining)) return draft;
  const end = parseScheduleDate(draft.target_end);
  if (!end || startOfDay(end).getTime() >= today.getTime()) return draft;
  return {
    ...draft,
    budget_remaining: 'Completed',
    actual_end: draft.target_end,
  };
}

async function deleteRowsForSchedule(scheduleId: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { data, error } = await sb
      .from('pa_schedule_rows')
      .delete()
      .eq('schedule_id', scheduleId)
      .select('id');
    if (error) throw error;
    const n = data?.length ?? 0;
    deleted += n;
    if (n === 0) break;
  }
  return deleted;
}

async function main() {
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — wipe rows + autofill from start_date');
  const today = startOfDay(new Date());

  const [schedules, projects] = await Promise.all([
    fetchAll<{
      id: string;
      project_key: string;
      client_name: string | null;
      title: string | null;
      start_date: string;
    }>('pa_schedules', 'id, project_key, client_name, title, start_date'),
    fetchAll<{ project: string; type: string | null; row_kind: string }>(
      'pa_projects',
      'project, type, row_kind',
    ),
  ]);

  const typeByProject = new Map<string, string | null>();
  for (const p of projects) {
    if (p.row_kind === 'project') typeByProject.set(p.project, p.type);
  }

  type Plan = {
    scheduleId: string;
    projectKey: string;
    startDate: string;
    startSource: 'column' | 'time-entry' | 'existing-row';
    workType: string;
    preset: SchedulePresetKind;
    rowCount: number;
    datedCount: number;
  };

  const plans: Plan[] = [];
  const skipped: { projectKey: string; reason: string }[] = [];
  const presetCounts: Record<string, number> = {};

  for (const s of schedules) {
    const stored = (s.start_date || '').trim();
    const resolved = await resolveStartDate(stored, s.project_key, s.title, s.id);
    if (!resolved) {
      skipped.push({ projectKey: s.project_key, reason: 'no start_date' });
      continue;
    }
    const kickoff = parseProjectStartDate(resolved.date);
    if (!kickoff) {
      skipped.push({
        projectKey: s.project_key,
        reason: `bad start_date "${resolved.date}"`,
      });
      continue;
    }

    const explicit = typeByProject.get(s.project_key) ?? null;
    const workType = classifyWorkType(s.project_key, explicit);
    const preset = inferSchedulePresetKind(s.project_key, explicit);
    const drafts = buildDatedScheduleRows(kickoff, { preset, includeDates: true });
    const datedCount = drafts.filter((d) => d.target_start && d.target_end).length;

    presetCounts[preset] = (presetCounts[preset] || 0) + 1;
    plans.push({
      scheduleId: s.id,
      projectKey: s.project_key,
      startDate: resolved.date,
      startSource: resolved.source,
      workType,
      preset,
      rowCount: drafts.length,
      datedCount,
    });
  }

  console.log(`Schedules: ${schedules.length}`);
  console.log(`Will autofill: ${plans.length}`);
  console.log(`Skip: ${skipped.length}`, skipped.slice(0, 20));
  console.log('Preset mix:', presetCounts);
  console.log(
    'Samples:',
    plans.slice(0, 8).map((p) => ({
      key: p.projectKey,
      start: p.startDate,
      src: p.startSource,
      workType: p.workType,
      preset: p.preset,
      rows: p.rowCount,
      dated: p.datedCount,
    })),
  );

  if (dryRun) {
    console.log('Dry run complete.');
    return;
  }

  let deleted = 0;
  let filled = 0;
  let errors = 0;
  let persistedStarts = 0;

  for (const plan of plans) {
    if ((schedules.find((s) => s.id === plan.scheduleId)?.start_date || '').trim() !== plan.startDate) {
      const { error } = await sb
        .from('pa_schedules')
        .update({ start_date: plan.startDate })
        .eq('id', plan.scheduleId);
      if (error) console.warn(`Could not persist start_date for ${plan.projectKey}:`, error.message);
      else persistedStarts += 1;
    }

    deleted += await deleteRowsForSchedule(plan.scheduleId);

    const kickoff = parseProjectStartDate(plan.startDate)!;
    const drafts = buildDatedScheduleRows(kickoff, {
      preset: plan.preset,
      includeDates: true,
    }).map((d) => withHistoricalStatus(d, today));
    const payload = drafts.map((d) => ({
      schedule_id: plan.scheduleId,
      ...d,
    }));

    const { error } = await sb.from('pa_schedule_rows').insert(payload);
    if (error) {
      errors += 1;
      console.error(`Fail ${plan.projectKey}:`, error.message);
      continue;
    }
    filled += 1;
    if (filled % 25 === 0) console.log(`  … filled ${filled}/${plans.length}`);
  }

  const { count: rowCount } = await sb
    .from('pa_schedule_rows')
    .select('*', { count: 'exact', head: true });

  console.log(
    `Done. Deleted ${deleted} old rows, filled ${filled} schedules, persisted ${persistedStarts} start dates, ${errors} errors, ${rowCount} total rows.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
