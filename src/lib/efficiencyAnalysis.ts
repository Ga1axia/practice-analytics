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

function monthTitle(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  const mon = d.toLocaleString('en-US', { month: 'short' });
  return `${mon}-${y}`;
}

/** Prefer a complete recent month over a sparse current month. */
export function pickEfficiencyMonth(rows: CompanyMonthly[]): CompanyMonthly | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.month.localeCompare(a.month));
  const latest = sorted[0]!;
  const prev = sorted[1];
  if (prev && latest.total_hours < prev.total_hours * 0.55) return prev;
  return latest;
}

export function buildEfficiencyAnalysis(
  companyMonthly: CompanyMonthly[],
): EfficiencyAnalysis | null {
  const row = pickEfficiencyMonth(companyMonthly);
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

export function fmtHours(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.05) return Math.round(n).toLocaleString('en-US');
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
