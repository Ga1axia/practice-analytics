import type { SupabaseClient } from '@supabase/supabase-js';
import type { BqeTimeEntry } from './bqe.js';
import type { MappedProjects, ProjectInsert } from './bqeSyncBuild.js';

const CODE_RE = /\b(\d{2}-\d{3})\b/;

export function extractJobCode(s: string | null | undefined): string | null {
  const m = String(s || '').match(CODE_RE);
  return m ? m[1]! : null;
}

/** UTC calendar date N years ago (YYYY-MM-DD). */
export function hoursCutoffIso(years = 3): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export type RecentHoursIndex = {
  projectIds: Set<string>;
  codes: Set<string>;
  teRowsScanned: number;
};

export function emptyRecentHoursIndex(): RecentHoursIndex {
  return { projectIds: new Set(), codes: new Set(), teRowsScanned: 0 };
}

export function mergeBqeTimeEntriesIntoHoursIndex(
  index: RecentHoursIndex,
  entries: BqeTimeEntry[],
  sinceIso: string,
): void {
  for (const te of entries) {
    const hours = Number(te.actualHours) || 0;
    if (hours <= 0) continue;
    const day = String(te.date || '').slice(0, 10);
    if (day && day < sinceIso) continue;
    if (te.projectId) index.projectIds.add(te.projectId);
    const c1 = extractJobCode(te.project);
    if (c1) index.codes.add(c1);
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
      .select('project_id, project_name, parent_project_name, work_date, actual_hours')
      .gte('work_date', sinceIso)
      .range(from, from + 999);
    if (error) throw new Error(`TE hours index: ${error.message}`);
    if (!data?.length) break;
    index.teRowsScanned += data.length;
    for (const row of data) {
      const hours = Number((row as { actual_hours?: number }).actual_hours) || 0;
      if (hours <= 0) continue;
      const pid = (row as { project_id?: string | null }).project_id;
      if (pid) index.projectIds.add(String(pid));
      const c1 = extractJobCode((row as { parent_project_name?: string }).parent_project_name);
      const c2 = extractJobCode((row as { project_name?: string }).project_name);
      if (c1) index.codes.add(c1);
      if (c2) index.codes.add(c2);
    }
    if (data.length < 1000) break;
  }
  return index;
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

  if (!index.projectIds.size && !index.codes.size) {
    return {
      mapped: {
        ...mapped,
        rows: [],
      },
      beforeRoots,
      afterRoots: 0,
      beforeRows,
      afterRows: 0,
    };
  }

  const keepRootIds = new Set<string>();

  for (const id of index.projectIds) {
    if (!mapped.idToKey.has(id)) continue;
    keepRootIds.add(walkToRoot(id, mapped.idToParentId));
  }

  for (const [coreId, key] of mapped.idToKey) {
    const parent = mapped.idToParentId.get(coreId);
    if (parent) continue; // only evaluate roots by code
    const code = extractJobCode(key);
    if (code && index.codes.has(code)) keepRootIds.add(coreId);
  }

  // Also: phase keys may carry the job code — promote their roots
  for (const [coreId, key] of mapped.idToKey) {
    const code = extractJobCode(key);
    if (!code || !index.codes.has(code)) continue;
    keepRootIds.add(walkToRoot(coreId, mapped.idToParentId));
  }

  const keepKeys = new Set<string>();
  for (const [coreId, key] of mapped.idToKey) {
    const root = walkToRoot(coreId, mapped.idToParentId);
    if (keepRootIds.has(root)) keepKeys.add(key);
  }

  const rows: ProjectInsert[] = mapped.rows.filter((r) => keepKeys.has(r.project));
  const afterRoots = rows.filter((r) => r.row_kind === 'project').length;

  return {
    mapped: { ...mapped, rows },
    beforeRoots,
    afterRoots,
    beforeRows,
    afterRows: rows.length,
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

  const keepKeys = new Set<string>();
  const headers = projects.filter((p) => p.row_kind === 'project');

  for (const h of headers) {
    const code = extractJobCode(h.project);
    if (code && index.codes.has(code)) keepKeys.add(h.project);
  }
  // Keep phases under kept headers
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

  // Second pass for phases after late header adds
  for (const p of projects) {
    if (p.parent_project && keepKeys.has(p.parent_project)) keepKeys.add(p.project);
  }

  const dropKeys = projects.map((p) => p.project).filter((k) => !keepKeys.has(k));
  let deletedProjects = 0;
  for (let i = 0; i < dropKeys.length; i += 200) {
    const chunk = dropKeys.slice(i, i + 200);
    const { data, error } = await sb.from('pa_projects').delete().in('project', chunk).select('project');
    if (error) throw new Error(error.message);
    deletedProjects += data?.length ?? 0;
  }

  // Orphan schedules for dropped / missing projects
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
