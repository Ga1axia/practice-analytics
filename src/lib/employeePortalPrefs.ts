import { classifyWorkType } from './workType';
import type { ProjectNode } from './projectListHierarchy';

/** Admin-configured portal behavior (stored on pa_profiles.portal_prefs). */
export type EmployeePortalPrefsAdmin = {
  /** Show Interior vs all-projects toggle on My projects. */
  interiorProjectsOption?: boolean;
  /** Allow “Firm interior roster” — all firm jobs with an Interior Design phase. */
  firmWideInteriorRosterOption?: boolean;
  /** Default My projects list to jobs with an Interior Design phase. */
  defaultInteriorProjects?: boolean;
  /** Default My projects to firm-wide interior roster (requires firmWideInteriorRosterOption). */
  defaultFirmWideInteriorRoster?: boolean;
  /** Default project hours chart to Interior phase hours only. */
  defaultInteriorHours?: boolean;
};

export type ResolvedEmployeePortalPrefs = {
  interiorProjectsOption: boolean;
  firmWideInteriorRosterOption: boolean;
  defaultInteriorProjects: boolean;
  defaultFirmWideInteriorRoster: boolean;
  defaultInteriorHours: boolean;
};

const BUILTIN_DEFAULTS: Record<string, EmployeePortalPrefsAdmin> = {
  'arnita serri': {
    interiorProjectsOption: true,
    firmWideInteriorRosterOption: true,
    defaultInteriorProjects: true,
    defaultFirmWideInteriorRoster: true,
    defaultInteriorHours: true,
  },
};

const PROJECT_LIST_SCOPE_KEY = 'pa-emp-project-list-scope-v1';
const HOURS_PHASE_SCOPE_KEY = 'pa-emp-hours-phase-scope-v1';

export type InteriorScope = 'interior' | 'all' | 'firm_interior';

function normEmployee(name: string): string {
  return name.trim().toLowerCase();
}

export function parsePortalPrefsAdmin(raw: unknown): EmployeePortalPrefsAdmin {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    interiorProjectsOption: o.interiorProjectsOption === true,
    firmWideInteriorRosterOption: o.firmWideInteriorRosterOption === true,
    defaultInteriorProjects: o.defaultInteriorProjects === true,
    defaultFirmWideInteriorRoster: o.defaultFirmWideInteriorRoster === true,
    defaultInteriorHours: o.defaultInteriorHours === true,
  };
}

export function resolveEmployeePortalPrefs(input: {
  employeeName: string;
  profilePrefs?: unknown;
}): ResolvedEmployeePortalPrefs {
  const fromProfile = parsePortalPrefsAdmin(input.profilePrefs);
  const builtin = BUILTIN_DEFAULTS[normEmployee(input.employeeName)] || {};
  const merged = { ...builtin, ...fromProfile };
  return {
    interiorProjectsOption: merged.interiorProjectsOption === true,
    firmWideInteriorRosterOption: merged.firmWideInteriorRosterOption === true,
    defaultInteriorProjects: merged.defaultInteriorProjects === true,
    defaultFirmWideInteriorRoster: merged.defaultFirmWideInteriorRoster === true,
    defaultInteriorHours: merged.defaultInteriorHours === true,
  };
}

export function isInteriorDesignPhaseLabel(label: string | null | undefined): boolean {
  const t = (label || '').trim();
  if (!t) return false;
  if (/\binterior\b/i.test(t)) return true;
  if (/(?:^|[\s\-–—/(])id(?:$|[\s\-–—/)])/i.test(t)) return true;
  return false;
}

/** True when CORE lists an Interior Design phase (or the job is classified Interior). */
export function projectHasInteriorDesignPhase(project: ProjectNode): boolean {
  if (
    project.phases.some((ph) =>
      isInteriorDesignPhaseLabel(ph.label || ph.row.phase || ph.row.project),
    )
  ) {
    return true;
  }
  return classifyWorkType(project.title, project.row?.type ?? null) === 'Interior';
}

function readScope(key: string, employeeName: string): InteriorScope | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const v = parsed[normEmployee(employeeName)];
    return v === 'interior' || v === 'all' || v === 'firm_interior' ? v : null;
  } catch {
    return null;
  }
}

function writeScope(key: string, employeeName: string, scope: InteriorScope) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    parsed[normEmployee(employeeName)] = scope;
    localStorage.setItem(key, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function readProjectListScope(
  employeeName: string,
  prefs: ResolvedEmployeePortalPrefs,
): InteriorScope {
  const saved = readScope(PROJECT_LIST_SCOPE_KEY, employeeName);
  if (saved === 'firm_interior' && !prefs.firmWideInteriorRosterOption) {
    return prefs.defaultInteriorProjects ? 'interior' : 'all';
  }
  if (saved) return saved;
  if (prefs.defaultFirmWideInteriorRoster && prefs.firmWideInteriorRosterOption) {
    return 'firm_interior';
  }
  return prefs.defaultInteriorProjects ? 'interior' : 'all';
}

/** Phase labels for firm interior roster filters (any interior phase on the job). */
export function collectFirmInteriorPhaseOptions(
  projects: ProjectNode[],
): string[] {
  const set = new Set<string>();
  for (const p of projects) {
    for (const ph of p.phases) {
      const label = (ph.label || ph.row.phase || '').trim();
      if (label && isInteriorDesignPhaseLabel(label)) set.add(label);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function writeProjectListScope(employeeName: string, scope: InteriorScope) {
  writeScope(PROJECT_LIST_SCOPE_KEY, employeeName, scope);
}

export function readHoursPhaseScope(
  employeeName: string,
  prefs: ResolvedEmployeePortalPrefs,
): InteriorScope {
  const saved = readScope(HOURS_PHASE_SCOPE_KEY, employeeName);
  if (saved) return saved;
  return prefs.defaultInteriorHours ? 'interior' : 'all';
}

export function writeHoursPhaseScope(employeeName: string, scope: InteriorScope) {
  writeScope(HOURS_PHASE_SCOPE_KEY, employeeName, scope);
}

export function filterInteriorPhaseHours<T extends { label: string; hours: number }>(
  slices: T[],
): T[] {
  const interior = slices.filter((s) => isInteriorDesignPhaseLabel(s.label));
  return interior.length ? interior : slices;
}
