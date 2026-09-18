import type { EmpMonthly, EmpTotal } from './types';

export type RosterRow = { team: string; employee: string };

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export function compareEmployeeName(a: string, b: string): number {
  return collator.compare(a, b);
}

export function compareTeamName(a: string, b: string): number {
  return collator.compare(a, b);
}

export function hasLoggedHours(row: {
  bill_hours?: number | null;
  nb_hours?: number | null;
  total_hours?: number | null;
}): boolean {
  return (
    (row.total_hours || 0) > 0 ||
    (row.bill_hours || 0) > 0 ||
    (row.nb_hours || 0) > 0
  );
}

/** Names with any billable/non-billable time in totals or monthly rollups. */
export function activeTimeEmployeeNames(
  empTotals: EmpTotal[],
  empMonthly: EmpMonthly[] = [],
): Set<string> {
  const names = new Set<string>();
  for (const e of empTotals) {
    if (hasLoggedHours(e) && e.employee) names.add(e.employee);
  }
  for (const m of empMonthly) {
    if (hasLoggedHours(m) && m.employee) names.add(m.employee);
  }
  return names;
}

/**
 * Team → sorted employee names for people actively logging time.
 * Roster rows without hours are dropped; time-only names land under "Other".
 */
export function buildEmployeeRoster(
  rosterRows: RosterRow[],
  empTotals: EmpTotal[],
  empMonthly: EmpMonthly[] = [],
): Record<string, string[]> {
  const active = activeTimeEmployeeNames(empTotals, empMonthly);
  const byTeam = new Map<string, Set<string>>();

  for (const r of rosterRows) {
    if (!r.employee || !active.has(r.employee)) continue;
    const team = (r.team || 'Staff').trim() || 'Staff';
    let set = byTeam.get(team);
    if (!set) {
      set = new Set();
      byTeam.set(team, set);
    }
    set.add(r.employee);
  }

  const rosterNames = new Set<string>();
  for (const set of byTeam.values()) {
    for (const n of set) rosterNames.add(n);
  }
  for (const name of active) {
    if (rosterNames.has(name)) continue;
    let set = byTeam.get('Other');
    if (!set) {
      set = new Set();
      byTeam.set('Other', set);
    }
    set.add(name);
  }

  const out: Record<string, string[]> = {};
  for (const team of [...byTeam.keys()].sort(compareTeamName)) {
    out[team] = [...byTeam.get(team)!].sort(compareEmployeeName);
  }
  return out;
}

/** Sort roster rows before persisting to pa_employee_roster. */
export function sortRosterRows(rows: RosterRow[]): RosterRow[] {
  return rows.slice().sort((a, b) => {
    const t = compareTeamName(a.team, b.team);
    if (t !== 0) return t;
    return compareEmployeeName(a.employee, b.employee);
  });
}
