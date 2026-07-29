import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

type SheetId = 's1' | 's2' | 's3';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

function findEntity(text: string, names: (string | null | undefined)[]) {
  const t = text.toLowerCase();
  let best: string | null = null;
  names.forEach((name) => {
    if (!name) return;
    const n = String(name).toLowerCase();
    if (n.length >= 3 && t.includes(n)) {
      if (!best || n.length > best.length) best = name;
    }
  });
  return best;
}

function stubMessage(examples: string[]) {
  return (
    `Live Q&A needs ANTHROPIC_API_KEY on the Vercel server (or vercel dev). ` +
    `The UI is ready — set the key in project env, redeploy, and ask again. Examples: ` +
    examples.join(' · ')
  );
}

async function loadMeta(supabase: Db) {
  const { data, error } = await supabase.from('pa_meta').select('key,value');
  if (error) throw error;
  const meta: Record<string, unknown> = {};
  (data || []).forEach((r: { key: string; value: unknown }) => {
    meta[r.key] = r.value;
  });
  return meta;
}

async function buildContext(
  supabase: Db,
  sheet: SheetId,
  question: string,
  filters: Record<string, string>,
) {
  const meta = await loadMeta(supabase);

  if (sheet === 's1') {
    const { data: projects } = await supabase.from('pa_projects').select('*').limit(5000);
    const rows = projects || [];
    const clients = [...new Set(rows.map((p: { client: string }) => p.client))];
    const managers = (meta.managers as string[]) || [];
    const entity = findEntity(question, [
      ...rows.map((p: { project: string }) => p.project),
      ...clients,
      ...managers,
    ]);
    const ctx: Record<string, unknown> = {
      firmwide_totals_all_projects: meta.kpi_all,
      firmwide_totals_active_only: meta.kpi_active,
      status_options: meta.statuses,
      contract_types: meta.contract_types,
      top_15_clients_by_billed: meta.top_clients,
      contract_value_by_phase: meta.phase_analysis,
      top_managers_by_contract_value: meta.manager_perf,
      currently_active_dashboard_filters: filters,
    };
    if (entity) {
      ctx.matched_entity_from_question = entity;
      ctx.matching_project_rows = rows.filter(
        (p: { project: string; client: string; manager: string }) =>
          p.project === entity || p.client === entity || p.manager === entity,
      );
    } else {
      ctx.note =
        "No specific project/client/manager name was detected — only firm-wide aggregates are included. If needed, ask again with the entity name.";
    }
    return { ctx, sheetLabel: 'Project Analysis', examples: [
      'How much has been billed to [client]?',
      'What is the contract for [project]?',
    ]};
  }

  if (sheet === 's2') {
    const [{ data: totals }, { data: roster }, { data: monthly }, { data: company }] =
      await Promise.all([
        supabase.from('pa_employee_totals').select('*'),
        supabase.from('pa_employee_roster').select('*'),
        supabase.from('pa_employee_monthly').select('*').limit(2000),
        supabase.from('pa_company_monthly').select('*'),
      ]);
    const employee_roster: Record<string, string[]> = {};
    (roster || []).forEach((r: { team: string; employee: string }) => {
      if (!employee_roster[r.team]) employee_roster[r.team] = [];
      employee_roster[r.team].push(r.employee);
    });
    const allEmployees = Object.values(employee_roster).flat();
    const emp = findEntity(question, allEmployees);
    const team = Object.keys(employee_roster).find((t) =>
      question.toLowerCase().includes(t.toLowerCase()),
    );
    const ctx: Record<string, unknown> = {
      employee_roster_by_team: employee_roster,
      all_time_totals_per_employee: totals,
      firmwide_monthly_hours: company,
      emp_top_projects: meta.emp_top_projects,
      note_on_efficiency:
        'efficiency = billable hours / standard hours, where standard hours = (business days × 8) − PTO',
      currently_selected: filters,
    };
    if (emp) {
      ctx.matched_employee = emp;
      ctx.matched_employee_monthly_detail = (monthly || []).filter(
        (m: { employee: string }) => m.employee === emp,
      );
      ctx.matched_employee_top_projects =
        ((meta.emp_top_projects as Record<string, unknown>) || {})[emp] || [];
    }
    if (team) ctx.matched_team = team;
    return {
      ctx,
      sheetLabel: 'Workload & Performance',
      examples: ["What is [employee]'s efficiency?", 'What is the US Team efficiency?'],
    };
  }

  // s3
  const [{ data: arClients }, { data: revenue }] = await Promise.all([
    supabase.from('pa_ar_clients').select('*'),
    supabase.from('pa_monthly_revenue').select('*').order('month'),
  ]);
  const client = findEntity(
    question,
    (arClients || []).map((c: { client: string }) => c.client),
  );
  const ctx: Record<string, unknown> = {
    aging_totals_firmwide: meta.ar_totals,
    aging_by_client: arClients,
    monthly_billed_vs_collected: revenue,
    currently_active_view: filters,
  };
  if (client) ctx.matched_client = client;
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      stub: true,
      answer: stubMessage(examplesDefault),
    });
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(200).json({
      stub: true,
      answer:
        'Q&A proxy is missing Supabase credentials (SUPABASE_URL + key). Set them on Vercel and retry.',
    });
    return;
  }

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { ctx, sheetLabel, examples } = await buildContext(
      supabase,
      sheet,
      question,
      filters || {},
    );

    const prompt = `You are a financial/operations analyst embedded inside an interactive practice-management dashboard for M. Designs Architects, an architecture firm. You are answering a question about the "${sheetLabel}" sheet. Use ONLY the JSON data provided below — it is a real slice of the firm's underlying Ajera/BQE export data that powers this dashboard. Do not invent figures that aren't derivable from this data. If the provided data doesn't contain enough detail to fully answer, say what you can determine and briefly note what's missing rather than guessing. Answer in 1-4 concise sentences. Format dollar amounts with $ and commas, percentages with %, and bold key figures using **double asterisks**.

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
