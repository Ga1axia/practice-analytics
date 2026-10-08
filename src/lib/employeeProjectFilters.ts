import type { ProjectNode } from './projectListHierarchy';
import type { ProjectMemberRole } from './projectMembers';
import { managerNameMatches } from './projectManagerMatch';

function employeeIsProjectHeaderLead(
  project: ProjectNode,
  employeeName: string,
  membership: ProjectMemberRole | null,
): boolean {
  if (membership === 'lead') return true;
  return managerNameMatches(project.row?.manager, employeeName);
}

function employeeIsPhaseLead(project: ProjectNode, employeeName: string): boolean {
  return Boolean(
    project.phases?.some((ph) => managerNameMatches(ph.row.manager, employeeName)),
  );
}

export type EmployeeProjectRoleFilter = 'all' | 'project_lead' | 'phase_lead' | 'member';

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
    const storedRole = (parsed as { role?: string }).role;
    const roleRaw = storedRole === 'lead' ? 'project_lead' : storedRole;
    return {
      role:
        roleRaw === 'project_lead' ||
        roleRaw === 'phase_lead' ||
        roleRaw === 'member' ||
        roleRaw === 'all'
          ? roleRaw
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
  return project.phases.filter((ph) => managerNameMatches(ph.row.manager, employeeName));
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
  const projectLead = employeeIsProjectHeaderLead(project, employeeName, membership);
  const phaseLead = employeeIsPhaseLead(project, employeeName);
  const anyLead = projectLead || phaseLead;

  if (filters.role === 'project_lead' && !projectLead) return false;
  if (filters.role === 'phase_lead' && !phaseLead) return false;
  if (filters.role === 'member' && anyLead) return false;

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
