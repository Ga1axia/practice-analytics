import type { UserRole } from './authTypes';

/** Dashboard management (BQE connect/sync, project list writes). */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'admin';
}

/** Firm analytics (Executive / Main / Staffing). Includes admin. */
export function isExecRole(role: UserRole | null | undefined): boolean {
  return role === 'admin' || role === 'exec';
}

/** Employee workspace (hours, assigned projects). */
export function isEmployeePortalRole(role: UserRole | null | undefined): boolean {
  return role === 'employee' || role === 'project_lead';
}

export function roleLabel(role: UserRole | null | undefined): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'exec':
      return 'Executive';
    case 'project_lead':
      return 'Project lead';
    case 'employee':
      return 'Employee';
    case 'customer':
      return 'Client';
    default:
      return 'User';
  }
}
