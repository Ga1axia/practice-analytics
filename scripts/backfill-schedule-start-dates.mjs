/**
 * Set pa_schedules.start_date from the first logged time entry per project.
 *
 * Usage: node --env-file=.env.local scripts/backfill-schedule-start-dates.mjs
 * Dry run:  ... --dry-run
 */
import { createClient } from '@supabase/supabase-js';

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

const CODE_RE = /\b(\d{2}-\d{3})\b/;

function extractCode(s) {
  const m = String(s || '').match(CODE_RE);
  return m ? m[1] : null;
}

/** YYYY-MM-DD → M/D/YYYY (local calendar, no UTC shift). */
function isoToMdY(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return `${Number(m[2])}/${Number(m[3])}/${Number(m[1])}`;
}

function minIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

async function fetchAll(table, cols, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb.from(table).select(cols).range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    if (from && from % 10000 === 0) console.log(`  … ${table}: ${rows.length}`);
  }
  return rows;
}

async function main() {
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — will update pa_schedules');

  console.log('Loading time entries…');
  const firstByCode = new Map(); // code → YYYY-MM-DD
  const pageSize = 1000;
  let teCount = 0;
  let coded = 0;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from('pa_time_entries')
      .select('work_date, project_name, parent_project_name')
      .not('work_date', 'is', null)
      .range(from, to);
    if (error) throw error;
    if (!data?.length) break;
    teCount += data.length;
    for (const row of data) {
      const iso = String(row.work_date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      const codes = new Set();
      const c1 = extractCode(row.parent_project_name);
      const c2 = extractCode(row.project_name);
      if (c1) codes.add(c1);
      if (c2) codes.add(c2);
      if (!codes.size) continue;
      coded += 1;
      for (const code of codes) {
        firstByCode.set(code, minIso(firstByCode.get(code), iso));
      }
    }
    if (data.length < pageSize) break;
    if (from && from % 20000 === 0) {
      console.log(`  … TEs scanned: ${teCount}, codes: ${firstByCode.size}`);
    }
  }
  console.log(
    `TEs: ${teCount} rows, ${coded} with job codes, ${firstByCode.size} distinct codes with first dates`,
  );

  console.log('Loading projects + schedules…');
  const [projects, schedules] = await Promise.all([
    fetchAll('pa_projects', 'project, client, row_kind, parent_project'),
    fetchAll('pa_schedules', 'id, project_key, client_name, title, start_date'),
  ]);

  const projectHeaders = projects.filter((p) => p.row_kind === 'project');
  console.log(`Projects: ${projectHeaders.length} headers, Schedules: ${schedules.length}`);

  const scheduleByKey = new Map(schedules.map((s) => [s.project_key, s]));

  /** @type {{ projectKey: string, client: string, title: string, startDate: string, scheduleId?: string, action: 'update'|'insert' }[]} */
  const ops = [];
  const seenKeys = new Set();

  // 1) Existing schedules — set from code in project_key
  for (const s of schedules) {
    const code = extractCode(s.project_key) || extractCode(s.title);
    const iso = code ? firstByCode.get(code) : null;
    if (!iso) continue;
    const startDate = isoToMdY(iso);
    if (!startDate) continue;
    seenKeys.add(s.project_key);
    if ((s.start_date || '').trim() === startDate) continue;
    ops.push({
      projectKey: s.project_key,
      client: s.client_name || '',
      title: s.title || s.project_key,
      startDate,
      scheduleId: s.id,
      action: 'update',
    });
  }

  // 2) Project list headers — ensure schedule + start_date
  for (const p of projectHeaders) {
    const key = p.project;
    if (seenKeys.has(key)) continue;
    const code = extractCode(key);
    const iso = code ? firstByCode.get(code) : null;
    if (!iso) continue;
    const startDate = isoToMdY(iso);
    if (!startDate) continue;
    const existing = scheduleByKey.get(key);
    if (existing) {
      seenKeys.add(key);
      if ((existing.start_date || '').trim() === startDate) continue;
      ops.push({
        projectKey: key,
        client: p.client || existing.client_name || '',
        title: key,
        startDate,
        scheduleId: existing.id,
        action: 'update',
      });
    } else {
      seenKeys.add(key);
      ops.push({
        projectKey: key,
        client: p.client || '',
        title: key,
        startDate,
        action: 'insert',
      });
    }
  }

  const updates = ops.filter((o) => o.action === 'update');
  const inserts = ops.filter((o) => o.action === 'insert');
  console.log(`Would update ${updates.length} schedules, insert ${inserts.length} schedule shells`);
  if (ops.length) {
    console.log('Sample:', ops.slice(0, 5));
  }

  if (dryRun) {
    console.log('Dry run complete.');
    return;
  }

  let updated = 0;
  let inserted = 0;
  for (const op of updates) {
    const { error } = await sb
      .from('pa_schedules')
      .update({ start_date: op.startDate })
      .eq('id', op.scheduleId);
    if (error) {
      console.error(`Update failed ${op.projectKey}:`, error.message);
      continue;
    }
    updated += 1;
  }

  // Insert in batches
  const chunk = 100;
  for (let i = 0; i < inserts.length; i += chunk) {
    const batch = inserts.slice(i, i + chunk).map((op) => ({
      project_key: op.projectKey,
      client_name: op.client,
      title: op.title,
      start_date: op.startDate,
    }));
    const { data, error } = await sb.from('pa_schedules').insert(batch).select('id');
    if (error) {
      console.error(`Insert batch failed at ${i}:`, error.message);
      // Fallback one-by-one
      for (const row of batch) {
        const { error: e2 } = await sb.from('pa_schedules').insert(row);
        if (e2) console.error(`  insert ${row.project_key}:`, e2.message);
        else inserted += 1;
      }
      continue;
    }
    inserted += data?.length || batch.length;
  }

  console.log(`Done. Updated ${updated}, inserted ${inserted}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
