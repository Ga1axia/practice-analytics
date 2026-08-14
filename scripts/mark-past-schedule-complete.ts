/**
 * Mark every schedule row whose target_end is before today as Completed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/mark-past-schedule-complete.ts
 *   npx tsx --env-file=.env.local scripts/mark-past-schedule-complete.ts --dry-run
 */
import { createClient } from '@supabase/supabase-js';
import { parseScheduleDate, startOfDay } from '../src/lib/scheduleDates';

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

function isAlreadyComplete(status: string): boolean {
  return /^(completed|complete|done)$/i.test(status.trim());
}

function isNA(status: string): boolean {
  return /^(n\/a|na|not\s*applicable)$/i.test(status.trim());
}

async function main() {
  const today = startOfDay(new Date());
  console.log(
    dryRun ? 'DRY RUN' : 'LIVE',
    `— mark target_end < ${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()} as Completed`,
  );

  type Row = {
    id: string;
    target_end: string;
    budget_remaining: string;
    row_kind: string;
  };

  const past: { id: string; target_end: string; kind: string }[] = [];
  let scanned = 0;
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from('pa_schedule_rows')
      .select('id, target_end, budget_remaining, row_kind')
      .neq('target_end', '')
      .range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    scanned += data.length;

    for (const row of data as Row[]) {
      if (isNA(row.budget_remaining) || isAlreadyComplete(row.budget_remaining)) continue;
      const end = parseScheduleDate(row.target_end);
      if (!end) continue;
      if (startOfDay(end).getTime() >= today.getTime()) continue;
      past.push({
        id: row.id,
        target_end: row.target_end,
        kind: row.row_kind,
      });
    }
    if (data.length < pageSize) break;
  }

  const byKind = past.reduce(
    (acc, r) => {
      acc[r.kind] = (acc[r.kind] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log(`Scanned ${scanned} dated rows; marking ${past.length}`, byKind);
  console.log('Sample:', past.slice(0, 5));

  if (dryRun) {
    console.log('Dry run complete.');
    return;
  }

  let updated = 0;
  const chunk = 100;
  for (let i = 0; i < past.length; i += chunk) {
    const batch = past.slice(i, i + chunk);
    // Same status for all; actual_end = that row's target_end (historical complete).
    await Promise.all(
      batch.map(async (row) => {
        const { error } = await sb
          .from('pa_schedule_rows')
          .update({
            budget_remaining: 'Completed',
            actual_end: row.target_end,
          })
          .eq('id', row.id);
        if (error) throw new Error(`${row.id}: ${error.message}`);
        updated += 1;
      }),
    );
    if ((i + chunk) % 500 === 0 || i + chunk >= past.length) {
      console.log(`  … ${Math.min(i + chunk, past.length)}/${past.length}`);
    }
  }

  console.log(`Done. Updated ${updated} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
