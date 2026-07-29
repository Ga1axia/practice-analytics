import type {
  ArClient,
  CompanyMonthly,
  DashboardData,
  EmpMonthly,
  EmpTotal,
  InvoiceRow,
  KpiSnapshot,
  MonthlyRevenue,
  ProjectRow,
} from './types';
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

type MetaRow = { key: string; value: unknown };
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

function kpiFromProjects(rows: ProjectRow[]): KpiSnapshot {
  return {
    contract_amount: rows.reduce((a, r) => a + (r.contract || 0), 0),
    spent: rows.reduce((a, r) => a + (r.spent || 0), 0),
    billed: rows.reduce((a, r) => a + (r.billed || 0), 0),
    receivable: rows.reduce((a, r) => a + (r.ar || 0), 0),
    retainer_balance: rows.reduce((a, r) => a + (r.retainer_balance || 0), 0),
    cost: rows.reduce((a, r) => a + ((r.billed || 0) - (r.profit || 0)), 0),
    profit: rows.reduce((a, r) => a + (r.profit || 0), 0),
    project_count: rows.length,
  };
}

function uniq(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

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
    metaRows,
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
    fetchAll<MetaRow>('pa_meta'),
  ]);

  const meta: Record<string, unknown> = {};
  metaRows.forEach((r) => {
    meta[r.key] = r.value;
  });

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

  const kpi_all = (meta.kpi_all as DashboardData['kpi_all']) || kpiFromProjects(projects);
  const kpi_active =
    (meta.kpi_active as DashboardData['kpi_active']) ||
    kpiFromProjects(projects.filter((p) => p.status === 'ACTIVE'));

  return {
    kpi_all,
    kpi_active,
    statuses: (meta.statuses as string[]) || uniq(projects.map((p) => p.status)),
    managers: (meta.managers as string[]) || uniq(projects.map((p) => p.manager)),
    contract_types: (meta.contract_types as string[]) || uniq(projects.map((p) => p.type)),
    cities: (meta.cities as string[]) || uniq(projects.map((p) => p.city)),
    projects,
    top_clients: (meta.top_clients as DashboardData['top_clients']) || [],
    phase_analysis: (meta.phase_analysis as DashboardData['phase_analysis']) || [],
    manager_perf: (meta.manager_perf as DashboardData['manager_perf']) || [],
    ar_totals: (meta.ar_totals as DashboardData['ar_totals']) || {
      d0_30: 0,
      d31_60: 0,
      d61_90: 0,
      d91_plus: 0,
      credit: 0,
      balance: 0,
    },
    ar_clients: arClients,
    emp_monthly: empMonthly,
    emp_totals: empTotals,
    emp_top_projects: (meta.emp_top_projects as DashboardData['emp_top_projects']) || {},
    monthly_revenue: monthlyRevenue.sort((a, b) => a.month.localeCompare(b.month)),
    company_monthly: companyMonthly.sort((a, b) => a.month.localeCompare(b.month)),
    project_monthly_billed,
    billing_months: (meta.billing_months as string[]) || billingMonthsFromPmb,
    client_monthly_billed: nestAmount(
      cmb.map((r) => ({ key: r.client, month: r.month, amount: r.amount })),
    ),
    employee_roster,
    invoice_ledger,
  };
}
