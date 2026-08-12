/**
 * Admin/ops script: persist BQE CORE time entries into pa_time_entries.
 * Uses service role + stored BQE tokens (no browser JWT).
 *
 *   npx tsx scripts/import-time-entries.ts
 *   npx tsx scripts/import-time-entries.ts --mode=incremental
 *   npx tsx scripts/import-time-entries.ts --mode=historical --since=2023-08-11
 *   npx tsx scripts/import-time-entries.ts --mode=dry_run
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { serviceSupabase } from '../api/_lib/bqe';
import { runTimeEntrySync, type TimeEntrySyncMode } from '../api/_lib/bqeTimeEntrySync';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local'), override: true });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const mode = (arg('mode') || 'historical') as TimeEntrySyncMode;
  if (!['historical', 'incremental', 'dry_run'].includes(mode)) {
    throw new Error('mode must be historical | incremental | dry_run');
  }
  const since = arg('since');
  const until = arg('until');

  console.log(`[import-time-entries] mode=${mode} since=${since || '(default)'} until=${until || '(none)'}`);
  const sb = serviceSupabase();
  const result = await runTimeEntrySync(sb, { mode, since, until, initiatedBy: null });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'failed') process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
