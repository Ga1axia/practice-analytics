import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: '.env.local' });
config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, 'source', 'dashboard-data.json');

type EncodedTable = {
  __cols__: string[];
  __rows__: unknown[][];
  __dicts__?: Record<string, unknown[]>;
  __dates__?: string[];
  __epoch__?: string;
};

function decodeTable(t: EncodedTable | unknown) {
  if (!t || typeof t !== 'object' || !Array.isArray((t as EncodedTable).__cols__)) return t;
  const table = t as EncodedTable;
  const cols = table.__cols__;
  const rows = table.__rows__;
  const dicts = table.__dicts__ || {};
  const dateCols = new Set(table.__dates__ || []);
  const epochMs = table.__epoch__ ? new Date(table.__epoch__ + 'T00:00:00').getTime() : null;
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      let v: unknown = row[i];
      if (dicts[c] !== undefined) {
        v = v === null || v === undefined ? null : dicts[c][v as number];
      } else if (dateCols.has(c)) {
        v =
          v === null || v === undefined || epochMs === null
            ? null
            : new Date(epochMs + (v as number) * 86400000).toISOString().slice(0, 10);
      }
      obj[c] = v;
    });
    return obj;
  });
}

async function upsertBatches<T extends Record<string, unknown>>(
  client: ReturnType<typeof createClient>,
  table: string,
  rows: T[],
  onConflict?: string,
  batchSize = 500,
) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const q = client.from(table).upsert(chunk as never, onConflict ? { onConflict } : undefined);
    const { error } = await q;
    if (error) throw new Error(`${table} upsert failed @${i}: ${error.message}`);
    process.stdout.write(`  ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}\r`);
  }
  console.log(`  ${table}: ${rows.length}/${rows.length} ok`);
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  }

  const raw = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
  const DATA = { ...raw } as Record<string, unknown>;
  for (const k of [
    'projects',
    'invoice_ledger',
    'emp_monthly',
    'ar_clients',
    'top_overdue',
    'top_clients',
    'phase_analysis',
    'manager_perf',
  ]) {
    if (DATA[k]) DATA[k] = decodeTable(DATA[k]);
  }

  const client = createClient(url, key, { auth: { persistSession: false } });

  // Clear existing seed data (idempotent re-seed)
  for (const t of [
    'pa_project_monthly_billed',
    'pa_client_monthly_billed',
    'pa_invoice_ledger',
    'pa_projects',
    'pa_employee_monthly',
    'pa_employee_totals',
    'pa_employee_roster',
    'pa_ar_clients',
    'pa_monthly_revenue',
    'pa_company_monthly',
  ]) {
    const { error } = await client.from(t).delete().gte('id', 0);
    if (error) console.warn(`clear ${t}:`, error.message);
  }
  {
    const { error } = await client.from('pa_meta').delete().neq('key', '');
    if (error) console.warn('clear pa_meta:', error.message);
  }

  const projectsMap = new Map<string, Record<string, unknown>>();
  for (const p of DATA.projects as Record<string, unknown>[]) {
    const key = String(p.project);
    projectsMap.set(key, {
      project: p.project,
      client: p.client,
      city: p.city,
      manager: p.manager,
      status: p.status,
      type: p.type,
      phase: p.phase,
      contract: p.contract,
      spent: p.spent,
      billed: p.billed,
      pct_used: p.pct_used,
      pct_billed: p.pct_billed,
      retainer_paid: p.retainer_paid,
      retainer_balance: p.retainer_balance,
      ar: p.ar,
      profit: p.profit,
      margin: p.margin,
    });
  }
  const projects = [...projectsMap.values()];

  const empMonthly = (DATA.emp_monthly as Record<string, unknown>[]).map((r) => ({
    employee: r.employee,
    month: r.month,
    nb_hours: r.nb_hours,
    bill_hours: r.bill_hours,
    total_hours: r.total_hours,
    efficiency: r.efficiency,
    pto_hours: r.pto_hours,
    network_days: r.network_days,
    standard_hours: r.standard_hours,
  }));

  const empTotals = DATA.emp_totals as Record<string, unknown>[];
  const roster = DATA.employee_roster as Record<string, string[]>;
  const rosterRows = Object.entries(roster).flatMap(([team, names]) =>
    names.map((employee) => ({ team, employee })),
  );

  const arClients = (DATA.ar_clients as Record<string, unknown>[]).map((c) => ({
    client: c.client,
    d0_30: c.d0_30,
    d31_60: c.d31_60,
    d61_90: c.d61_90,
    d91_plus: c.d91_plus,
    credit: c.credit,
    balance: c.balance,
  }));

  const invoices = (DATA.invoice_ledger as Record<string, unknown>[]).map((r) => ({
    client: r.c as string,
    invoice_date: r.d as string | null,
    payment_date: r.p as string | null,
    net: (r.n as number) || 0,
    balance: (r.b as number) || 0,
  }));

  const monthlyRevenue = DATA.monthly_revenue as Record<string, unknown>[];
  const companyMonthly = DATA.company_monthly as Record<string, unknown>[];

  const pmbMap = DATA.project_monthly_billed as Record<string, Record<string, number>>;
  const pmbRows = Object.entries(pmbMap).flatMap(([project, months]) =>
    Object.entries(months).map(([month, amount]) => ({ project, month, amount })),
  );

  const cmbMap = DATA.client_monthly_billed as Record<string, Record<string, number>>;
  const cmbRows = Object.entries(cmbMap).flatMap(([client, months]) =>
    Object.entries(months).map(([month, amount]) => ({ client, month, amount })),
  );

  const metaEntries = [
    { key: 'kpi_all', value: DATA.kpi_all },
    { key: 'kpi_active', value: DATA.kpi_active },
    { key: 'statuses', value: DATA.statuses },
    { key: 'managers', value: DATA.managers },
    { key: 'contract_types', value: DATA.contract_types },
    { key: 'cities', value: DATA.cities },
    { key: 'top_clients', value: DATA.top_clients },
    { key: 'phase_analysis', value: DATA.phase_analysis },
    { key: 'manager_perf', value: DATA.manager_perf },
    { key: 'ar_totals', value: DATA.ar_totals },
    { key: 'emp_top_projects', value: DATA.emp_top_projects },
    { key: 'billing_months', value: DATA.billing_months },
  ];

  console.log('Seeding…');
  await upsertBatches(client, 'pa_projects', projects, 'project');
  await upsertBatches(client, 'pa_employee_monthly', empMonthly, 'employee,month');
  await upsertBatches(client, 'pa_employee_totals', empTotals, 'employee');
  await upsertBatches(client, 'pa_employee_roster', rosterRows, 'team,employee');
  await upsertBatches(client, 'pa_ar_clients', arClients, 'client');
  await upsertBatches(client, 'pa_invoice_ledger', invoices, undefined, 800);
  await upsertBatches(client, 'pa_monthly_revenue', monthlyRevenue, 'month');
  await upsertBatches(client, 'pa_company_monthly', companyMonthly, 'month');
  await upsertBatches(client, 'pa_project_monthly_billed', pmbRows, 'project,month', 800);
  await upsertBatches(client, 'pa_client_monthly_billed', cmbRows, 'client,month', 800);
  await upsertBatches(client, 'pa_meta', metaEntries, 'key');

  console.log('Seed complete.');
  console.log({
    projects: projects.length,
    emp_monthly: empMonthly.length,
    invoices: invoices.length,
    pmb: pmbRows.length,
    cmb: cmbRows.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
