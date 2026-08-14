/**
 * Wipe all pa_schedule_rows and autofill firm checklist from each schedule's
 * start_date, inferring preset kind from project name / type.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/wipe-and-autofill-schedules.ts
 *   npx tsx --env-file=.env.local scripts/wipe-and-autofill-schedules.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import {
  inferSchedulePresetKind,
  parseProjectStartDate,
  presetIncludesDates,
  type SchedulePresetKind,
} from '../src/lib/scheduleAutofill';
import { buildDatedScheduleRows } from '../src/lib/scheduleDating';
import { classifyWorkType } from '../src/lib/workType';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.argv.includes('--dry-run');

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

async function deleteAllScheduleRows(): Promise<number> {
  // PostgREST requires a filter for DELETE; match all rows.
  const { data, error } = await sb
    .from('pa_schedule_rows')
    .delete()
    .gte('sort_order', -1)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

async function main() {
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — wipe rows + autofill');

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
    workType: string;
    preset: SchedulePresetKind;
    includeDates: boolean;
    rowCount: number;
  };

  const plans: Plan[] = [];
  const skipped: { projectKey: string; reason: string }[] = [];
  const presetCounts: Record<string, number> = {};

  for (const s of schedules) {
    const startRaw = (s.start_date || '').trim();
    if (!startRaw) {
      skipped.push({ projectKey: s.project_key, reason: 'no start_date' });
      continue;
    }
    const kickoff = parseProjectStartDate(startRaw);
    if (!kickoff) {
      skipped.push({
        projectKey: s.project_key,
        reason: `bad start_date "${startRaw}"`,
      });
      continue;
    }

    const explicit = typeByProject.get(s.project_key) ?? null;
    const workType = classifyWorkType(s.project_key, explicit);
    const preset = inferSchedulePresetKind(s.project_key, explicit);
    const includeDates = presetIncludesDates(preset);
    const drafts = buildDatedScheduleRows(kickoff, { preset, includeDates });

    presetCounts[preset] = (presetCounts[preset] || 0) + 1;
    plans.push({
      scheduleId: s.id,
      projectKey: s.project_key,
      startDate: startRaw,
      workType,
      preset,
      includeDates,
      rowCount: drafts.length,
    });
  }

  console.log(`Schedules: ${schedules.length}`);
  console.log(`Will autofill: ${plans.length}`);
  console.log(`Skip: ${skipped.length}`, skipped.slice(0, 15));
  console.log('Preset mix:', presetCounts);
  console.log(
    'Samples:',
    plans.slice(0, 8).map((p) => ({
      key: p.projectKey,
      start: p.startDate,
      workType: p.workType,
      preset: p.preset,
      dated: p.includeDates,
      rows: p.rowCount,
    })),
  );

  if (dryRun) {
    console.log('Dry run complete.');
    return;
  }

  console.log('Deleting all schedule rows…');
  const deleted = await deleteAllScheduleRows();
  console.log(`Deleted ${deleted} rows`);

  let filled = 0;
  let errors = 0;
  for (const plan of plans) {
    const kickoff = parseProjectStartDate(plan.startDate)!;
    const drafts = buildDatedScheduleRows(kickoff, {
      preset: plan.preset,
      includeDates: plan.includeDates,
    });
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

  console.log(`Done. Filled ${filled} schedules, ${errors} errors, ${rowCount} total rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
