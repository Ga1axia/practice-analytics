/**
 * Seed pa_time_entries from a local CORE export JSON (no BQE API calls).
 *
 *   npx tsx scripts/seed-time-entries-from-json.ts docs/analytics/zhengrui-he-time-entries.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { serviceSupabase, type BqeTimeEntry } from '../api/_lib/bqe';
import {
  mapBqeTimeEntryToRow,
  upsertTimeEntryRows,
} from '../api/_lib/bqeTimeEntrySync';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local'), override: true });

async function main() {
  const file = process.argv[2] || 'docs/analytics/zhengrui-he-time-entries.json';
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
    entries?: BqeTimeEntry[];
  };
  const entries = raw.entries || [];
  if (!entries.length) throw new Error('No entries in JSON');

  const emptyLookup = new Map();
  const nowIso = new Date().toISOString();
  const rows = [];
  let skipped = 0;
  for (const te of entries) {
    const row = mapBqeTimeEntryToRow(te, emptyLookup, nowIso);
    if (!row) {
      skipped += 1;
      continue;
    }
    // Without live project hierarchy, keep CORE project label as project_name
    // and try to derive a phase suffix from "Parent - Phase" names.
    if (!row.phase && row.project_name) {
      const m = row.project_name.match(/\s[-–]\s(.+)$/);
      if (m) {
        row.phase = m[1]!.trim();
        row.phase_name = row.phase;
        row.parent_project_name = row.project_name.slice(0, m.index).trim();
      }
    }
    rows.push(row);
  }

  const sb = serviceSupabase();
  const { inserted, updated } = await upsertTimeEntryRows(sb, rows);
  console.log(
    JSON.stringify(
      { file: abs, total: entries.length, rows: rows.length, skipped, inserted, updated },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
