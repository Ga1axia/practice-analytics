export function managerNameMatches(
  manager: string | null | undefined,
  employeeName: string,
): boolean {
  if (!manager?.trim() || !employeeName.trim()) return false;
  return (
    manager.trim().toLocaleLowerCase() === employeeName.trim().toLocaleLowerCase()
  );
}

/** True when the employee is the Project List manager (header or any phase). */
export function isProjectListManager(
  project: {
    row?: { manager?: string | null } | null;
    phases?: { row: { manager?: string | null } }[];
  },
  employeeName: string,
): boolean {
  if (managerNameMatches(project.row?.manager, employeeName)) return true;
  return Boolean(
    project.phases?.some((ph) => managerNameMatches(ph.row.manager, employeeName)),
  );
}
