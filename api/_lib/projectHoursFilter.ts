import type { SupabaseClient } from '@supabase/supabase-js';
import type { BqeTimeEntry } from './bqe.js';
import type { MappedProjects, ProjectInsert } from './bqeSyncBuild.js';
import { isPtoOrSickTimeEntry } from '../../src/lib/projectHoursMatch';

const CODE_RE = /\b(\d{2}-\d{3})\b/;

/** Sliding window used to decide “current” vs stale project membership. */
export const PROJECT_LIBRARY_HOURS_YEARS = 2;

export function extractJobCode(s: string | null | undefined): string | null {
  const m = String(s || '').match(CODE_RE);
  return m ? m[1]! : null;
}

/** Drop `22-004` tokens so CORE labels without codes still match library keys. */
export function stripJobCodes(s: string | null | undefined): string {
  return String(s || '')
    .replace(CODE_RE, ' ')
    .replace(/\s*[-–]\s*$/g, '')
    .replace(/^\s*[-–]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normName(s: string | null | undefined): string {
  return stripJobCodes(s).toLowerCase();
}

/** Parent / job title without phase suffix (`Name - Phase` → `Name`). */
export function parentLabelOf(s: string | null | undefined): string {
  const stripped = stripJobCodes(s);
  const cut = stripped.match(/^(.*)\s[-–]\s.+$/);
  return (cut ? cut[1]! : stripped).trim();
}

/** UTC calendar date N years ago (YYYY-MM-DD). */
export function hoursCutoffIso(years = PROJECT_LIBRARY_HOURS_YEARS): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export type RecentHoursIndex = {
  projectIds: Set<string>;
  codes: Set<string>;
  /** Normalized parent/job titles (no job codes) — CORE TEs often omit 22-004. */
  names: Set<string>;
  teRowsScanned: number;
};

export function emptyRecentHoursIndex(): RecentHoursIndex {
  return { projectIds: new Set(), codes: new Set(), names: new Set(), teRowsScanned: 0 };
}

function addTeToIndex(
  index: RecentHoursIndex,
  projectId: string | null | undefined,
  projectLabel: string | null | undefined,
  parentLabel?: string | null,
): void {
  if (projectId) index.projectIds.add(String(projectId));
  const c1 = extractJobCode(parentLabel);
  const c2 = extractJobCode(projectLabel);
  if (c1) index.codes.add(c1);
  if (c2) index.codes.add(c2);
  const n1 = normName(parentLabel);
  const n2 = normName(projectLabel);
  const p1 = parentLabelOf(parentLabel).toLowerCase();
  const p2 = parentLabelOf(projectLabel).toLowerCase();
  if (n1) index.names.add(n1);
  if (n2) index.names.add(n2);
  if (p1) index.names.add(p1);
  if (p2) index.names.add(p2);
}

export function mergeBqeTimeEntriesIntoHoursIndex(
  index: RecentHoursIndex,
  entries: BqeTimeEntry[],
  sinceIso: string,
): void {
  for (const te of entries) {
    const hours = Number(te.actualHours) || 0;
    if (hours <= 0) continue;
    if (
      isPtoOrSickTimeEntry({
        activity: te.activity,
        project_name: te.project,
        parent_project_name: te.project,
      })
    ) {
      continue;
    }
    const day = String(te.date || '').slice(0, 10);
    if (day && day < sinceIso) continue;
    addTeToIndex(index, te.projectId, te.project);
  }
}

/** Scan persisted time entries for hours on/after sinceIso. */
export async function loadRecentHoursIndexFromDb(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<RecentHoursIndex> {
  const index = emptyRecentHoursIndex();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_time_entries')
      .select(
        'project_id, project_name, parent_project_name, work_date, actual_hours, activity, phase, phase_name',
      )
      .gte('work_date', sinceIso)
      .range(from, from + 999);
    if (error) throw new Error(`TE hours index: ${error.message}`);
    if (!data?.length) break;
    index.teRowsScanned += data.length;
    for (const row of data) {
      const hours = Number((row as { actual_hours?: number }).actual_hours) || 0;
      if (hours <= 0) continue;
      if (isPtoOrSickTimeEntry(row)) continue;
      const pid = (row as { project_id?: string | null }).project_id;
      const parent = (row as { parent_project_name?: string }).parent_project_name;
      const name = (row as { project_name?: string }).project_name;
      addTeToIndex(index, pid, name, parent);
    }
    if (data.length < 1000) break;
  }
  return index;
}

/** Recent (≥ sinceIso) and older hours, from one TE scan. */
export async function loadHoursIndexesFromDb(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<{ recent: RecentHoursIndex; stale: RecentHoursIndex }> {
  const recent = emptyRecentHoursIndex();
  const stale = emptyRecentHoursIndex();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_time_entries')
      .select(
        'project_id, project_name, parent_project_name, work_date, actual_hours, activity, phase, phase_name',
      )
      .gt('actual_hours', 0)
      .range(from, from + 999);
    if (error) throw new Error(`TE hours index: ${error.message}`);
    if (!data?.length) break;
    recent.teRowsScanned += data.length;
    stale.teRowsScanned += data.length;
    for (const row of data) {
      const hours = Number((row as { actual_hours?: number }).actual_hours) || 0;
      if (hours <= 0) continue;
      if (isPtoOrSickTimeEntry(row)) continue;
      const day = String((row as { work_date?: string }).work_date || '').slice(0, 10);
      const pid = (row as { project_id?: string | null }).project_id;
      const parent = (row as { parent_project_name?: string }).parent_project_name;
      const name = (row as { project_name?: string }).project_name;
      const target = day && day >= sinceIso ? recent : stale;
      addTeToIndex(target, pid, name, parent);
    }
    if (data.length < 1000) break;
  }
  return { recent, stale };
}

export async function loadExistingProjectKeys(sb: SupabaseClient): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pa_projects').select('project').range(from, from + 999);
    if (error) throw new Error(`Load project library: ${error.message}`);
    if (!data?.length) break;
    for (const row of data) {
      const k = (row as { project?: string }).project;
      if (k) keys.add(k);
    }
    if (data.length < 1000) break;
  }
  return keys;
}

function walkToRoot(coreId: string, idToParentId: Map<string, string | null>): string {
  let cur = coreId;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cur)) return cur;
    seen.add(cur);
    const parent = idToParentId.get(cur);
    if (!parent) return cur;
    cur = parent;
  }
}

export function rootIdsWithRecentHours(
  mapped: MappedProjects,
  index: RecentHoursIndex,
): Set<string> {
  const keepRootIds = new Set<string>();
  if (!index.projectIds.size && !index.codes.size) return keepRootIds;

  for (const id of index.projectIds) {
    if (!mapped.idToKey.has(id)) continue;
    keepRootIds.add(walkToRoot(id, mapped.idToParentId));
  }

  for (const [coreId, key] of mapped.idToKey) {
    const parent = mapped.idToParentId.get(coreId);
    if (parent) continue;
    const code = extractJobCode(key);
    if (code && index.codes.has(code)) keepRootIds.add(coreId);
  }

  for (const [coreId, key] of mapped.idToKey) {
    const code = extractJobCode(key);
    if (!code || !index.codes.has(code)) continue;
    keepRootIds.add(walkToRoot(coreId, mapped.idToParentId));
  }

  return keepRootIds;
}

function isEligibleNewRoot(
  coreId: string,
  mapped: MappedProjects,
  hourRootIds: Set<string>,
  sinceIso: string,
  mode: 'initial' | 'additive',
): boolean {
  const created = mapped.idToCreatedOn?.get(coreId) || null;
  if (created) {
    if (created >= sinceIso) return true;
    // Older CORE job: initial library may still take it if it has recent hours.
    // After the library exists, never pull that older job in later.
    return mode === 'initial' && hourRootIds.has(coreId);
  }
  return hourRootIds.has(coreId);
}

export type LibrarySelectResult = {
  mapped: MappedProjects;
  mode: 'initial' | 'additive';
  beforeRoots: number;
  afterRoots: number;
  beforeRows: number;
  afterRows: number;
  addedRoots: number;
};

/**
 * Initial library: CORE trees with hours or createdOn in the window.
 * After that: keep existing keys; add only new trees (created in-window / new
 * phases under a library project). Older CORE jobs stay out forever.
 */
export function selectMappedProjectsForLibrary(
  mapped: MappedProjects,
  opts: {
    existingKeys: Set<string>;
    hoursIndex: RecentHoursIndex;
    sinceIso: string;
    /** When true (aggregates), also emit rows already in the library. */
    includeExistingLibraryRows?: boolean;
  },
): LibrarySelectResult {
  const beforeRoots = mapped.rows.filter((r) => r.row_kind === 'project').length;
  const beforeRows = mapped.rows.length;
  const mode: 'initial' | 'additive' = opts.existingKeys.size ? 'additive' : 'initial';
  const includeExisting = opts.includeExistingLibraryRows === true || mode === 'initial';
  const hourRootIds = rootIdsWithRecentHours(mapped, opts.hoursIndex);

  const eligibleNewRootIds = new Set<string>();
  for (const [coreId, parent] of mapped.idToParentId) {
    if (parent) continue;
    if (isEligibleNewRoot(coreId, mapped, hourRootIds, opts.sinceIso, mode)) {
      eligibleNewRootIds.add(coreId);
    }
  }

  const keyToId = new Map<string, string>();
  for (const [id, key] of mapped.idToKey) keyToId.set(key, id);

  const keepKeys = new Set<string>();
  const addedRootIds = new Set<string>();

  for (const row of mapped.rows) {
    if (opts.existingKeys.has(row.project)) {
      if (includeExisting) keepKeys.add(row.project);
      continue;
    }
    const coreId = keyToId.get(row.project);
    const root = coreId ? walkToRoot(coreId, mapped.idToParentId) : null;
    const rootKey = root ? mapped.idToKey.get(root) : row.parent_project;
    const underLibrary =
      mode === 'additive' &&
      !!(
        (rootKey && opts.existingKeys.has(rootKey)) ||
        (row.parent_project && opts.existingKeys.has(row.parent_project))
      );
    if (underLibrary) {
      keepKeys.add(row.project);
      continue;
    }
    if (root && eligibleNewRootIds.has(root)) {
      keepKeys.add(row.project);
      addedRootIds.add(root);
    }
  }

  const rows: ProjectInsert[] = mapped.rows.filter((r) => keepKeys.has(r.project));
  const afterRoots = rows.filter((r) => r.row_kind === 'project').length;

  return {
    mapped: { ...mapped, rows },
    mode,
    beforeRoots,
    afterRoots,
    beforeRows,
    afterRows: rows.length,
    addedRoots: addedRootIds.size,
  };
}

/**
 * Keep only project trees that logged hours in the recent window
 * (by CORE id and/or NN-NNN job code).
 */
export function filterMappedProjectsByRecentHours(
  mapped: MappedProjects,
  index: RecentHoursIndex,
): {
  mapped: MappedProjects;
  beforeRoots: number;
  afterRoots: number;
  beforeRows: number;
  afterRows: number;
} {
  const beforeRoots = mapped.rows.filter((r) => r.row_kind === 'project').length;
  const beforeRows = mapped.rows.length;
  const keepRootIds = rootIdsWithRecentHours(mapped, index);
  if (!keepRootIds.size) {
    return {
      mapped: { ...mapped, rows: [] },
      beforeRoots,
      afterRoots: 0,
      beforeRows,
      afterRows: 0,
    };
  }
  const keepKeys = new Set<string>();
  for (const [coreId, key] of mapped.idToKey) {
    const root = walkToRoot(coreId, mapped.idToParentId);
    if (keepRootIds.has(root)) keepKeys.add(key);
  }
  const rows: ProjectInsert[] = mapped.rows.filter((r) => keepKeys.has(r.project));
  return {
    mapped: { ...mapped, rows },
    beforeRoots,
    afterRoots: rows.filter((r) => r.row_kind === 'project').length,
    beforeRows,
    afterRows: rows.length,
  };
}

export type ProjectStatusRow = {
  project: string;
  row_kind: string | null;
  parent_project: string | null;
  status: string | null;
};

/** Keys whose project tree matched the hours index (code or parent walk). */
export function projectKeysMatchingHoursIndex(
  projects: ProjectStatusRow[],
  index: RecentHoursIndex,
): Set<string> {
  const keepKeys = new Set<string>();
  const headers = projects.filter((p) => p.row_kind === 'project');

  for (const h of headers) {
    const code = extractJobCode(h.project);
    if (code && index.codes.has(code)) keepKeys.add(h.project);
    const bare = normName(h.project);
    const parent = parentLabelOf(h.project).toLowerCase();
    if (bare && index.names.has(bare)) keepKeys.add(h.project);
    if (parent && index.names.has(parent)) keepKeys.add(h.project);
  }
  for (const p of projects) {
    if (p.row_kind === 'project') continue;
    const parent = p.parent_project;
    if (parent && keepKeys.has(parent)) keepKeys.add(p.project);
    else {
      const code = extractJobCode(p.project) || extractJobCode(p.parent_project);
      if (code && index.codes.has(code) && parent) {
        keepKeys.add(parent);
        keepKeys.add(p.project);
      }
    }
  }
  for (const p of projects) {
    if (p.parent_project && keepKeys.has(p.parent_project)) keepKeys.add(p.project);
  }
  return keepKeys;
}

const TERMINAL_STATUS = new Set(['COMPLETED', 'CANCELED', 'CANCELLED']);

export function planInactiveStatusUpdates(
  projects: ProjectStatusRow[],
  recent: RecentHoursIndex,
  _stale: RecentHoursIndex,
): { markInactive: string[]; restoreActive: string[] } {
  const recentKeys = projectKeysMatchingHoursIndex(projects, recent);
  const mark = new Set<string>();
  const restore = new Set<string>();

  for (const p of projects) {
    const status = String(p.status || '').toUpperCase();
    if (recentKeys.has(p.project)) {
      if (status === 'INACTIVE') restore.add(p.project);
      continue;
    }
    if (TERMINAL_STATUS.has(status)) continue;
    if (status !== 'INACTIVE') mark.add(p.project);
  }

  return { markInactive: [...mark], restoreActive: [...restore] };
}

async function loadProjectStatusRows(sb: SupabaseClient): Promise<ProjectStatusRow[]> {
  const projects: ProjectStatusRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_projects')
      .select('project, row_kind, parent_project, status')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    projects.push(...(data as ProjectStatusRow[]));
    if (data.length < 1000) break;
  }
  return projects;
}

async function chunkUpdateStatus(
  sb: SupabaseClient,
  keys: string[],
  status: string,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const { data, error } = await sb
      .from('pa_projects')
      .update({ status })
      .in('project', chunk)
      .select('project');
    if (error) throw new Error(error.message);
    n += data?.length ?? 0;
  }
  return n;
}

/** Mark library rows INACTIVE when they have no hours in the window (including never-logged). */
export async function markProjectsInactiveWithoutRecentHours(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<{
  markedInactive: number;
  restoredActive: number;
  keptHeaders: number;
  staleHeaders: number;
}> {
  const { recent, stale } = await loadHoursIndexesFromDb(sb, sinceIso);
  const projects = await loadProjectStatusRows(sb);
  const plan = planInactiveStatusUpdates(projects, recent, stale);
  const markedInactive = await chunkUpdateStatus(sb, plan.markInactive, 'INACTIVE');
  const restoredActive = await chunkUpdateStatus(sb, plan.restoreActive, 'ACTIVE');
  const recentKeys = projectKeysMatchingHoursIndex(projects, recent);
  const staleKeys = projectKeysMatchingHoursIndex(projects, stale);
  const headers = projects.filter((p) => p.row_kind === 'project');
  return {
    markedInactive,
    restoredActive,
    keptHeaders: headers.filter((h) => recentKeys.has(h.project)).length,
    staleHeaders: headers.filter((h) => staleKeys.has(h.project) && !recentKeys.has(h.project))
      .length,
  };
}

/** Delete dashboard project rows (and orphan schedules) with no recent hours. */
export async function pruneProjectsWithoutRecentHours(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<{ deletedProjects: number; deletedSchedules: number; keptHeaders: number }> {
  const index = await loadRecentHoursIndexFromDb(sb, sinceIso);

  const projects: { project: string; row_kind: string | null; parent_project: string | null }[] =
    [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('pa_projects')
      .select('project, row_kind, parent_project')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    projects.push(...(data as typeof projects));
    if (data.length < 1000) break;
  }

  const keepKeys = projectKeysMatchingHoursIndex(projects, index);
  const headers = projects.filter((p) => p.row_kind === 'project');

  const dropKeys = projects.map((p) => p.project).filter((k) => !keepKeys.has(k));
  let deletedProjects = 0;
  for (let i = 0; i < dropKeys.length; i += 200) {
    const chunk = dropKeys.slice(i, i + 200);
    const { data, error } = await sb.from('pa_projects').delete().in('project', chunk).select('project');
    if (error) throw new Error(error.message);
    deletedProjects += data?.length ?? 0;
  }

  const schedules: { id: string; project_key: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('pa_schedules').select('id, project_key').range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    schedules.push(...(data as typeof schedules));
    if (data.length < 1000) break;
  }
  const orphanIds = schedules.filter((s) => !keepKeys.has(s.project_key)).map((s) => s.id);
  let deletedSchedules = 0;
  for (let i = 0; i < orphanIds.length; i += 100) {
    const chunk = orphanIds.slice(i, i + 100);
    const { error: e1 } = await sb.from('pa_schedule_rows').delete().in('schedule_id', chunk);
    if (e1) throw new Error(e1.message);
    const { data, error } = await sb.from('pa_schedules').delete().in('id', chunk).select('id');
    if (error) throw new Error(error.message);
    deletedSchedules += data?.length ?? 0;
  }

  return {
    deletedProjects,
    deletedSchedules,
    keptHeaders: headers.filter((h) => keepKeys.has(h.project)).length,
  };
}
