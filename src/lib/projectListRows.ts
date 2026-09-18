import { phaseDisplayName } from './phaseAbbrev';
import { extractJobCode, hasValidJobCode, isProjectCodeRow } from './parseProjectList';
import { deterministicTextMatch } from './textSearch';
import type { ProjectRow } from './types';

export type PlistRowKind = 'project' | 'phase';

export type ProjectStatusFilter = 'ACTIVE' | 'INACTIVE' | 'COMPLETED' | 'ALL';

export type PlistHierarchyFilter = 'all' | 'project' | 'phase';

export type PlistTableRow = {
  id: string;
  kind: PlistRowKind;
  row: ProjectRow;
  client: string;
  title: string;
  code: string | null;
  phaseLabel: string | null;
  /** Local search: names, codes, client, manager. */
  localHaystack: string;
  /** Header search: all CORE fields on the row. */
  globalHaystack: string;
};

export function normalizeProjectStatus(raw: string | null | undefined): string {
  return String(raw || 'ACTIVE').toUpperCase();
}

export function isCompletedStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'COMPLETE' || status === 'DONE';
}

export function matchesProjectStatusFilter(
  row: ProjectRow,
  filter: ProjectStatusFilter,
): boolean {
  if (filter === 'ALL') return true;
  const s = normalizeProjectStatus(row.status);
  if (filter === 'ACTIVE') return s === 'ACTIVE';
  if (filter === 'INACTIVE') return s === 'INACTIVE';
  if (filter === 'COMPLETED') return isCompletedStatus(s);
  return true;
}

export function inferPlistRowKind(row: ProjectRow): PlistRowKind {
  if (row.row_kind === 'project') return 'project';
  if (row.row_kind === 'phase') return 'phase';
  return isProjectCodeRow(row.project) ? 'project' : 'phase';
}

function projectCode(name: string): string | null {
  return extractJobCode(name);
}

/**
 * Project List visibility: project headers need a job code; phases only show under a coded parent.
 */
export function isPlistJobCodedRow(row: ProjectRow): boolean {
  const kind = inferPlistRowKind(row);
  if (kind === 'project') return hasValidJobCode(row.project);
  const parent = (row.parent_project || '').trim();
  return !!parent && hasValidJobCode(parent);
}

function projectTitle(name: string): string {
  return name.replace(/\s*-\s*\d{2}-\d{3}\s*$/, '').trim() || name;
}

export function buildPlistTableRows(projects: ProjectRow[]): PlistTableRow[] {
  const sorted = projects.slice().sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    return (a.project || '').localeCompare(b.project || '', undefined, { sensitivity: 'base' });
  });

  const coded = sorted.filter(isPlistJobCodedRow);

  return coded.map((row) => {
    const kind = inferPlistRowKind(row);
    const client = (row.client || 'Unassigned').trim() || 'Unassigned';
    const code = projectCode(row.project);
    const title =
      kind === 'project' ? projectTitle(row.project) : projectTitle(row.parent_project || row.project);
    const phaseLabel =
      kind === 'phase' ? phaseDisplayName(row.phase, row.project) : null;

    const localParts = [
      row.project,
      title,
      code,
      client,
      row.manager,
      phaseLabel,
      row.phase,
    ];
    const globalParts = [
      ...localParts,
      row.status,
      row.type,
      row.city,
      row.parent_project,
      row.row_kind,
    ];

    return {
      id: `${kind}:${row.project}`,
      kind,
      row,
      client,
      title,
      code,
      phaseLabel,
      localHaystack: localParts.filter(Boolean).join(' '),
      globalHaystack: globalParts.filter(Boolean).join(' '),
    };
  });
}

export type PlistFilterInput = {
  status: ProjectStatusFilter;
  hierarchy: PlistHierarchyFilter;
  localSearch: string;
  globalSearch: string;
  manager: string;
  selectedIds: Set<string>;
  selectionOnly: boolean;
};

export function filterPlistRows(rows: PlistTableRow[], input: PlistFilterInput): PlistTableRow[] {
  return rows.filter((entry) => {
    if (!matchesProjectStatusFilter(entry.row, input.status)) return false;

    if (input.hierarchy === 'project' && entry.kind !== 'project') return false;
    if (input.hierarchy === 'phase' && entry.kind !== 'phase') return false;

    if (input.manager && entry.row.manager !== input.manager) return false;

    if (!deterministicTextMatch(entry.localHaystack, input.localSearch)) return false;
    if (!deterministicTextMatch(entry.globalHaystack, input.globalSearch)) return false;

    if (input.selectionOnly && input.selectedIds.size > 0 && !input.selectedIds.has(entry.id)) {
      return false;
    }

    return true;
  });
}

/** Rows after status + hierarchy only (for “X of Y” denominator). */
export function plistScopeRows(
  rows: PlistTableRow[],
  status: ProjectStatusFilter,
  hierarchy: PlistHierarchyFilter,
): PlistTableRow[] {
  return rows.filter((entry) => {
    if (!matchesProjectStatusFilter(entry.row, status)) return false;
    if (hierarchy === 'project' && entry.kind !== 'project') return false;
    if (hierarchy === 'phase' && entry.kind !== 'phase') return false;
    return true;
  });
}
