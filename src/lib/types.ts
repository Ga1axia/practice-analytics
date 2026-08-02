export type KpiSnapshot = {
  contract_amount: number;
  spent: number;
  billed: number;
  receivable: number;
  retainer_balance: number;
  cost: number;
  profit: number;
  project_count: number;
};

export type ProjectRowKind = 'project' | 'phase';

export type ProjectRow = {
  project: string;
  client: string | null;
  city: string | null;
  manager: string | null;
  status: string | null;
  type: string | null;
  phase: string | null;
  contract: number;
  spent: number;
  billed: number;
  pct_used: number | null;
  pct_billed: number | null;
  retainer_paid: number;
  retainer_balance: number;
  ar: number;
  profit: number;
  margin: number | null;
  /** Explicit hierarchy from Project List upload (optional on older rows). */
  row_kind?: ProjectRowKind | null;
  parent_project?: string | null;
  billed_hours?: number | null;
  spent_hours?: number | null;
  contract_outstanding?: number | null;
  sort_order?: number | null;
};

export type EmpMonthly = {
  employee: string;
  month: string;
  nb_hours: number;
  bill_hours: number;
  total_hours: number;
  efficiency: number;
  pto_hours: number;
  network_days: number;
  standard_hours: number;
};

export type EmpTotal = {
  employee: string;
  bill_hours: number;
  nb_hours: number;
  total_hours: number;
  standard_hours: number;
  efficiency: number;
};

export type ArClient = {
  client: string;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d91_plus: number;
  credit: number;
  balance: number;
};

export type InvoiceRow = {
  c: string;
  d: string | null;
  p: string | null;
  n: number;
  b: number;
};

export type MonthlyRevenue = {
  month: string;
  gross_billed: number;
  amount_paid: number;
  net_billed: number;
};

export type CompanyMonthly = {
  month: string;
  bill_hours: number;
  nb_hours: number;
  total_hours: number;
  standard_hours: number;
  efficiency: number;
};

export type TopClient = {
  client: string;
  billed: number;
  contract: number;
  profit: number;
  ar: number;
};

export type PhaseRow = { phase: string; contract: number; billed?: number; profit?: number };
export type ManagerPerf = { manager: string; contract: number; billed?: number; profit?: number };
export type EmpTopProject = { project: string; hours: number };

export type DashboardData = {
  kpi_all: KpiSnapshot;
  kpi_active: KpiSnapshot;
  statuses: string[];
  managers: string[];
  contract_types: string[];
  cities: string[];
  projects: ProjectRow[];
  top_clients: TopClient[];
  phase_analysis: PhaseRow[];
  manager_perf: ManagerPerf[];
  ar_totals: Omit<ArClient, 'client'>;
  ar_clients: ArClient[];
  emp_monthly: EmpMonthly[];
  emp_totals: EmpTotal[];
  emp_top_projects: Record<string, EmpTopProject[]>;
  monthly_revenue: MonthlyRevenue[];
  company_monthly: CompanyMonthly[];
  project_monthly_billed: Record<string, Record<string, number>>;
  billing_months: string[];
  client_monthly_billed: Record<string, Record<string, number>>;
  employee_roster: Record<string, string[]>;
  invoice_ledger: InvoiceRow[];
};

export type SheetId = 'exec' | 'main' | 's1' | 's2' | 's3' | 's4' | 's5';
