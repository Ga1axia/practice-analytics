export type EmployeeTaskScope = 'assigned' | 'all';

const STORAGE_KEY = 'pa-emp-task-scope-v1';

function storageKey(employeeName: string): string {
  return employeeName.trim().toLowerCase();
}

function readMap(): Record<string, EmployeeTaskScope> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, EmployeeTaskScope> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'assigned' || v === 'all') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, EmployeeTaskScope>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Default: assigned-only until the member opts into full project visibility. */
export function readEmployeeTaskScope(employeeName: string): EmployeeTaskScope {
  const key = storageKey(employeeName);
  if (!key) return 'assigned';
  return readMap()[key] ?? 'assigned';
}

export function writeEmployeeTaskScope(employeeName: string, scope: EmployeeTaskScope) {
  const key = storageKey(employeeName);
  if (!key) return;
  const map = readMap();
  map[key] = scope;
  writeMap(map);
}

export function isTaskAssignedToEmployee(
  task: { assigneeName: string },
  employeeName: string,
): boolean {
  const emp = employeeName.trim().toLowerCase();
  if (!emp) return false;
  return task.assigneeName.trim().toLowerCase() === emp;
}

/** Project leads always see the full list; members respect their saved scope. */
export function applyEmployeeTaskScope<T extends { assigneeName: string }>(
  tasks: T[],
  employeeName: string,
  scope: EmployeeTaskScope,
  options?: { isLead?: boolean },
): T[] {
  if (options?.isLead) return tasks;
  if (scope === 'all') return tasks;
  return tasks.filter((t) => isTaskAssignedToEmployee(t, employeeName));
}
