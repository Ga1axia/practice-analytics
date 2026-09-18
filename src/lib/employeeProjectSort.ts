export type EmployeeProjectSort = 'recent' | 'name';

export const PROJECT_SORT_STORAGE_PREFIX = 'pa-emp-project-sort-v1';

export function parseEmployeeProjectSort(raw: string | null | undefined): EmployeeProjectSort {
  return raw === 'name' ? 'name' : 'recent';
}

export function projectSortStorageKey(employeeName: string): string {
  return `${PROJECT_SORT_STORAGE_PREFIX}:${employeeName.trim().toLowerCase()}`;
}

export function readEmployeeProjectSort(employeeName: string): EmployeeProjectSort {
  try {
    return parseEmployeeProjectSort(localStorage.getItem(projectSortStorageKey(employeeName)));
  } catch {
    return 'recent';
  }
}

export function writeEmployeeProjectSort(employeeName: string, sort: EmployeeProjectSort): void {
  try {
    localStorage.setItem(projectSortStorageKey(employeeName), sort);
  } catch {
    /* private mode / quota */
  }
}

/** Newest logged hours first; jobs with no hours sink; title is the tiebreaker. */
export function compareProjectsByRecentHours(
  a: { key: string; title: string },
  b: { key: string; title: string },
  lastHoursByKey: Map<string, string>,
): number {
  const da = lastHoursByKey.get(a.key) || '';
  const db = lastHoursByKey.get(b.key) || '';
  if (da !== db) return db.localeCompare(da);
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

export function compareProjectsByName(
  a: { key: string; title: string },
  b: { key: string; title: string },
): number {
  const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  if (byTitle) return byTitle;
  return a.key.localeCompare(b.key, undefined, { sensitivity: 'base' });
}

export function compareEmployeeProjects(
  a: { key: string; title: string },
  b: { key: string; title: string },
  sort: EmployeeProjectSort,
  lastHoursByKey: Map<string, string>,
): number {
  if (sort === 'name') return compareProjectsByName(a, b);
  return compareProjectsByRecentHours(a, b, lastHoursByKey);
}
