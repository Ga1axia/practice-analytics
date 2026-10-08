import { processPhaseLabel } from './architecturalProcess';
import type { PhaseNode, ProjectNode } from './projectListHierarchy';
import { managerNameMatches } from './projectManagerMatch';
import type { ProjectRow } from './types';

export type PhaseBudgetBar = {
  key: string;
  label: string;
  completed: boolean;
  contract: number;
  spent: number;
  pct: number;
  spentHours: number;
  isYours: boolean;
};

export function isPhaseBudgetCompleted(status: string | null | undefined): boolean {
  const s = (status || '').toUpperCase();
  return s === 'COMPLETED' || s === 'COMPLETE' || s === 'DONE';
}

/** Dollar spent on a phase row (Project List / BQE). */
export function phaseBudgetSpent(row: ProjectRow): number {
  return row.spent || 0;
}

/** Spent ÷ contract; prefers stored pct_used when present. */
export function phaseBudgetPct(row: ProjectRow): number | null {
  const contract = row.contract || 0;
  if (contract <= 0) return null;
  if (row.pct_used != null && Number.isFinite(row.pct_used)) return row.pct_used;
  return phaseBudgetSpent(row) / contract;
}

/** Spent/contract bar colors — matches Main Report budget analysis. */
export function budgetBurnFillColor(pct: number, completed: boolean): string {
  if (completed) {
    if (pct > 1) return '#C45C5C';
    if (pct >= 0.9) return '#5B9BD5';
    return '#3D9B5F';
  }
  if (pct > 1) return '#E8A8A4';
  if (Math.abs(pct - 1) < 0.005) return '#9EC9E8';
  if (pct >= 0.9) return '#E8D48A';
  return '#A8D4B8';
}

function phaseLabel(ph: PhaseNode): string {
  return processPhaseLabel(ph.label || ph.row.phase) || ph.label || ph.row.phase || 'Phase';
}

function barFromPhase(ph: PhaseNode, isYours: boolean): PhaseBudgetBar | null {
  const contract = ph.row.contract || 0;
  if (contract <= 0) return null;
  const pct = phaseBudgetPct(ph.row);
  if (pct == null) return null;
  const spent = phaseBudgetSpent(ph.row);
  return {
    key: ph.row.project,
    label: phaseLabel(ph),
    completed: isPhaseBudgetCompleted(ph.row.status),
    contract,
    spent,
    pct,
    spentHours: Number(ph.row.spent_hours) || 0,
    isYours,
  };
}

/**
 * Phase budget burn bars for the employee portal.
 * Project leads see every phase; phase leads see only phases they manage.
 */
export function buildProjectPhaseBudgetBars(input: {
  project: Pick<ProjectNode, 'phases' | 'row' | 'key'>;
  employeeName: string;
  viewAllPhases: boolean;
}): PhaseBudgetBar[] {
  const name = input.employeeName.trim();
  const bars: PhaseBudgetBar[] = [];

  if (input.project.phases.length) {
    for (const ph of input.project.phases) {
      const yours = managerNameMatches(ph.row.manager, name);
      if (!input.viewAllPhases && !yours) continue;
      const bar = barFromPhase(ph, yours);
      if (bar) bars.push(bar);
    }
  } else if (input.viewAllPhases && input.project.row) {
    const row = input.project.row;
    const contract = row.contract || 0;
    if (contract > 0) {
      const pct = phaseBudgetPct(row);
      if (pct != null) {
        bars.push({
          key: input.project.key,
          label: 'Project',
          completed: isPhaseBudgetCompleted(row.status),
          contract,
          spent: phaseBudgetSpent(row),
          pct,
          spentHours: Number(row.spent_hours) || 0,
          isYours: managerNameMatches(row.manager, name),
        });
      }
    }
  }

  return bars.sort((a, b) => b.pct - a.pct);
}

export type ProjectBudgetUsage = {
  pct: number;
  spent: number;
  contract: number;
  completed: boolean;
};

/** Total project spent ÷ contract (phase totals when present). */
export function projectBudgetUsage(
  project: Pick<ProjectNode, 'phases' | 'row' | 'contract'>,
): ProjectBudgetUsage | null {
  let contract = 0;
  let spent = 0;

  if (project.phases.length) {
    contract = project.phases.reduce((a, ph) => a + (ph.row.contract || 0), 0);
    spent = project.phases.reduce((a, ph) => a + phaseBudgetSpent(ph.row), 0);
  }

  if (contract <= 0) {
    contract = project.contract || project.row?.contract || 0;
    spent = project.row ? phaseBudgetSpent(project.row) : 0;
  }

  if (contract <= 0) return null;

  const status =
    project.row?.status ??
    project.phases.find((ph) => (ph.row.status || '').trim())?.row.status ??
    null;

  return {
    pct: spent / contract,
    spent,
    contract,
    completed: isPhaseBudgetCompleted(status),
  };
}
