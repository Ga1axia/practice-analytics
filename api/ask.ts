import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type SheetId = 'exec' | 'main' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 'admin';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

type ProjectRow = {
  project: string;
  client: string | null;
  manager: string | null;
  status: string | null;
  type: string | null;
  phase: string | null;
  city: string | null;
  contract: number | null;
  spent: number | null;
  billed: number | null;
  ar: number | null;
  profit: number | null;
  margin: number | null;
  retainer_balance: number | null;
  pct_used: number | null;
  pct_billed: number | null;
  parent_project?: string | null;
  row_kind?: string | null;
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'what', 'which', 'how', 'many', 'much', 'who', 'whose',
  'is', 'are', 'was', 'were', 'of', 'to', 'a', 'an', 'in', 'on', 'at', 'by',
  'with', 'from', 'total', 'amount', 'value', 'number', 'count', 'highest',
  'lowest', 'most', 'least', 'active', 'completed', 'project', 'projects',
  'client', 'clients', 'manager', 'managers', 'employee', 'employees', 'team',
  'billed', 'billing', 'contract', 'contracts', 'profit', 'margin', 'owed',
  'overdue', 'aging', 'receivable', 'efficiency', 'hours', 'month', 'monthly',
  'year', 'there', 'their', 'this', 'that', 'have', 'has', 'been', 'about',
  'show', 'give', 'tell', 'please', 'sheet', 'firm', 'practice', 'design',
  'designs', 'architect', 'architects',
]);

function stubMessage(examples: string[]) {
  return (
    `Live Q&A needs ANTHROPIC_API_KEY on the Vercel server (or vercel dev). ` +
    `The UI is ready — set the key in project env, redeploy, and ask again. Examples: ` +
    examples.join(' · ')
  );
}

function tokensOf(text: string) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Score how well a catalog name appears in the question (full match or distinctive tokens). */
function nameScore(question: string, name: string | null | undefined): number {
  if (!name) return 0;
  const q = question.toLowerCase();
  const n = String(name).toLowerCase().trim();
  if (n.length < 3) return 0;
  if (q.includes(n)) return 1000 + n.length;

  const nameTokens = tokensOf(n);
  if (!nameTokens.length) return 0;
  let hit = 0;
  let hitLen = 0;
  for (const t of nameTokens) {
    // word-boundary-ish check so "ann" doesn't match inside "planning"
    const re = new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`);
    if (re.test(q)) {
      hit += 1;
      hitLen += t.length;
    }
  }
  if (!hit) return 0;
  // Prefer multi-token hits; allow a single strong token (e.g. Vargas, Balakrishnan)
  if (hit === 1 && hitLen < 5 && nameTokens.length > 1) return 0;
  return hit * 50 + hitLen + (hit === nameTokens.length ? 100 : 0);
}

function findEntities(question: string, names: (string | null | undefined)[], limit = 5): string[] {
  const uniq = [...new Set(names.filter((n): n is string => !!n && n.trim().length >= 3))];
  const scored = uniq
    .map((name) => ({ name, score: nameScore(question, name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.name.length - a.name.length);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score >= top * 0.6 || x.score >= 1000).slice(0, limit).map((x) => x.name);
}

async function fetchAll<T>(supabase: Db, table: string, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data || []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadMeta(supabase: Db) {
  const rows = await fetchAll<{ key: string; value: unknown }>(supabase, 'pa_meta');
  const meta: Record<string, unknown> = {};
  rows.forEach((r) => {
    meta[r.key] = r.value;
  });
  return meta;
}

function sumField(rows: ProjectRow[], key: keyof ProjectRow) {
  return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
}

function kpiFromProjects(rows: ProjectRow[]) {
  return {
    contract_amount: sumField(rows, 'contract'),
    spent: sumField(rows, 'spent'),
    billed: sumField(rows, 'billed'),
    receivable: sumField(rows, 'ar'),
    retainer_balance: sumField(rows, 'retainer_balance'),
    profit: sumField(rows, 'profit'),
    project_count: rows.length,
  };
}

function topClientsByBilled(rows: ProjectRow[], n = 15) {
  const map = new Map<
    string,
    { client: string; billed: number; contract: number; profit: number; ar: number; projects: number }
  >();
  for (const p of rows) {
    const client = p.client || 'Unknown';
    const cur = map.get(client) || {
      client,
      billed: 0,
      contract: 0,
      profit: 0,
      ar: 0,
      projects: 0,
    };
    cur.billed += p.billed || 0;
    cur.contract += p.contract || 0;
    cur.profit += p.profit || 0;
    cur.ar += p.ar || 0;
    cur.projects += 1;
    map.set(client, cur);
  }
  return [...map.values()].sort((a, b) => b.billed - a.billed).slice(0, n);
}

function topManagersByContract(rows: ProjectRow[], n = 15) {
  const map = new Map<
    string,
    { manager: string; contract: number; billed: number; profit: number; projects: number }
  >();
  for (const p of rows) {
    const manager = p.manager || 'Unknown';
    const cur = map.get(manager) || {
      manager,
      contract: 0,
      billed: 0,
      profit: 0,
      projects: 0,
    };
    cur.contract += p.contract || 0;
    cur.billed += p.billed || 0;
    cur.profit += p.profit || 0;
    cur.projects += 1;
    map.set(manager, cur);
  }
  return [...map.values()].sort((a, b) => b.contract - a.contract).slice(0, n);
}

function contractByPhase(rows: ProjectRow[]) {
  const map = new Map<string, { phase: string; contract: number; billed: number; projects: number }>();
  for (const p of rows) {
    const phase = p.phase || 'Unknown';
    const cur = map.get(phase) || { phase, contract: 0, billed: 0, projects: 0 };
    cur.contract += p.contract || 0;
    cur.billed += p.billed || 0;
    cur.projects += 1;
    map.set(phase, cur);
  }
  return [...map.values()].sort((a, b) => b.contract - a.contract);
}

function applyProjectFilters(rows: ProjectRow[], filters: Record<string, string>) {
  let out = rows;
  const status = filters.status;
  if (status && status !== 'All') out = out.filter((p) => p.status === status);
  const manager = filters.employee_filter || filters.manager;
  if (manager && manager !== 'All') out = out.filter((p) => p.manager === manager);
  const type = filters.contract_type || filters.type;
  if (type && type !== 'All') out = out.filter((p) => p.type === type);
  return out;
}

function rowsForEntities(rows: ProjectRow[], entities: string[]) {
  if (!entities.length) return [];
  const set = new Set(entities);
  return rows.filter(
    (p) => set.has(p.project) || (p.client && set.has(p.client)) || (p.manager && set.has(p.manager)),
  );
}

async function buildContext(
  supabase: Db,
  sheet: SheetId,
  question: string,
  filters: Record<string, string>,
) {
  const meta = await loadMeta(supabase);

  if (sheet === 's1' || sheet === 'exec' || sheet === 'main' || sheet === 's5') {
    const projects = await fetchAll<ProjectRow>(supabase, 'pa_projects');
    const filtered = applyProjectFilters(projects, filters);
    const clients = [...new Set(projects.map((p) => p.client).filter(Boolean))] as string[];
    const managers =
      (meta.managers as string[]) ||
      ([...new Set(projects.map((p) => p.manager).filter(Boolean))] as string[]);
    const entities = findEntities(question, [
      ...projects.map((p) => p.project),
      ...clients,
      ...managers,
    ]);
    const matchedRows = rowsForEntities(projects, entities);
    const ctx: Record<string, unknown> = {
      row_counts: {
        projects_visible_via_rls: projects.length,
        projects_after_dashboard_filters: filtered.length,
      },
      firmwide_totals_from_live_rows: kpiFromProjects(projects),
      filtered_view_totals: kpiFromProjects(filtered),
      firmwide_totals_meta_all_projects: meta.kpi_all,
      firmwide_totals_meta_active_only: meta.kpi_active,
      active_project_count_live: projects.filter((p) => p.status === 'ACTIVE').length,
      status_options: meta.statuses,
      contract_types: meta.contract_types,
      top_15_clients_by_billed_live: topClientsByBilled(projects),
      top_15_clients_by_billed_meta: meta.top_clients,
      contract_value_by_phase_live: contractByPhase(projects),
      contract_value_by_phase_meta: meta.phase_analysis,
      top_managers_by_contract_value_live: topManagersByContract(projects),
      top_managers_by_contract_value_meta: meta.manager_perf,
      currently_active_dashboard_filters: filters,
      matched_entities_from_question: entities,
    };
    if (matchedRows.length) {
      ctx.matching_project_rows = matchedRows.slice(0, 80);
      ctx.matching_project_totals = kpiFromProjects(matchedRows);
      if (matchedRows.length > 80) {
        ctx.matching_project_rows_truncated = true;
        ctx.matching_project_row_count = matchedRows.length;
      }
    } else {
      ctx.note =
        'No specific project/client/manager name was detected — use the live ranking tables and totals above. Ask again with a name for row-level detail.';
    }
    const label =
      sheet === 'exec'
        ? 'Executive'
        : sheet === 'main'
          ? 'Main Report'
          : sheet === 's5'
            ? 'Project List'
            : 'Project Analysis';
    return {
      ctx,
      sheetLabel: label,
      examples: [
        'How much has been billed to [client]?',
        'What is the contract for [project]?',
      ],
    };
  }

  if (sheet === 's2') {
    const [totals, roster, monthly, company] = await Promise.all([
      fetchAll<{ employee: string; bill_hours: number; efficiency: number }>(
        supabase,
        'pa_employee_totals',
      ),
      fetchAll<{ team: string; employee: string }>(supabase, 'pa_employee_roster'),
      fetchAll<{ employee: string; month: string }>(supabase, 'pa_employee_monthly'),
      fetchAll(supabase, 'pa_company_monthly'),
    ]);
    const employee_roster: Record<string, string[]> = {};
    roster.forEach((r) => {
      if (!employee_roster[r.team]) employee_roster[r.team] = [];
      employee_roster[r.team].push(r.employee);
    });
    const allEmployees = Object.values(employee_roster).flat();
    const empEntities = findEntities(question, allEmployees, 3);
    const team =
      Object.keys(employee_roster).find((t) => nameScore(question, t) > 0) ||
      null;
    const ctx: Record<string, unknown> = {
      employee_roster_by_team: employee_roster,
      all_time_totals_per_employee: totals,
      firmwide_monthly_hours: company,
      emp_top_projects: meta.emp_top_projects,
      top_employees_by_efficiency: [...totals]
        .sort((a, b) => (b.efficiency || 0) - (a.efficiency || 0))
        .slice(0, 15),
      note_on_efficiency:
        'efficiency = billable hours / standard hours, where standard hours = (business days × 8) − PTO',
      currently_selected: filters,
      matched_employees_from_question: empEntities,
    };
    if (empEntities.length) {
      ctx.matched_employee_monthly_detail = monthly.filter((m) =>
        empEntities.includes(m.employee),
      );
      ctx.matched_employee_top_projects = Object.fromEntries(
        empEntities.map((e) => [
          e,
          ((meta.emp_top_projects as Record<string, unknown>) || {})[e] || [],
        ]),
      );
      ctx.matched_employee_totals = totals.filter((t) => empEntities.includes(t.employee));
    }
    if (team) ctx.matched_team = team;
    return {
      ctx,
      sheetLabel: 'Workload & Performance',
      examples: ["What is [employee]'s efficiency?", 'What is the US Team efficiency?'],
    };
  }

  if (sheet === 's4') {
    const [schedules, projects] = await Promise.all([
      fetchAll<{
        id: string;
        project_key: string;
        client_name: string | null;
        title: string | null;
      }>(supabase, 'pa_schedules'),
      fetchAll<ProjectRow>(supabase, 'pa_projects'),
    ]);
    const filterProject = (filters.project || '').trim();
    const entities = findEntities(question, [
      ...schedules.map((s) => s.project_key),
      ...schedules.map((s) => s.client_name),
      ...projects.map((p) => p.project),
      ...projects.map((p) => p.client),
    ]);
    const schedule =
      (filterProject &&
        (schedules.find((s) => s.project_key === filterProject) ||
          schedules.find((s) => {
            const k = s.project_key.toLowerCase();
            const n = filterProject.toLowerCase();
            return k.includes(n) || n.includes(k);
          }))) ||
      schedules.find(
        (s) =>
          entities.includes(s.project_key) ||
          (s.client_name ? entities.includes(s.client_name) : false),
      ) ||
      schedules[0] ||
      null;

    let scheduleRows: unknown[] = [];
    if (schedule) {
      const { data, error } = await supabase
        .from('pa_schedule_rows')
        .select(
          'row_kind,task,budget_remaining,target_start,target_end,actual_start,actual_end,action,estimate_time,mdesigns_comments,client_comments,sort_order',
        )
        .eq('schedule_id', schedule.id)
        .order('sort_order');
      if (error) throw new Error(`pa_schedule_rows: ${error.message}`);
      scheduleRows = data || [];
    }

    const focusKey = filterProject || schedule?.project_key || '';
    const projectRows = focusKey
      ? projects.filter(
          (p) =>
            p.project === focusKey ||
            p.parent_project === focusKey ||
            (p.project || '').toLowerCase().includes(focusKey.toLowerCase()) ||
            (focusKey.toLowerCase().includes((p.project || '').toLowerCase()) &&
              (p.project || '').length > 4),
        )
      : [];

    const ctx: Record<string, unknown> = {
      sheet_mode: 'singular_project_dashboard',
      currently_selected_filters: filters,
      available_schedules: schedules,
      selected_schedule: schedule,
      matched_entities_from_question: entities,
      project_financial_rows: projectRows.slice(0, 80),
      project_financial_totals: projectRows.length ? kpiFromProjects(projectRows) : null,
      schedule_rows: scheduleRows,
      client_comment_threads: (scheduleRows as { task?: string; mdesigns_comments?: string; client_comments?: string; budget_remaining?: string }[])
        .filter(
          (r) =>
            (r.mdesigns_comments && String(r.mdesigns_comments).trim()) ||
            (r.client_comments && String(r.client_comments).trim()),
        )
        .slice(0, 40),
    };
    return {
      ctx,
      sheetLabel: 'Project Dashboard',
      examples: [
        'What phase is active?',
        'Which tasks still need client comments?',
        'How much has been billed on this project?',
      ],
    };
  }

  if (sheet === 's6') {
    const [caps, allocs, syncRun] = await Promise.all([
      fetchAll<{
        employee_name: string;
        weekly_capacity_hours: number;
        role: string | null;
        discipline: string | null;
        active: boolean;
      }>(supabase, 'pa_employee_capacity'),
      fetchAll<{
        employee_name: string;
        week_start: string;
        planned_hours: number;
      }>(supabase, 'pa_employee_phase_allocations'),
      supabase
        .from('pa_bqe_sync_runs')
        .select('completed_at,status')
        .in('sync_type', ['historical', 'incremental'])
        .in('status', ['succeeded', 'partial'])
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      ctx: {
        sheet_mode: 'staffing_workload',
        employee_capacity_rows: caps.slice(0, 200),
        allocation_sample: allocs.slice(0, 200),
        last_time_entry_sync: syncRun.data || null,
        note: 'Staffing uses observed time entries plus planned allocations. Do not invent forward workload from timesheets alone.',
      },
      sheetLabel: 'Staffing',
      examples: [
        'Who has open capacity this week?',
        'Which employees are over capacity?',
      ],
    };
  }

  // s3 Financial & A/R
  const [arClients, revenue] = await Promise.all([
    fetchAll<{
      client: string;
      balance: number;
      d0_30: number;
      d31_60: number;
      d61_90: number;
      d91_plus: number;
      credit: number;
    }>(supabase, 'pa_ar_clients'),
    fetchAll(supabase, 'pa_monthly_revenue'),
  ]);
  const clientEntities = findEntities(
    question,
    arClients.map((c) => c.client),
  );
  const ctx: Record<string, unknown> = {
    aging_totals_firmwide_meta: meta.ar_totals,
    aging_totals_live: {
      balance: arClients.reduce((a, c) => a + (c.balance || 0), 0),
      d0_30: arClients.reduce((a, c) => a + (c.d0_30 || 0), 0),
      d31_60: arClients.reduce((a, c) => a + (c.d31_60 || 0), 0),
      d61_90: arClients.reduce((a, c) => a + (c.d61_90 || 0), 0),
      d91_plus: arClients.reduce((a, c) => a + (c.d91_plus || 0), 0),
      credit: arClients.reduce((a, c) => a + (c.credit || 0), 0),
    },
    top_clients_by_ar_balance: [...arClients].sort((a, b) => b.balance - a.balance).slice(0, 20),
    aging_by_client: arClients,
    monthly_billed_vs_collected: revenue,
    currently_active_view: filters,
    matched_clients_from_question: clientEntities,
  };
  if (clientEntities.length) {
    ctx.matched_client_rows = arClients.filter((c) => clientEntities.includes(c.client));
  }
  return {
    ctx,
    sheetLabel: 'Financial & A/R',
    examples: ['Which client owes the most?', 'How much is 91+ days overdue?'],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { sheet, question, filters } = (req.body || {}) as {
    sheet?: SheetId;
    question?: string;
    filters?: Record<string, string>;
  };

  if (!sheet || !question?.trim()) {
    res.status(400).json({ error: 'sheet and question are required' });
    return;
  }

  const examplesDefault = [
    'Ask with a client, project, or employee name for a grounded answer.',
  ];

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign in required for Ask This Sheet.' });
    return;
  }
  const accessToken = authHeader.slice(7);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      stub: true,
      answer: stubMessage(examplesDefault),
    });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    res.status(200).json({
      stub: true,
      answer:
        'Q&A proxy is missing Supabase credentials (SUPABASE_URL + anon key). Set them on Vercel and retry.',
    });
    return;
  }

  try {
    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }

    const { data: profile } = await supabase
      .from('pa_profiles')
      .select('role,employee_name,client_name')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!profile) {
      res.status(403).json({ error: 'No profile linked to this account.' });
      return;
    }
    if (profile.role === 'customer') {
      res.status(403).json({ error: 'Ask This Sheet is not available in the client portal.' });
      return;
    }
    if (sheet === 'admin') {
      res.status(403).json({ error: 'Ask This Sheet is not available on the Data Console.' });
      return;
    }
    const firmAnalytics = profile.role === 'admin' || profile.role === 'exec';
    if (!firmAnalytics && (sheet === 's3' || sheet === 'exec' || sheet === 'main')) {
      res.status(403).json({ error: 'Firm financial Q&A is limited to executives and admins.' });
      return;
    }

    const { ctx, sheetLabel, examples } = await buildContext(
      supabase as Db,
      sheet,
      question,
      {
        ...(filters || {}),
        auth_role: profile.role,
        auth_employee: profile.employee_name || '',
      },
    );

    const prompt = `You are a financial/operations analyst embedded inside an interactive practice-management dashboard for M. Designs Architects, an architecture firm. You are answering a question about the "${sheetLabel}" sheet. Use ONLY the JSON data provided below — it is loaded live from the firm's Supabase tables (Ajera/BQE exports) under this user's permissions. Prefer *_live fields over *_meta when both exist. Do not invent figures that aren't derivable from this data. If the provided data doesn't contain enough detail to fully answer, say what you can determine and briefly note what's missing rather than guessing. Answer in 1-4 concise sentences. Format dollar amounts with $ and commas, percentages with %, and bold key figures using **double asterisks**.

DATA:
${JSON.stringify(ctx)}

QUESTION: ${question}`;

    const anth = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anth.ok) {
      const errText = await anth.text();
      res.status(200).json({
        stub: true,
        answer: `Claude API error (${anth.status}). ${stubMessage(examples)} Detail: ${errText.slice(0, 200)}`,
      });
      return;
    }

    const payload = (await anth.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (payload.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('\n')
      .trim();

    if (!text) {
      res.status(200).json({ stub: true, answer: stubMessage(examples) });
      return;
    }

    res.status(200).json({ answer: text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    res.status(200).json({
      stub: true,
      answer: `Live Q&A failed (${msg}). ${stubMessage(examplesDefault)}`,
    });
  }
}
