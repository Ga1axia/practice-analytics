export type EmployeeProjectSort =
  | 'recent'
  | 'name'
  | 'client'
  | 'lead_first'
  | 'contract';

export const PROJECT_SORT_STORAGE_PREFIX = 'pa-emp-project-sort-v1';

const SORT_VALUES: EmployeeProjectSort[] = [
  'recent',
  'name',
  'client',
  'lead_first',
  'contract',
];

export function parseEmployeeProjectSort(raw: string | null | undefined): EmployeeProjectSort {
  if (raw && (SORT_VALUES as string[]).includes(raw)) return raw as EmployeeProjectSort;
  return 'recent';
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

export type EmployeeProjectSortRow = {
  key: string;
  title: string;
  clientName?: string;
  contract?: number;
};

export function compareEmployeeProjects(
  a: EmployeeProjectSortRow,
  b: EmployeeProjectSortRow,
  sort: EmployeeProjectSort,
  lastHoursByKey: Map<string, string>,
  isLead?: (key: string) => boolean,
): number {
  if (sort === 'lead_first' && isLead) {
    const la = isLead(a.key) ? 1 : 0;
    const lb = isLead(b.key) ? 1 : 0;
    if (la !== lb) return lb - la;
    return compareProjectsByRecentHours(a, b, lastHoursByKey);
  }
  if (sort === 'name') return compareProjectsByName(a, b);
  if (sort === 'client') {
    const ca = (a.clientName || '').localeCompare(b.clientName || '', undefined, {
      sensitivity: 'base',
    });
    if (ca !== 0) return ca;
    return compareProjectsByName(a, b);
  }
  if (sort === 'contract') {
    const diff = (b.contract || 0) - (a.contract || 0);
    if (diff !== 0) return diff;
    return compareProjectsByName(a, b);
  }
  return compareProjectsByRecentHours(a, b, lastHoursByKey);
}
