import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serviceSupabase } from '../_lib/bqe.js';
import { requireAdmin } from '../_lib/requireAdmin.js';

/** Whitelist — never accept arbitrary table names from the client. */
export const ADMIN_TABLES = [
  'pa_projects',
  'pa_profiles',
  'pa_project_members',
  'pa_time_entries',
  'pa_employee_monthly',
  'pa_employee_totals',
  'pa_employee_roster',
  'pa_employee_capacity',
  'pa_ar_clients',
  'pa_invoice_ledger',
  'pa_monthly_revenue',
  'pa_company_monthly',
  'pa_project_monthly_billed',
  'pa_client_monthly_billed',
  'pa_schedules',
  'pa_schedule_rows',
  'pa_bqe_sync_runs',
  'pa_project_staffing_profiles',
  'pa_project_phase_staffing',
  'pa_employee_phase_allocations',
  'pa_employee_time_off',
  'pa_client_messages',
  'pa_client_meetings',
  'pa_client_box_links',
  'pa_process_checks',
] as const;

export type AdminTable = (typeof ADMIN_TABLES)[number];

function isAdminTable(t: string): t is AdminTable {
  return (ADMIN_TABLES as readonly string[]).includes(t);
}

const CODE_RE = /\b(\d{2}-\d{3})\b/;

function extractCode(s: string | null | undefined): string | null {
  const m = String(s || '').match(CODE_RE);
  return m ? m[1]! : null;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

type Body = {
  action?: string;
  table?: string;
  columns?: string;
  filters?: Record<string, string | number | boolean | null>;
  search?: { column: string; value: string };
  order?: { column: string; ascending?: boolean };
  from?: number;
  limit?: number;
  rows?: Record<string, unknown>[];
  ids?: string[];
  idColumn?: string;
  patch?: Record<string, unknown>;
  match?: Record<string, string | number | boolean | null>;
  dryRun?: boolean;
};

async function countTable(table: AdminTable): Promise<number> {
  const sb = serviceSupabase();
  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function seedMembersFromTimeEntries(dryRun: boolean): Promise<{
  scannedTe: number;
  wouldInsert: number;
  wouldPromote: number;
  inserted: number;
  promoted: number;
  projectHeaders: number;
}> {
  const sb = serviceSupabase();

  const projects: {
    project: string;
    manager: string | null;
    row_kind: string | null;
    parent_project: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_projects')
      .select('project, manager, row_kind, parent_project')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    projects.push(...(data as typeof projects));
    if (data.length < 1000) break;
  }

  const byCode = new Map<string, { key: string; leads: Set<string> }>();
  const byKey = new Map<string, { key: string; leads: Set<string> }>();

  for (const row of projects) {
    if (row.row_kind === 'project') {
      const entry = { key: row.project, leads: new Set<string>() };
      if (row.manager?.trim()) entry.leads.add(row.manager.trim());
      byKey.set(row.project, entry);
      const code = extractCode(row.project);
      if (code) byCode.set(code, entry);
    }
  }
  for (const row of projects) {
    if (row.row_kind === 'project') continue;
    let entry = row.parent_project ? byKey.get(row.parent_project) : undefined;
    if (!entry) {
      const code = extractCode(row.parent_project || row.project);
      if (code) entry = byCode.get(code);
    }
    if (entry && row.manager?.trim()) entry.leads.add(row.manager.trim());
  }

  const peopleByCode = new Map<string, Set<string>>();
  let scannedTe = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_time_entries')
      .select('employee_name, project_name, parent_project_name')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    scannedTe += data.length;
    for (const row of data) {
      const name = String(row.employee_name || '').trim();
      if (!name) continue;
      for (const code of [extractCode(row.parent_project_name), extractCode(row.project_name)]) {
        if (!code || !byCode.has(code)) continue;
        let set = peopleByCode.get(code);
        if (!set) {
          set = new Set();
          peopleByCode.set(code, set);
        }
        set.add(name);
      }
    }
    if (data.length < 1000) break;
  }

  const existing: { project_key: string; employee_name: string; role: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_project_members')
      .select('project_key, employee_name, role')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    existing.push(...(data as typeof existing));
    if (data.length < 1000) break;
  }

  const have = new Map<string, Map<string, string>>();
  for (const m of existing) {
    let inner = have.get(m.project_key);
    if (!inner) {
      inner = new Map();
      have.set(m.project_key, inner);
    }
    inner.set(norm(m.employee_name), m.role);
  }

  const inserts: { project_key: string; employee_name: string; role: string }[] = [];
  const promoteLeads: { project_key: string; employee_name: string }[] = [];

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

  let inserted = 0;
  let promoted = 0;
  if (!dryRun) {
    for (let i = 0; i < inserts.length; i += 500) {
      const chunk = inserts.slice(i, i + 500);
      const { error } = await sb.from('pa_project_members').upsert(chunk, {
        onConflict: 'project_key,employee_name',
      });
      if (error) throw new Error(error.message);
      inserted += chunk.length;
    }
    for (const p of promoteLeads) {
      const { error } = await sb
        .from('pa_project_members')
        .update({ role: 'lead' })
        .eq('project_key', p.project_key)
        .ilike('employee_name', p.employee_name);
      if (error) throw new Error(error.message);
      promoted += 1;
    }
  }

  return {
    scannedTe,
    wouldInsert: inserts.length,
    wouldPromote: promoteLeads.length,
    inserted: dryRun ? 0 : inserted,
    promoted: dryRun ? 0 : promoted,
    projectHeaders: byKey.size,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  let body: Body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const action = String(body.action || '');

  try {
    const sb = serviceSupabase();

    if (action === 'tables') {
      const tables = [];
      for (const table of ADMIN_TABLES) {
        try {
          const count = await countTable(table);
          tables.push({ table, count, ok: true as const });
        } catch (e) {
          tables.push({
            table,
            count: 0,
            ok: false as const,
            error: e instanceof Error ? e.message : 'count failed',
          });
        }
      }
      res.status(200).json({ tables });
      return;
    }

    if (action === 'query') {
      const table = String(body.table || '');
      if (!isAdminTable(table)) {
        res.status(400).json({ error: 'Table not allowed' });
        return;
      }
      const from = Math.max(0, Number(body.from) || 0);
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 50));
      const cols = (body.columns || '*').trim() || '*';
      let q = sb.from(table).select(cols, { count: 'exact' });
      for (const [k, v] of Object.entries(body.filters || {})) {
        if (v === null) q = q.is(k, null);
        else q = q.eq(k, v);
      }
      if (body.search?.column && body.search.value) {
        q = q.ilike(body.search.column, `%${body.search.value.replace(/%/g, '')}%`);
      }
      if (body.order?.column) {
        q = q.order(body.order.column, { ascending: body.order.ascending !== false });
      }
      q = q.range(from, from + limit - 1);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      res.status(200).json({ rows: data || [], count: count ?? null, from, limit });
      return;
    }

    if (action === 'upsert') {
      const table = String(body.table || '');
      if (!isAdminTable(table)) {
        res.status(400).json({ error: 'Table not allowed' });
        return;
      }
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) {
        res.status(400).json({ error: 'rows[] required' });
        return;
      }
      if (rows.length > 1000) {
        res.status(400).json({ error: 'Max 1000 rows per upsert' });
        return;
      }
      const { data, error } = await sb.from(table).upsert(rows).select();
      if (error) throw new Error(error.message);
      res.status(200).json({ upserted: data?.length ?? 0, rows: data || [] });
      return;
    }

    if (action === 'update') {
      const table = String(body.table || '');
      if (!isAdminTable(table)) {
        res.status(400).json({ error: 'Table not allowed' });
        return;
      }
      const patch = body.patch || {};
      if (!Object.keys(patch).length) {
        res.status(400).json({ error: 'patch required' });
        return;
      }
      let q = sb.from(table).update(patch);
      const match = body.match || {};
      const ids = body.ids || [];
      const idColumn = body.idColumn || 'id';
      if (ids.length) q = q.in(idColumn, ids);
      for (const [k, v] of Object.entries(match)) {
        if (v === null) q = q.is(k, null);
        else q = q.eq(k, v);
      }
      if (!ids.length && !Object.keys(match).length) {
        res.status(400).json({ error: 'Provide ids[] or match{}' });
        return;
      }
      const { data, error } = await q.select();
      if (error) throw new Error(error.message);
      res.status(200).json({ updated: data?.length ?? 0, rows: data || [] });
      return;
    }

    if (action === 'delete') {
      const table = String(body.table || '');
      if (!isAdminTable(table)) {
        res.status(400).json({ error: 'Table not allowed' });
        return;
      }
      let q = sb.from(table).delete();
      const ids = body.ids || [];
      const idColumn = body.idColumn || 'id';
      const match = body.match || {};
      if (ids.length) q = q.in(idColumn, ids);
      for (const [k, v] of Object.entries(match)) {
        if (v === null) q = q.is(k, null);
        else q = q.eq(k, v);
      }
      if (!ids.length && !Object.keys(match).length) {
        res.status(400).json({ error: 'Provide ids[] or match{}' });
        return;
      }
      const { data, error } = await q.select();
      if (error) throw new Error(error.message);
      res.status(200).json({ deleted: data?.length ?? 0 });
      return;
    }

    if (action === 'seed_members_from_te') {
      const result = await seedMembersFromTimeEntries(Boolean(body.dryRun));
      res.status(200).json(result);
      return;
    }

    if (action === 'clear_schedules') {
      // Match all UUID primary keys
      const { error: e1 } = await sb
        .from('pa_schedule_rows')
        .delete()
        .gte('id', '00000000-0000-0000-0000-000000000000');
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await sb
        .from('pa_schedules')
        .delete()
        .gte('id', '00000000-0000-0000-0000-000000000000');
      if (e2) throw new Error(e2.message);
      res.status(200).json({ ok: true, message: 'All schedules and schedule rows deleted.' });
      return;
    }

    if (action === 'clear_projects') {
      const { data, error } = await sb.rpc('pa_clear_project_list');
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, result: data });
      return;
    }

    if (action === 'sql_count') {
      // convenience: re-count one table
      const table = String(body.table || '');
      if (!isAdminTable(table)) {
        res.status(400).json({ error: 'Table not allowed' });
        return;
      }
      res.status(200).json({ table, count: await countTable(table) });
      return;
    }

    res.status(400).json({
      error: 'Unknown action',
      allowed: [
        'tables',
        'query',
        'upsert',
        'update',
        'delete',
        'seed_members_from_te',
        'clear_schedules',
        'clear_projects',
        'sql_count',
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Admin data action failed';
    res.status(500).json({ error: msg });
  }
}
