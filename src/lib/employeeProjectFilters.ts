import type { ProjectNode } from './projectListHierarchy';
import type { ProjectMemberRole } from './projectMembers';

function employeeIsProjectLead(
  project: ProjectNode,
  employeeName: string,
  membership: ProjectMemberRole | null,
): boolean {
  if (membership === 'lead') return true;
  if (project.row?.manager === employeeName) return true;
  return Boolean(project.phases?.some((ph) => ph.row.manager === employeeName));
}

export type EmployeeProjectRoleFilter = 'all' | 'lead' | 'member';

export type EmployeeProjectFilters = {
  role: EmployeeProjectRoleFilter;
  phase: string;
  client: string;
};

export const EMP_PROJECT_FILTERS_STORAGE_PREFIX = 'pa-emp-project-filters-v1';

const DEFAULT_FILTERS: EmployeeProjectFilters = {
  role: 'all',
  phase: '',
  client: '',
};

export function projectFiltersStorageKey(employeeName: string): string {
  return `${EMP_PROJECT_FILTERS_STORAGE_PREFIX}:${employeeName.trim().toLowerCase()}`;
}

export function readEmployeeProjectFilters(employeeName: string): EmployeeProjectFilters {
  try {
    const raw = localStorage.getItem(projectFiltersStorageKey(employeeName));
    if (!raw) return { ...DEFAULT_FILTERS };
    const parsed = JSON.parse(raw) as Partial<EmployeeProjectFilters>;
    return {
      role:
        parsed.role === 'lead' || parsed.role === 'member' || parsed.role === 'all'
          ? parsed.role
          : 'all',
      phase: typeof parsed.phase === 'string' ? parsed.phase : '',
      client: typeof parsed.client === 'string' ? parsed.client : '',
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function writeEmployeeProjectFilters(
  employeeName: string,
  filters: EmployeeProjectFilters,
): void {
  try {
    localStorage.setItem(projectFiltersStorageKey(employeeName), JSON.stringify(filters));
  } catch {
    /* private mode */
  }
}

export function phasesManagedByEmployee(
  project: ProjectNode,
  employeeName: string,
): { row: ProjectNode['phases'][0]['row']; label: string }[] {
  return project.phases.filter((ph) => ph.row.manager === employeeName);
}

export function collectMyPhaseOptions(
  projects: (ProjectNode & { clientName?: string })[],
  employeeName: string,
): string[] {
  const set = new Set<string>();
  for (const p of projects) {
    for (const ph of phasesManagedByEmployee(p, employeeName)) {
      const label = (ph.label || ph.row.phase || '').trim();
      if (label) set.add(label);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function collectClientOptions(
  projects: (ProjectNode & { clientName?: string })[],
): string[] {
  const set = new Set<string>();
  for (const p of projects) {
    const c = (p.clientName || p.row?.client || '').trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function matchesEmployeeProjectFilters(
  project: ProjectNode & { clientName?: string },
  employeeName: string,
  memberRoles: Map<string, ProjectMemberRole>,
  filters: EmployeeProjectFilters,
): boolean {
  const membership = memberRoles.get(project.key) || null;
  const lead = employeeIsProjectLead(project, employeeName, membership);

  if (filters.role === 'lead' && !lead) return false;
  if (filters.role === 'member' && lead) return false;

  if (filters.client) {
    const client = (project.clientName || project.row?.client || '').trim();
    if (client !== filters.client) return false;
  }

  if (filters.phase) {
    const onPhase = phasesManagedByEmployee(project, employeeName).some(
      (ph) => ph.label === filters.phase,
    );
    if (!onPhase) return false;
  }

  return true;
}
