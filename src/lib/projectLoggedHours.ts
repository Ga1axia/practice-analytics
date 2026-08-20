import { phaseDisplayName } from './phaseAbbrev';
import { supabase } from './supabase';

export type ProjectHoursSlice = {
  label: string;
  hours: number;
  billableHours: number;
};

export type ProjectLoggedHours = {
  yourHours: number;
  yourBillable: number;
  entries: number;
  byPhase: ProjectHoursSlice[];
  error: string | null;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function titleTokens(title: string): string[] {
  return norm(title)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !/^\d{2}-\d{3}$/.test(t));
}

/** Extract `22-004`-style job code from a project label. */
export function extractProjectCode(name: string | null | undefined): string | null {
  const m = (name || '').match(/\b(\d{2}-\d{3})\b/);
  return m ? m[1] : null;
}

/** True when a TE project label belongs to this Project List project. */
export function timeEntryMatchesProject(
  row: { project_name?: string | null; parent_project_name?: string | null },
  opts: { fullName?: string | null; title?: string | null; code?: string | null },
): boolean {
  const parent = norm(row.parent_project_name || '');
  const project = norm(row.project_name || '');
  const blob = `${parent} ${project}`;
  if (!blob.trim()) return false;

  // Firm job codes are unique in BQE — prefer this over fuzzy title matching.
  const code = norm(opts.code || extractProjectCode(opts.fullName) || extractProjectCode(opts.title) || '');
  if (code && /^\d{2}-\d{3}$/.test(code) && blob.includes(code)) {
    return true;
  }

  const full = norm(opts.fullName || '');
  if (full.length >= 5 && (parent.includes(full) || project.includes(full) || blob.includes(full))) {
    return true;
  }

  const title = norm(opts.title || '');
  if (title.length >= 5 && (parent.includes(title) || project.includes(title) || blob.includes(title))) {
    return true;
  }

  // Last resort: overlap of significant title tokens (no code available).
  const tokens = titleTokens(opts.title || opts.fullName || '');
  if (tokens.length >= 2 && tokens.filter((t) => blob.includes(t)).length >= 2) {
    return true;
  }

  return false;
}

/**
 * Sum the signed-in employee's time entries that match this project.
 * Filters in JS so names with commas / & (e.g. "Cohen, Amir & Lital") don't break PostgREST `.or()`.
 * RLS already limits rows to the employee's own name.
 */
export async function loadProjectLoggedHours(input: {
  employeeName: string;
  projectTitle: string;
  projectFullName?: string | null;
  projectCode?: string | null;
  clientName?: string | null;
}): Promise<ProjectLoggedHours> {
  const empty: ProjectLoggedHours = {
    yourHours: 0,
    yourBillable: 0,
    entries: 0,
    byPhase: [],
    error: null,
  };

  const emp = input.employeeName.trim();
  if (!emp) return { ...empty, error: 'No employee name on profile' };

  const matchOpts = {
    fullName: input.projectFullName,
    title: input.projectTitle,
    code: input.projectCode,
  };

  const code = (
    input.projectCode ||
    extractProjectCode(input.projectFullName) ||
    extractProjectCode(input.projectTitle) ||
    ''
  ).trim();
  const codeOk = /^\d{2}-\d{3}$/.test(code);

  let yourHours = 0;
  let yourBillable = 0;
  let entries = 0;
  const phaseMap = new Map<string, { hours: number; billable: number }>();

  let from = 0;
  const pageSize = 1000;
  for (;;) {
    let q = supabase
      .from('pa_time_entries')
      .select(
        'actual_hours,is_billable,project_name,parent_project_name,phase,phase_name,work_date',
      )
      .eq('employee_name', emp)
      .order('work_date', { ascending: true })
      .range(from, from + pageSize - 1);

    if (codeOk) {
      // ASCII-only DB prefilter — final match is client-side
      q = q.or(`parent_project_name.ilike.%${code}%,project_name.ilike.%${code}%`);
    }

    const { data, error } = await q;
    if (error) {
      return {
        ...empty,
        error: error.message || 'Could not load project hours',
      };
    }
    const chunk = data || [];
    for (const r of chunk) {
      if (!timeEntryMatchesProject(r, matchOpts)) continue;
      const hrs = Number(r.actual_hours) || 0;
      yourHours += hrs;
      if (r.is_billable) yourBillable += hrs;
      entries += 1;
      const phase = phaseDisplayName(
        (r.phase_name as string) || (r.phase as string),
        (r.project_name as string) || null,
      );
      const cur = phaseMap.get(phase) || { hours: 0, billable: 0 };
      cur.hours += hrs;
      if (r.is_billable) cur.billable += hrs;
      phaseMap.set(phase, cur);
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 50_000) break;
  }

  const byPhase = [...phaseMap.entries()]
    .map(([label, v]) => ({
      label,
      hours: v.hours,
      billableHours: v.billable,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 6);

  return { yourHours, yourBillable, entries, byPhase, error: null };
}

export type ProjectHoursPerson = {
  name: string;
  hours: number;
  billableHours: number;
  /** Hours keyed by phase display label */
  byPhase: Record<string, number>;
};

export type ProjectHoursBreakdown = {
  totalHours: number;
  billableHours: number;
  entries: number;
  people: ProjectHoursPerson[];
  phases: ProjectHoursSlice[];
  /** Phase labels ordered by firm hours (for stacked chart columns). */
  phaseOrder: string[];
  error: string | null;
};

/**
 * Firm-wide hours on a project from `pa_time_entries` (admin RLS).
 * Broken down by person and phase for the project dashboard.
 */
export async function loadProjectHoursBreakdown(input: {
  projectTitle: string;
  projectFullName?: string | null;
  projectCode?: string | null;
}): Promise<ProjectHoursBreakdown> {
  const empty: ProjectHoursBreakdown = {
    totalHours: 0,
    billableHours: 0,
    entries: 0,
    people: [],
    phases: [],
    phaseOrder: [],
    error: null,
  };

  const matchOpts = {
    fullName: input.projectFullName,
    title: input.projectTitle,
    code: input.projectCode,
  };

  const code = (
    input.projectCode ||
    extractProjectCode(input.projectFullName) ||
    extractProjectCode(input.projectTitle) ||
    ''
  ).trim();
  const codeOk = /^\d{2}-\d{3}$/.test(code);
  const titleToks = titleTokens(input.projectTitle || input.projectFullName || '').filter((t) =>
    /^[a-z0-9]+$/i.test(t),
  );
  const titleTok = titleToks[0] || '';

  let totalHours = 0;
  let billableHours = 0;
  let entries = 0;
  const personMap = new Map<string, { hours: number; billable: number; byPhase: Map<string, number> }>();
  const phaseMap = new Map<string, { hours: number; billable: number }>();

  let from = 0;
  const pageSize = 1000;
  for (;;) {
    let q = supabase
      .from('pa_time_entries')
      .select(
        'employee_name,actual_hours,is_billable,project_name,parent_project_name,phase,phase_name,work_date',
      )
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (codeOk) {
      // ASCII job code only — final match is client-side (avoids &/, in names).
      q = q.or(`parent_project_name.ilike.%${code}%,project_name.ilike.%${code}%`);
    } else if (titleTok.length >= 4) {
      q = q.or(
        `parent_project_name.ilike.%${titleTok}%,project_name.ilike.%${titleTok}%`,
      );
    } else {
      return {
        ...empty,
        error:
          'Could not identify this project for time-entry matching (missing job code like 22-004).',
      };
    }

    const { data, error } = await q;
    if (error) {
      return {
        ...empty,
        error: error.message || 'Could not load project hours',
      };
    }
    const chunk = data || [];
    for (const r of chunk) {
      if (!timeEntryMatchesProject(r, matchOpts)) continue;
      const hrs = Number(r.actual_hours) || 0;
      if (!hrs) continue;
      const name = String(r.employee_name || 'Unknown').trim() || 'Unknown';
      const phase = phaseDisplayName(
        (r.phase_name as string) || (r.phase as string),
        (r.project_name as string) || null,
      );

      totalHours += hrs;
      if (r.is_billable) billableHours += hrs;
      entries += 1;

      let person = personMap.get(name);
      if (!person) {
        person = { hours: 0, billable: 0, byPhase: new Map() };
        personMap.set(name, person);
      }
      person.hours += hrs;
      if (r.is_billable) person.billable += hrs;
      person.byPhase.set(phase, (person.byPhase.get(phase) || 0) + hrs);

      const ph = phaseMap.get(phase) || { hours: 0, billable: 0 };
      ph.hours += hrs;
      if (r.is_billable) ph.billable += hrs;
      phaseMap.set(phase, ph);
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
    if (from > 80_000) break;
  }

  const phases = [...phaseMap.entries()]
    .map(([label, v]) => ({
      label,
      hours: v.hours,
      billableHours: v.billable,
    }))
    .sort((a, b) => b.hours - a.hours);

  const phaseOrder = phases.map((p) => p.label);

  const people = [...personMap.entries()]
    .map(([name, v]) => ({
      name,
      hours: v.hours,
      billableHours: v.billable,
      byPhase: Object.fromEntries(v.byPhase),
    }))
    .sort((a, b) => b.hours - a.hours);

  return {
    totalHours,
    billableHours,
    entries,
    people,
    phases,
    phaseOrder,
    error: null,
  };
}
