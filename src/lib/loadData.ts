import type {
  ArClient,
  CompanyMonthly,
  DashboardData,
  EmpMonthly,
  EmpTotal,
  InvoiceRow,
  KpiSnapshot,
  ManagerPerf,
  MonthlyRevenue,
  PhaseRow,
  ProjectRow,
  TopClient,
} from './types';
import { rowOutstanding, sumAmountReceivable } from './receivable';
import { supabase } from './supabase';

async function fetchAll<T>(table: string, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data || []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

type RosterRow = { team: string; employee: string };
type PmbRow = { project: string; month: string; amount: number };
type CmbRow = { client: string; month: string; amount: number };
type InvDb = {
  client: string | null;
  invoice_date: string | null;
  payment_date: string | null;
  net: number;
  balance: number;
};

function nestAmount(rows: { key: string; month: string; amount: number }[]) {
  const map: Record<string, Record<string, number>> = {};
  rows.forEach((r) => {
    if (!map[r.key]) map[r.key] = {};
    map[r.key][r.month] = r.amount;
  });
  return map;
}

/** Prefer project-header rows for counts; otherwise all rows. */
function projectUnits(rows: ProjectRow[]): ProjectRow[] {
  const headers = rows.filter((r) => r.row_kind === 'project');
  return headers.length ? headers : rows;
}

/** Phase / detail rows for financial rollups (avoid double-counting project headers). */
function detailRows(rows: ProjectRow[]): ProjectRow[] {
  const phases = rows.filter((r) => r.row_kind === 'phase' || !r.row_kind);
  // If upload only has phases (or mixed without kinds), use all non-header rows when headers exist
  const headers = rows.filter((r) => r.row_kind === 'project');
  if (headers.length && phases.length) return phases;
  if (headers.length && !phases.length) return headers;
  return rows;
}

function kpiFromProjects(rows: ProjectRow[], arClients?: ArClient[]): KpiSnapshot {
  const details = detailRows(rows);
  const units = projectUnits(rows);
  return {
    contract_amount: details.reduce((a, r) => a + (r.contract || 0), 0),
    spent: details.reduce((a, r) => a + (r.spent || 0), 0),
    billed: details.reduce((a, r) => a + (r.billed || 0), 0),
    receivable: sumAmountReceivable(details, arClients).amount,
    retainer_balance: details.reduce((a, r) => a + (r.retainer_balance || 0), 0),
    cost: details.reduce((a, r) => a + ((r.billed || 0) - (r.profit || 0)), 0),
    profit: details.reduce((a, r) => a + (r.profit || 0), 0),
    project_count: units.length,
  };
}

function uniq(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

function topClientsFromProjects(rows: ProjectRow[], n = 15): TopClient[] {
  const map: Record<string, TopClient> = {};
  detailRows(rows).forEach((r) => {
    const client = r.client || 'Unassigned';
    if (!map[client]) {
      map[client] = { client, billed: 0, contract: 0, profit: 0, ar: 0 };
    }
    map[client].billed += r.billed || 0;
    map[client].contract += r.contract || 0;
    map[client].profit += r.profit || 0;
    map[client].ar += rowOutstanding(r);
  });
  return Object.values(map)
    .sort((a, b) => b.contract - a.contract)
    .slice(0, n);
}

function phaseAnalysisFromProjects(rows: ProjectRow[]): PhaseRow[] {
  const map: Record<string, PhaseRow> = {};
  detailRows(rows).forEach((r) => {
    const phase = (r.phase || 'Other').trim() || 'Other';
    if (phase === 'Other' && r.row_kind === 'project') return;
    if (!map[phase]) map[phase] = { phase, contract: 0, billed: 0, profit: 0 };
    map[phase].contract += r.contract || 0;
    map[phase].billed = (map[phase].billed || 0) + (r.billed || 0);
    map[phase].profit = (map[phase].profit || 0) + (r.profit || 0);
  });
  return Object.values(map).sort((a, b) => b.contract - a.contract);
}

function managerPerfFromProjects(rows: ProjectRow[]): ManagerPerf[] {
  const map: Record<string, ManagerPerf> = {};
  detailRows(rows).forEach((r) => {
    if (!r.manager) return;
    if (!map[r.manager]) {
      map[r.manager] = { manager: r.manager, contract: 0, billed: 0, profit: 0 };
    }
    map[r.manager].contract += r.contract || 0;
    map[r.manager].billed = (map[r.manager].billed || 0) + (r.billed || 0);
    map[r.manager].profit = (map[r.manager].profit || 0) + (r.profit || 0);
  });
  return Object.values(map).sort((a, b) => b.contract - a.contract);
}

/**
 * Load dashboard data with pa_projects (Project List upload) as source of truth
 * for KPIs, filters, and project-derived rollups. Supplemental tables are still
 * loaded for sheets that need them (workload, A/R, monthly billing).
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const [
    projects,
    empMonthly,
    empTotals,
    roster,
    arClients,
    invoices,
    monthlyRevenue,
    companyMonthly,
    pmb,
    cmb,
  ] = await Promise.all([
    fetchAll<ProjectRow>('pa_projects'),
    fetchAll<EmpMonthly>('pa_employee_monthly'),
    fetchAll<EmpTotal>('pa_employee_totals'),
    fetchAll<RosterRow>('pa_employee_roster'),
    fetchAll<ArClient>('pa_ar_clients'),
    fetchAll<InvDb>('pa_invoice_ledger'),
    fetchAll<MonthlyRevenue>('pa_monthly_revenue'),
    fetchAll<CompanyMonthly>('pa_company_monthly'),
    fetchAll<PmbRow>('pa_project_monthly_billed'),
    fetchAll<CmbRow>('pa_client_monthly_billed'),
  ]);

  const employee_roster: Record<string, string[]> = {};
  roster.forEach((r) => {
    if (!employee_roster[r.team]) employee_roster[r.team] = [];
    employee_roster[r.team].push(r.employee);
  });

  const invoice_ledger: InvoiceRow[] = invoices.map((r) => ({
    c: r.client || '',
    d: r.invoice_date,
    p: r.payment_date,
    n: r.net || 0,
    b: r.balance || 0,
  }));

  const project_monthly_billed = nestAmount(
    pmb.map((r) => ({ key: r.project, month: r.month, amount: r.amount })),
  );
  const billingMonthsFromPmb = uniq(pmb.map((r) => r.month));

  const kpi_all = kpiFromProjects(projects, arClients);
  const activeRows = projects.filter((p) => !p.status || p.status === 'ACTIVE');
  const kpi_active = kpiFromProjects(activeRows.length ? activeRows : projects, arClients);

  const ar_totals = arClients.reduce(
    (acc, c) => ({
      d0_30: acc.d0_30 + (c.d0_30 || 0),
      d31_60: acc.d31_60 + (c.d31_60 || 0),
      d61_90: acc.d61_90 + (c.d61_90 || 0),
      d91_plus: acc.d91_plus + (c.d91_plus || 0),
      credit: acc.credit + (c.credit || 0),
      balance: acc.balance + (c.balance || 0),
    }),
    { d0_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0, credit: 0, balance: 0 },
  );

  return {
    kpi_all,
    kpi_active,
    statuses: uniq(projects.map((p) => p.status)),
    managers: uniq(projects.map((p) => p.manager)),
    contract_types: uniq(projects.map((p) => p.type)),
    cities: uniq(projects.map((p) => p.city)),
    projects,
    top_clients: topClientsFromProjects(projects),
    phase_analysis: phaseAnalysisFromProjects(projects),
    manager_perf: managerPerfFromProjects(projects),
    ar_totals,
    ar_clients: arClients,
    emp_monthly: empMonthly,
    emp_totals: empTotals,
    emp_top_projects: {},
    monthly_revenue: monthlyRevenue.sort((a, b) => a.month.localeCompare(b.month)),
    company_monthly: companyMonthly.sort((a, b) => a.month.localeCompare(b.month)),
    project_monthly_billed,
    billing_months: billingMonthsFromPmb,
    client_monthly_billed: nestAmount(
      cmb.map((r) => ({ key: r.client, month: r.month, amount: r.amount })),
    ),
    employee_roster,
    invoice_ledger,
  };
}
