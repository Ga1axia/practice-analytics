import type { EmpMonthly, EmpTotal } from './types';

export type RosterRow = { team: string; employee: string };

/** Teams shown in employee filters (US / Pak). */
export const PRACTICE_ROSTER_TEAMS = ['US Team', 'Pak Team'] as const;

export type PracticeRosterTeam = (typeof PRACTICE_ROSTER_TEAMS)[number];

/** Default exhaustive practice roster — seed when table is empty. */
export const DEFAULT_EMPLOYEE_ROSTER: RosterRow[] = [
  { team: 'US Team', employee: 'Avery Cobe' },
  { team: 'US Team', employee: 'Arnita Serri' },
  { team: 'US Team', employee: 'Malika Junaid' },
  { team: 'US Team', employee: 'Ni Ni' },
  { team: 'US Team', employee: 'Sadia Puri' },
  { team: 'US Team', employee: 'Maria Abreu' },
  { team: 'US Team', employee: 'Richard Hugi' },
  { team: 'US Team', employee: 'Swaroopa Dugani' },
  { team: 'US Team', employee: 'Priya Arora' },
  { team: 'US Team', employee: 'Laura Bush' },
  { team: 'US Team', employee: 'Zachary Rilla' },
  { team: 'US Team', employee: 'Zhengrui He' },
  { team: 'Pak Team', employee: 'Mahnoor Khalid' },
  { team: 'Pak Team', employee: 'Fizza Iqbal' },
  { team: 'Pak Team', employee: 'Aiman Rehman' },
  { team: 'Pak Team', employee: 'Aamir Umer' },
  { team: 'Pak Team', employee: 'Jawwad Naseer' },
  { team: 'Pak Team', employee: 'Haniya Madni' },
  { team: 'Pak Team', employee: 'Rehan Siddiqui' },
  { team: 'Pak Team', employee: 'Muhammad Junaid' },
];

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

export function compareEmployeeName(a: string, b: string): number {
  return collator.compare(a, b);
}

export function compareTeamName(a: string, b: string): number {
  const ai = PRACTICE_ROSTER_TEAMS.indexOf(a as PracticeRosterTeam);
  const bi = PRACTICE_ROSTER_TEAMS.indexOf(b as PracticeRosterTeam);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return collator.compare(a, b);
}

export function isPracticeRosterTeam(team: string): team is PracticeRosterTeam {
  return (PRACTICE_ROSTER_TEAMS as readonly string[]).includes(team);
}

export function normalizeEmployeeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Team → sorted names — only rows stored in pa_employee_roster (exhaustive allow-list). */
export function buildEmployeeRoster(rosterRows: RosterRow[]): Record<string, string[]> {
  const byTeam = new Map<string, Set<string>>();

  for (const r of rosterRows) {
    const employee = normalizeEmployeeName(r.employee || '');
    const team = (r.team || '').trim();
    if (!employee || !team) continue;
    let set = byTeam.get(team);
    if (!set) {
      set = new Set();
      byTeam.set(team, set);
    }
    set.add(employee);
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

/** @deprecated Only used for analytics that need time-logged names outside the roster. */
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

/** @deprecated */
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
