import { phaseDisplayName } from './phaseAbbrev';
import type { ProjectNode } from './projectListHierarchy';
import { ensureLeadMembership } from './projectMembers';
import { supabase } from './supabase';

export type CoreProjectPhase = {
  title: string;
  manager: string | null;
  sortOrder: number;
};

/** CORE / Project List phase labels for a project header key (sort_order). */
export async function loadCorePhaseTitles(projectKey: string): Promise<string[]> {
  const phases = await loadCorePhases(projectKey);
  return phases.map((p) => p.title);
}

export async function loadCorePhases(projectKey: string): Promise<CoreProjectPhase[]> {
  const key = projectKey.trim();
  if (!key) return [];

  const { data, error } = await supabase
    .from('pa_projects')
    .select('project, phase, parent_project, sort_order, manager')
    .eq('row_kind', 'phase')
    .eq('parent_project', key)
    .order('sort_order', { ascending: true });

  if (error || !data?.length) return [];

  return data
    .map((row, i) => ({
      title: phaseDisplayName(row.phase as string | null, row.project as string),
      manager: (row.manager as string | null)?.trim() || null,
      sortOrder: Number(row.sort_order ?? i),
    }))
    .filter((p) => p.title.trim());
}

export function corePhasesFromProject(project: Pick<ProjectNode, 'phases'>): CoreProjectPhase[] {
  return project.phases.map((ph, i) => ({
    title: ph.label,
    manager: ph.row.manager?.trim() || null,
    sortOrder: i,
  }));
}

export function corePhaseTitlesFromProject(project: Pick<ProjectNode, 'phases'>): string[] {
  return corePhasesFromProject(project).map((p) => p.title);
}

/** Promote CORE header + phase managers to project lead membership. */
export async function ensureCorePhaseLeads(input: {
  projectKey: string;
  headerManager?: string | null;
  phases: CoreProjectPhase[];
}): Promise<{ ensured: number; error?: string }> {
  const names = new Set<string>();
  const header = (input.headerManager || '').trim();
  if (header) names.add(header);
  for (const ph of input.phases) {
    const m = (ph.manager || '').trim();
    if (m) names.add(m);
  }
  let ensured = 0;
  for (const name of names) {
    const res = await ensureLeadMembership({
      projectKey: input.projectKey,
      employeeName: name,
    });
    if (!res.ok) return { ensured, error: res.error };
    if (res.data) ensured += 1;
  }
  return { ensured };
}
