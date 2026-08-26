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
  /** project_schedules filters */
  scheduleFilter?: 'all' | 'assigned' | 'unassigned' | 'missing_start';
  projectKey?: string;
  startDate?: string;
  profileId?: string;
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

    if (action === 'project_schedules') {
      const from = Math.max(0, Number(body.from) || 0);
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
      const q = (body.search?.value || '').trim().toLowerCase();
      const filter = body.scheduleFilter || 'all';

      type Proj = {
        project: string;
        client: string | null;
        status: string | null;
        manager: string | null;
        row_kind: string | null;
      };
      type Sched = {
        id: string;
        project_key: string;
        start_date: string | null;
        title: string | null;
      };

      const projects: Proj[] = [];
      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_projects')
          .select('project, client, status, manager, row_kind')
          .eq('row_kind', 'project')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        projects.push(...(data as Proj[]));
        if (data.length < 1000) break;
      }

      const schedules: Sched[] = [];
      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_schedules')
          .select('id, project_key, start_date, title')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        schedules.push(...(data as Sched[]));
        if (data.length < 1000) break;
      }

      const rowCounts = new Map<string, number>();
      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_schedule_rows')
          .select('schedule_id')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) {
          const sid = String((r as { schedule_id: string }).schedule_id);
          rowCounts.set(sid, (rowCounts.get(sid) || 0) + 1);
        }
        if (data.length < 1000) break;
      }

      const byKey = new Map<string, Sched>();
      for (const s of schedules) byKey.set(s.project_key, s);

      let rows = projects.map((p) => {
        const sched = byKey.get(p.project);
        const start = (sched?.start_date || '').trim();
        const assigned = Boolean(sched);
        return {
          project: p.project,
          client: p.client,
          status: p.status,
          manager: p.manager,
          schedule_assigned: assigned,
          schedule_id: sched?.id || null,
          start_date: start || null,
          has_start_date: Boolean(start),
          schedule_row_count: sched ? rowCounts.get(sched.id) || 0 : 0,
          schedule_title: sched?.title || null,
        };
      });

      if (q) {
        rows = rows.filter((r) => {
          const blob = [r.project, r.client, r.manager, r.status, r.start_date]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return blob.includes(q);
        });
      }
      if (filter === 'assigned') rows = rows.filter((r) => r.schedule_assigned);
      if (filter === 'unassigned') rows = rows.filter((r) => !r.schedule_assigned);
      if (filter === 'missing_start') {
        rows = rows.filter((r) => r.schedule_assigned && !r.has_start_date);
      }

      rows.sort((a, b) => a.project.localeCompare(b.project, undefined, { sensitivity: 'base' }));

      const summary = {
        projects: projects.length,
        assigned: projects.filter((p) => byKey.has(p.project)).length,
        unassigned: projects.filter((p) => !byKey.has(p.project)).length,
        with_start: [...byKey.values()].filter((s) => (s.start_date || '').trim()).length,
      };

      const page = rows.slice(from, from + limit);
      res.status(200).json({
        rows: page,
        count: rows.length,
        from,
        limit,
        summary,
      });
      return;
    }

    if (action === 'set_schedule_start') {
      const projectKey = String(body.projectKey || '').trim();
      if (!projectKey) {
        res.status(400).json({ error: 'projectKey required' });
        return;
      }
      const startDate = String(body.startDate || '').trim();
      const { data: existing, error: findErr } = await sb
        .from('pa_schedules')
        .select('id, project_key, start_date, title, client_name')
        .eq('project_key', projectKey)
        .maybeSingle();
      if (findErr) throw new Error(findErr.message);

      if (existing) {
        const { data, error } = await sb
          .from('pa_schedules')
          .update({ start_date: startDate })
          .eq('id', existing.id)
          .select('id, project_key, start_date')
          .single();
        if (error) throw new Error(error.message);
        res.status(200).json({ ok: true, schedule: data });
        return;
      }

      const { data, error } = await sb
        .from('pa_schedules')
        .insert({
          project_key: projectKey,
          title: projectKey,
          client_name: '',
          start_date: startDate,
        })
        .select('id, project_key, start_date')
        .single();
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, schedule: data, created: true });
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

    if (action === 'management_overview') {
      const tableCounts: { table: string; count: number }[] = [];
      for (const table of [
        'pa_projects',
        'pa_profiles',
        'pa_project_members',
        'pa_time_entries',
        'pa_schedules',
        'pa_schedule_rows',
        'pa_employee_roster',
        'pa_employee_capacity',
        'pa_employee_totals',
        'pa_ar_clients',
        'pa_invoice_ledger',
        'pa_bqe_sync_runs',
      ] as AdminTable[]) {
        try {
          tableCounts.push({ table, count: await countTable(table) });
        } catch {
          tableCounts.push({ table, count: -1 });
        }
      }

      const { data: profiles } = await sb.from('pa_profiles').select('role');
      const roles: Record<string, number> = {};
      for (const p of profiles || []) {
        const r = String((p as { role: string }).role || 'unknown');
        roles[r] = (roles[r] || 0) + 1;
      }

      const { data: lastSync } = await sb
        .from('pa_bqe_sync_runs')
        .select('sync_type, status, completed_at, entries_fetched, entries_inserted')
        .order('completed_at', { ascending: false })
        .limit(5);

      const { count: schedAssigned } = await sb
        .from('pa_schedules')
        .select('*', { count: 'exact', head: true });
      const { count: projectHeaders } = await sb
        .from('pa_projects')
        .select('*', { count: 'exact', head: true })
        .eq('row_kind', 'project');
      const { count: activeHeaders } = await sb
        .from('pa_projects')
        .select('*', { count: 'exact', head: true })
        .eq('row_kind', 'project')
        .eq('status', 'ACTIVE');

      const { data: conn } = await sb
        .from('pa_bqe_connection')
        .select('connected_at, last_sync_at, last_sync_status, last_sync_message, api_endpoint')
        .limit(1)
        .maybeSingle();

      res.status(200).json({
        tableCounts,
        roles,
        lastSyncRuns: lastSync || [],
        schedulesAssigned: schedAssigned ?? 0,
        projectHeaders: projectHeaders ?? 0,
        activeProjectHeaders: activeHeaders ?? 0,
        bqeConnection: conn || null,
      });
      return;
    }

    if (action === 'employees_directory') {
      type EmpAcc = {
        name: string;
        email: string | null;
        profile_id: string | null;
        role: string | null;
        display_name: string | null;
        team: string | null;
        capacity_hours: number | null;
        job_role: string | null;
        discipline: string | null;
        total_hours: number | null;
        bill_hours: number | null;
        member_projects: number;
        lead_projects: number;
        sources: string[];
      };

      const byNorm = new Map<string, EmpAcc>();
      const ensure = (raw: string) => {
        const name = raw.trim();
        const key = norm(name);
        if (!key) return null;
        let row = byNorm.get(key);
        if (!row) {
          row = {
            name,
            email: null,
            profile_id: null,
            role: null,
            display_name: null,
            team: null,
            capacity_hours: null,
            job_role: null,
            discipline: null,
            total_hours: null,
            bill_hours: null,
            member_projects: 0,
            lead_projects: 0,
            sources: [],
          };
          byNorm.set(key, row);
        }
        return row;
      };
      const addSource = (row: EmpAcc, s: string) => {
        if (!row.sources.includes(s)) row.sources.push(s);
      };

      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_profiles')
          .select('id, email, role, display_name, employee_name')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const p of data) {
          const empName = String(p.employee_name || '').trim();
          if (empName) {
            const row = ensure(empName);
            if (row) {
              row.profile_id = p.id as string;
              row.email = (p.email as string) || row.email;
              row.role = (p.role as string) || row.role;
              row.display_name = (p.display_name as string) || row.display_name;
              addSource(row, 'profile');
            }
          } else if (p.role && p.role !== 'customer') {
            const row = ensure(String(p.display_name || p.email || p.id));
            if (row) {
              row.profile_id = p.id as string;
              row.email = (p.email as string) || null;
              row.role = p.role as string;
              row.display_name = (p.display_name as string) || null;
              addSource(row, 'profile');
            }
          }
        }
        if (data.length < 1000) break;
      }

      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_employee_roster')
          .select('employee, team')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) {
          const row = ensure(String(r.employee || ''));
          if (!row) continue;
          row.team = (r.team as string) || row.team;
          addSource(row, 'roster');
        }
        if (data.length < 1000) break;
      }

      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_employee_capacity')
          .select('employee_name, weekly_capacity_hours, role, discipline, active')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) {
          const row = ensure(String(r.employee_name || ''));
          if (!row) continue;
          row.capacity_hours = Number(r.weekly_capacity_hours) || row.capacity_hours;
          row.job_role = (r.role as string) || row.job_role;
          row.discipline = (r.discipline as string) || row.discipline;
          addSource(row, 'capacity');
        }
        if (data.length < 1000) break;
      }

      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_employee_totals')
          .select('employee, total_hours, bill_hours')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) {
          const row = ensure(String(r.employee || ''));
          if (!row) continue;
          row.total_hours = Number(r.total_hours) || row.total_hours;
          row.bill_hours = Number(r.bill_hours) || row.bill_hours;
          addSource(row, 'totals');
        }
        if (data.length < 1000) break;
      }

      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_project_members')
          .select('employee_name, role')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) {
          const row = ensure(String(r.employee_name || ''));
          if (!row) continue;
          row.member_projects += 1;
          if (r.role === 'lead') row.lead_projects += 1;
          addSource(row, 'members');
        }
        if (data.length < 1000) break;
      }

      // Distinct TE names (names only — full hour scan already covered by totals when present)
      const teNames = new Set<string>();
      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_time_entries')
          .select('employee_name')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        for (const r of data) {
          const n = String(r.employee_name || '').trim();
          if (n) teNames.add(n);
        }
        if (data.length < 1000) break;
        // Cap TE name discovery to avoid multi-minute scans on huge tables
        if (f >= 100_000) break;
      }
      for (const n of teNames) {
        const row = ensure(n);
        if (row) addSource(row, 'time_entries');
      }

      const q = String(body.search?.value || '').trim().toLowerCase();
      let rows = [...byNorm.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      if (q) {
        rows = rows.filter((r) => {
          const blob = [r.name, r.email, r.role, r.team, r.job_role, r.discipline, r.display_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return blob.includes(q);
        });
      }

      const from = Math.max(0, Number(body.from) || 0);
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 200));
      res.status(200).json({
        rows: rows.slice(from, from + limit),
        count: rows.length,
        from,
        limit,
        summary: {
          people: rows.length,
          with_profile: rows.filter((r) => r.profile_id).length,
          with_te: rows.filter((r) => r.sources.includes('time_entries')).length,
          with_capacity: rows.filter((r) => r.sources.includes('capacity')).length,
        },
      });
      return;
    }

    if (action === 'members_overview') {
      const q = String(body.search?.value || '').trim().toLowerCase();
      const from = Math.max(0, Number(body.from) || 0);
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));

      type Mem = { project_key: string; employee_name: string; role: string };
      const members: Mem[] = [];
      for (let f = 0; ; f += 1000) {
        const { data, error } = await sb
          .from('pa_project_members')
          .select('project_key, employee_name, role')
          .range(f, f + 999);
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        members.push(...(data as Mem[]));
        if (data.length < 1000) break;
      }

      const byProject = new Map<
        string,
        { project_key: string; members: number; leads: string[]; people: string[] }
      >();
      for (const m of members) {
        let row = byProject.get(m.project_key);
        if (!row) {
          row = { project_key: m.project_key, members: 0, leads: [], people: [] };
          byProject.set(m.project_key, row);
        }
        row.members += 1;
        row.people.push(m.employee_name);
        if (m.role === 'lead') row.leads.push(m.employee_name);
      }

      let rows = [...byProject.values()].sort((a, b) => b.members - a.members);
      if (q) {
        rows = rows.filter((r) => {
          const blob = [r.project_key, ...r.leads, ...r.people].join(' ').toLowerCase();
          return blob.includes(q);
        });
      }

      res.status(200).json({
        rows: rows.slice(from, from + limit).map((r) => ({
          project_key: r.project_key,
          members: r.members,
          leads: r.leads,
          lead_count: r.leads.length,
        })),
        count: rows.length,
        from,
        limit,
        summary: {
          projects_with_members: byProject.size,
          total_memberships: members.length,
          lead_memberships: members.filter((m) => m.role === 'lead').length,
        },
      });
      return;
    }

    if (action === 'update_profile') {
      const id = String((body as { profileId?: string }).profileId || body.ids?.[0] || '').trim();
      if (!id) {
        res.status(400).json({ error: 'profileId required' });
        return;
      }
      const patch = body.patch || {};
      const allowedKeys = ['role', 'display_name', 'employee_name', 'client_name', 'email'];
      const clean: Record<string, unknown> = {};
      for (const k of allowedKeys) {
        if (k in patch) clean[k] = patch[k];
      }
      if (clean.role != null) {
        const role = String(clean.role);
        if (!['admin', 'exec', 'project_lead', 'employee', 'customer'].includes(role)) {
          res.status(400).json({ error: 'Invalid role' });
          return;
        }
      }
      if (!Object.keys(clean).length) {
        res.status(400).json({ error: 'No allowed fields to update' });
        return;
      }
      const { data, error } = await sb
        .from('pa_profiles')
        .update(clean)
        .eq('id', id)
        .select('id, email, role, display_name, employee_name, client_name')
        .single();
      if (error) throw new Error(error.message);
      res.status(200).json({ ok: true, profile: data });
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
        'project_schedules',
        'set_schedule_start',
        'management_overview',
        'employees_directory',
        'members_overview',
        'update_profile',
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Admin data action failed';
    res.status(500).json({ error: msg });
  }
}
