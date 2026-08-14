import { extractProjectCode, loadProjectHoursBreakdown } from './projectLoggedHours';
import { supabase } from './supabase';

export type ProjectMemberRole = 'lead' | 'member';

export type ProjectMember = {
  id: string;
  project_key: string;
  employee_name: string;
  role: ProjectMemberRole;
};

export type MutationResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

function norm(name: string) {
  return name.trim().toLowerCase();
}

/** True when the employee is the Project List manager (header or any phase). */
export function isProjectListManager(
  project: {
    row?: { manager?: string | null } | null;
    phases?: { row: { manager?: string | null } }[];
  },
  employeeName: string,
): boolean {
  if (project.row?.manager === employeeName) return true;
  return Boolean(project.phases?.some((ph) => ph.row.manager === employeeName));
}

export function isProjectLead(
  project: {
    row?: { manager?: string | null } | null;
    phases?: { row: { manager?: string | null } }[];
  },
  employeeName: string,
  membershipRole?: ProjectMemberRole | null,
): boolean {
  if (membershipRole === 'lead') return true;
  return isProjectListManager(project, employeeName);
}

export async function loadMembershipsForEmployee(
  employeeName: string,
): Promise<{ byKey: Map<string, ProjectMemberRole>; error?: string }> {
  const name = employeeName.trim();
  if (!name) return { byKey: new Map() };

  const { data, error } = await supabase
    .from('pa_project_members')
    .select('project_key, role, employee_name')
    .ilike('employee_name', name);

  if (error) return { byKey: new Map(), error: error.message };

  const byKey = new Map<string, ProjectMemberRole>();
  for (const row of data || []) {
    if (norm(row.employee_name) !== norm(name)) continue;
    const role = row.role === 'lead' ? 'lead' : 'member';
    byKey.set(row.project_key, role);
  }
  return { byKey };
}

export async function loadProjectMembers(
  projectKey: string,
): Promise<{ members: ProjectMember[]; error?: string }> {
  const { data, error } = await supabase
    .from('pa_project_members')
    .select('id, project_key, employee_name, role')
    .eq('project_key', projectKey)
    .order('employee_name', { ascending: true });

  if (error) return { members: [], error: error.message };
  const members = (data || []).map((r) => ({
    id: r.id as string,
    project_key: r.project_key as string,
    employee_name: r.employee_name as string,
    role: (r.role === 'lead' ? 'lead' : 'member') as ProjectMemberRole,
  }));
  return { members };
}

/** Ensure the Project List manager appears as a lead in membership. */
export async function ensureLeadMembership(input: {
  projectKey: string;
  employeeName: string;
}): Promise<MutationResult<ProjectMember | null>> {
  const employeeName = input.employeeName.trim();
  if (!employeeName) return { ok: true, data: null };

  const existing = await loadProjectMembers(input.projectKey);
  if (existing.error) return { ok: false, error: existing.error };
  const hit = existing.members.find((m) => norm(m.employee_name) === norm(employeeName));
  if (hit) {
    if (hit.role === 'lead') return { ok: true, data: hit };
    const { data, error } = await supabase
      .from('pa_project_members')
      .update({ role: 'lead' })
      .eq('id', hit.id)
      .select('id, project_key, employee_name, role')
      .single();
    if (error || !data) return { ok: false, error: error?.message || 'Could not update lead' };
    return {
      ok: true,
      data: {
        id: data.id,
        project_key: data.project_key,
        employee_name: data.employee_name,
        role: 'lead',
      },
    };
  }

  const { data, error } = await supabase
    .from('pa_project_members')
    .insert({
      project_key: input.projectKey,
      employee_name: employeeName,
      role: 'lead',
    })
    .select('id, project_key, employee_name, role')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Could not add lead' };
  return {
    ok: true,
    data: {
      id: data.id,
      project_key: data.project_key,
      employee_name: data.employee_name,
      role: 'lead',
    },
  };
}

export async function addProjectMember(input: {
  projectKey: string;
  employeeName: string;
  role?: ProjectMemberRole;
}): Promise<MutationResult<ProjectMember>> {
  const employeeName = input.employeeName.trim();
  if (!employeeName) return { ok: false, error: 'Pick a team member' };
  const role = input.role || 'member';

  const { data, error } = await supabase
    .from('pa_project_members')
    .upsert(
      {
        project_key: input.projectKey,
        employee_name: employeeName,
        role,
      },
      { onConflict: 'project_key,employee_name' },
    )
    .select('id, project_key, employee_name, role')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Could not add member' };
  return {
    ok: true,
    data: {
      id: data.id,
      project_key: data.project_key,
      employee_name: data.employee_name,
      role: data.role === 'lead' ? 'lead' : 'member',
    },
  };
}

export async function removeProjectMember(input: {
  projectKey: string;
  memberId: string;
}): Promise<MutationResult> {
  const { error } = await supabase
    .from('pa_project_members')
    .delete()
    .eq('id', input.memberId)
    .eq('project_key', input.projectKey);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/** Flatten roster + managers into a sorted unique name list. */
export function staffNameOptions(input: {
  managers?: string[];
  employeeRoster?: Record<string, string[]>;
  extras?: string[];
}): string[] {
  const set = new Set<string>();
  for (const n of input.managers || []) {
    if (n?.trim()) set.add(n.trim());
  }
  for (const names of Object.values(input.employeeRoster || {})) {
    for (const n of names) {
      if (n?.trim()) set.add(n.trim());
    }
  }
  for (const n of input.extras || []) {
    if (n?.trim()) set.add(n.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Add everyone with logged hours on this project as members.
 * Does not demote existing leads. Optionally ensures listed leads.
 */
export async function syncProjectMembersFromTimeEntries(input: {
  projectKey: string;
  projectTitle: string;
  projectFullName?: string | null;
  projectCode?: string | null;
  /** Project List managers to keep/promote as leads. */
  leadNames?: string[];
}): Promise<{ added: number; ensuredLeads: number; error?: string }> {
  const breakdown = await loadProjectHoursBreakdown({
    projectTitle: input.projectTitle,
    projectFullName: input.projectFullName || input.projectKey,
    projectCode: input.projectCode || extractProjectCode(input.projectKey),
  });
  if (breakdown.error && !breakdown.people.length) {
    return { added: 0, ensuredLeads: 0, error: breakdown.error };
  }

  const existing = await loadProjectMembers(input.projectKey);
  if (existing.error) return { added: 0, ensuredLeads: 0, error: existing.error };
  const have = new Set(existing.members.map((m) => norm(m.employee_name)));

  let ensuredLeads = 0;
  for (const lead of input.leadNames || []) {
    const name = lead.trim();
    if (!name) continue;
    const res = await ensureLeadMembership({
      projectKey: input.projectKey,
      employeeName: name,
    });
    if (res.ok && res.data) {
      ensuredLeads += 1;
      have.add(norm(name));
    }
  }

  let added = 0;
  for (const person of breakdown.people) {
    const name = person.name.trim();
    if (!name || name === 'Unknown') continue;
    if (have.has(norm(name))) continue;
    const res = await addProjectMember({
      projectKey: input.projectKey,
      employeeName: name,
      role: 'member',
    });
    if (!res.ok) continue;
    have.add(norm(name));
    added += 1;
  }

  return { added, ensuredLeads, error: breakdown.error || undefined };
}

/**
 * Ensure the signed-in employee is a member of every Project List project
 * they have time entries for (so the portal shows those jobs).
 */
export async function ensureMyMembershipsFromTimeEntries(input: {
  employeeName: string;
  projects: { key: string; title: string; code?: string | null }[];
}): Promise<{ added: number; error?: string }> {
  const emp = input.employeeName.trim();
  if (!emp || !input.projects.length) return { added: 0 };

  const byCode = new Map<string, string>();
  for (const p of input.projects) {
    const code = (p.code || extractProjectCode(p.key) || '').trim();
    if (/^\d{2}-\d{3}$/.test(code)) byCode.set(code, p.key);
  }
  if (!byCode.size) return { added: 0 };

  const memberships = await loadMembershipsForEmployee(emp);
  if (memberships.error) return { added: 0, error: memberships.error };

  const codesWithHours = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('pa_time_entries')
      .select('project_name, parent_project_name')
      .eq('employee_name', emp)
      .range(from, from + pageSize - 1);
    if (error) return { added: 0, error: error.message };
    const chunk = data || [];
    for (const row of chunk) {
      const blob = `${row.parent_project_name || ''} ${row.project_name || ''}`;
      const m = blob.match(/\b(\d{2}-\d{3})\b/);
      if (m) codesWithHours.add(m[1]!);
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 80_000) break;
  }

  let added = 0;
  for (const code of codesWithHours) {
    const projectKey = byCode.get(code);
    if (!projectKey || memberships.byKey.has(projectKey)) continue;
    const res = await addProjectMember({
      projectKey,
      employeeName: emp,
      role: 'member',
    });
    if (res.ok) {
      memberships.byKey.set(projectKey, 'member');
      added += 1;
    }
  }
  return { added };
}
