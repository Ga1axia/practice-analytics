import type { CompanyMonthly } from './types';

export type NbBreakdown = {
  clientNb: number;
  mbd: number;
  ptoSick: number;
  others: number;
  probono: number;
};

export type EfficiencyAnalysis = {
  month: string;
  monthLabel: string;
  billHours: number;
  nbHours: number;
  probonoHours: number;
  hoursWorked: number;
  stdHours: number;
  /** Bill / Std */
  efficiency: number;
  /** Share of hours worked */
  billShare: number;
  nbShare: number;
  probonoShare: number;
  breakdown: NbBreakdown;
};

/** Minimal time-entry shape for firm Bill/NB rollups. */
export type EfficiencyTimeRow = {
  work_date: string;
  actual_hours: number;
  is_billable: boolean;
  is_written_off?: boolean | null;
  is_extra?: boolean | null;
  employee_name?: string | null;
  project_name?: string | null;
  parent_project_name?: string | null;
  activity?: string | null;
};

function monthTitle(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `${mon}-${y}`;
}

export function currentYearMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Weekdays in a calendar month (UTC), matching BQE sync Std Hrs. */
export function networkDaysInMonth(ym: string): number {
  const [ys, ms] = ym.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m) return 22;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let day = 1; day <= days; day += 1) {
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

/**
 * Classify non-billable time into Power BI–style buckets.
 * Keep in sync with `classifyNbHours` in api/_lib/bqeSyncBuild.ts.
 */
export function classifyNbHours(
  projectLabel: string | null | undefined,
  activityLabel?: string | null,
): 'clientNb' | 'mbd' | 'ptoSick' | 'probono' | 'others' {
  const text = `${projectLabel || ''} ${activityLabel || ''}`.toLowerCase();
  if (/pro\s*bono|probono/.test(text)) return 'probono';
  if (/pto|sick|vacation|holiday|time off/.test(text)) return 'ptoSick';
  if (/potential client|client interaction|client hrs/.test(text)) return 'clientNb';
  if (
    /business development|\bmbd\b|marketing|sales & marketing|proposal|contracts/.test(
      text,
    )
  ) {
    return 'mbd';
  }
  return 'others';
}

/**
 * Prefer a complete recent month over a sparse in-progress month.
 * Current calendar month must reach 85% of the prior month's hours;
 * any latest month below 55% of the prior still falls back.
 */
export function pickEfficiencyMonth(
  rows: CompanyMonthly[],
  now = new Date(),
): CompanyMonthly | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const latest = sorted[0]!;
  const prev = sorted[1];
  if (!prev) return latest;
  const currentYm = currentYearMonth(now);
  if (latest.month === currentYm && latest.total_hours < prev.total_hours * 0.85) {
    return prev;
  }
  if (latest.total_hours < prev.total_hours * 0.55) return prev;
  return latest;
}

export function buildEfficiencyAnalysis(
  companyMonthly: CompanyMonthly[],
  now = new Date(),
): EfficiencyAnalysis | null {
  const row = pickEfficiencyMonth(companyMonthly, now);
  if (!row) return null;

  const billHours = row.bill_hours || 0;
  const nbHours = row.nb_hours || 0;
  const hoursWorked = row.total_hours || billHours + nbHours;
  const stdHours = row.standard_hours || 0;
  const probonoHours = row.probono_hours || 0;

  const breakdown: NbBreakdown = {
    clientNb: row.client_nb_hours || 0,
    mbd: row.mbd_hours || 0,
    ptoSick: row.pto_sick_hours || 0,
    others: row.others_nb_hours || 0,
    probono: probonoHours,
  };

  // If sync hasn't populated categories yet, keep donut usable from bill/nb only.
  const categorized =
    breakdown.clientNb +
    breakdown.mbd +
    breakdown.ptoSick +
    breakdown.others +
    breakdown.probono;
  if (nbHours > 0 && categorized <= 0) {
    breakdown.others = Math.max(0, nbHours - probonoHours);
  }

  const denom = hoursWorked > 0 ? hoursWorked : 1;
  const nbForShare = Math.max(0, nbHours - probonoHours);
  return {
    month: row.month,
    monthLabel: monthTitle(row.month),
    billHours,
    nbHours,
    probonoHours,
    hoursWorked,
    stdHours,
    efficiency: stdHours > 0 ? billHours / stdHours : 0,
    billShare: billHours / denom,
    nbShare: nbForShare / denom,
    probonoShare: probonoHours / denom,
    breakdown,
  };
}

type MonthAgg = {
  bill: number;
  nb: number;
  clientNb: number;
  mbd: number;
  ptoSick: number;
  others: number;
  probono: number;
  employees: Set<string>;
};

function emptyMonth(): MonthAgg {
  return {
    bill: 0,
    nb: 0,
    clientNb: 0,
    mbd: 0,
    ptoSick: 0,
    others: 0,
    probono: 0,
    employees: new Set(),
  };
}

/** Roll raw time entries into the same firm-monthly shape the chart reads. */
export function companyMonthlyFromTimeEntries(rows: EfficiencyTimeRow[]): CompanyMonthly[] {
  const map = new Map<string, MonthAgg>();
  for (const te of rows) {
    const hours = Number(te.actual_hours) || 0;
    if (!hours) continue;
    const month = String(te.work_date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    const cur = map.get(month) || emptyMonth();
    const emp = (te.employee_name || '').trim();
    if (emp) cur.employees.add(emp);

    const billable = !!te.is_billable && !te.is_written_off && !te.is_extra;
    if (billable) {
      cur.bill += hours;
    } else {
      cur.nb += hours;
      const label = `${te.parent_project_name || ''} ${te.project_name || ''}`;
      const bucket = classifyNbHours(label, te.activity);
      if (bucket === 'clientNb') cur.clientNb += hours;
      else if (bucket === 'mbd') cur.mbd += hours;
      else if (bucket === 'ptoSick') cur.ptoSick += hours;
      else if (bucket === 'probono') cur.probono += hours;
      else cur.others += hours;
    }
    map.set(month, cur);
  }

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => {
      const networkDays = networkDaysInMonth(month);
      const empCount = v.employees.size || 1;
      const capacity_hours = networkDays * 8 * empCount;
      const standard_hours = Math.max(0, capacity_hours - v.ptoSick);
      const bill_hours = v.bill;
      const nb_hours = v.nb;
      return {
        month,
        bill_hours,
        nb_hours,
        total_hours: bill_hours + nb_hours,
        capacity_hours,
        standard_hours,
        efficiency: standard_hours > 0 ? bill_hours / standard_hours : 0,
        client_nb_hours: v.clientNb,
        mbd_hours: v.mbd,
        pto_sick_hours: v.ptoSick,
        others_nb_hours: v.others,
        probono_hours: v.probono,
      };
    });
}

export function fmtHours(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.05) return Math.round(n).toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
