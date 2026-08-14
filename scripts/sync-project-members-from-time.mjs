/**
 * Backfill pa_project_members from time entries + Project List managers.
 * Everyone who logged hours on a job code becomes a member; PMs become leads.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-project-members-from-time.mjs
 *   node --env-file=.env.local scripts/sync-project-members-from-time.mjs --dry-run
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

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

async function fetchAll(table, cols, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  console.log(dryRun ? 'DRY RUN' : 'LIVE', '— sync project members from time entries');

  console.log('Loading projects…');
  const projects = await fetchAll('pa_projects', 'project, manager, row_kind, parent_project, phase');
  /** @type {Map<string, { key: string, leads: Set<string> }>} */
  const byCode = new Map();
  /** @type {Map<string, { key: string, leads: Set<string> }>} */
  const byKey = new Map();

  for (const row of projects) {
    if (row.row_kind === 'project') {
      const code = extractCode(row.project);
      const entry = { key: row.project, leads: new Set() };
      if (row.manager?.trim()) entry.leads.add(row.manager.trim());
      byKey.set(row.project, entry);
      if (code) byCode.set(code, entry);
    }
  }
  for (const row of projects) {
    if (row.row_kind === 'project') continue;
    const parentKey = row.parent_project;
    let entry = parentKey ? byKey.get(parentKey) : null;
    if (!entry) {
      const code = extractCode(row.parent_project || row.project);
      if (code) entry = byCode.get(code) || null;
    }
    if (entry && row.manager?.trim()) entry.leads.add(row.manager.trim());
  }

  console.log(`Project headers: ${byKey.size}, coded: ${byCode.size}`);

  console.log('Scanning time entries…');
  /** @type {Map<string, Set<string>>} code -> employee names */
  const peopleByCode = new Map();
  let teCount = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_time_entries')
      .select('employee_name, project_name, parent_project_name')
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    teCount += data.length;
    for (const row of data) {
      const name = (row.employee_name || '').trim();
      if (!name) continue;
      const codes = new Set();
      const c1 = extractCode(row.parent_project_name);
      const c2 = extractCode(row.project_name);
      if (c1) codes.add(c1);
      if (c2) codes.add(c2);
      for (const code of codes) {
        if (!byCode.has(code)) continue;
        let set = peopleByCode.get(code);
        if (!set) {
          set = new Set();
          peopleByCode.set(code, set);
        }
        set.add(name);
      }
    }
    if (data.length < 1000) break;
    if (from && from % 20000 === 0) console.log(`  … TEs ${teCount}`);
  }
  console.log(`TEs scanned: ${teCount}; codes with people: ${peopleByCode.size}`);

  console.log('Loading existing members…');
  const existing = await fetchAll('pa_project_members', 'project_key, employee_name, role');
  /** @type {Map<string, Map<string, string>>} */
  const have = new Map();
  for (const m of existing) {
    let inner = have.get(m.project_key);
    if (!inner) {
      inner = new Map();
      have.set(m.project_key, inner);
    }
    inner.set(norm(m.employee_name), m.role);
  }

  /** @type {{ project_key: string, employee_name: string, role: string }[]} */
  const inserts = [];
  /** @type {{ project_key: string, employee_name: string }[]} */
  const promoteLeads = [];

  for (const [code, entry] of byCode) {
    const names = peopleByCode.get(code) || new Set();
    const current = have.get(entry.key) || new Map();

    for (const lead of entry.leads) {
      const key = norm(lead);
      const role = current.get(key);
      if (!role) {
        inserts.push({ project_key: entry.key, employee_name: lead, role: 'lead' });
        current.set(key, 'lead');
      } else if (role !== 'lead') {
        promoteLeads.push({ project_key: entry.key, employee_name: lead });
        current.set(key, 'lead');
      }
    }

    for (const name of names) {
      const key = norm(name);
      if (current.has(key)) continue;
      inserts.push({ project_key: entry.key, employee_name: name, role: 'member' });
      current.set(key, 'member');
    }
    have.set(entry.key, current);
  }

  console.log(`Would insert ${inserts.length}, promote ${promoteLeads.length} to lead`);
  console.log('Sample inserts:', inserts.slice(0, 8));

  if (dryRun) {
    console.log('Dry run complete.');
    return;
  }

  let inserted = 0;
  const chunk = 100;
  for (let i = 0; i < inserts.length; i += chunk) {
    const batch = inserts.slice(i, i + chunk);
    const { error } = await sb.from('pa_project_members').upsert(batch, {
      onConflict: 'project_key,employee_name',
      ignoreDuplicates: false,
    });
    if (error) {
      console.error(`Insert batch ${i}:`, error.message);
      for (const row of batch) {
        const { error: e2 } = await sb.from('pa_project_members').upsert(row, {
          onConflict: 'project_key,employee_name',
        });
        if (!e2) inserted += 1;
        else console.error(`  ${row.project_key} / ${row.employee_name}:`, e2.message);
      }
      continue;
    }
    inserted += batch.length;
    if ((i + chunk) % 500 === 0 || i + chunk >= inserts.length) {
      console.log(`  … inserts ${Math.min(i + chunk, inserts.length)}/${inserts.length}`);
    }
  }

  let promoted = 0;
  for (const row of promoteLeads) {
    const { error } = await sb
      .from('pa_project_members')
      .update({ role: 'lead' })
      .eq('project_key', row.project_key)
      .ilike('employee_name', row.employee_name);
    if (!error) promoted += 1;
  }

  const { count } = await sb
    .from('pa_project_members')
    .select('*', { count: 'exact', head: true });
  console.log(`Done. Inserted ~${inserted}, promoted ${promoted}. Total members: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
