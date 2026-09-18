import { phaseDisplayName } from './phaseAbbrev';
import {
  extractProjectCode,
  isPtoOrSickTimeEntry,
  timeEntryMatchesProject,
  titleTokens,
  buildTimeEntryProjectIndex,
  projectKeysForTimeEntry,
} from './projectHoursMatch';
import { supabase } from './supabase';

export {
  extractProjectCode,
  isPtoOrSickTimeEntry,
  stripJobCodes,
  timeEntryMatchesProject,
  buildTimeEntryProjectIndex,
  projectKeysForTimeEntry,
} from './projectHoursMatch';
export type { ProjectMatchRef } from './projectHoursMatch';

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

const LAST_HOURS_YEARS = 2;
const LAST_HOURS_PAGE = 500;
const LAST_HOURS_MAX_ROWS = 8_000;

function hoursSinceIso(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * Latest CORE work_date per library project for this employee.
 * Newest-first over the last two years; stops once every assigned key is dated.
 */
export async function loadEmployeeLastHoursByProject(input: {
  employeeName: string;
  projects: { key: string; title: string; code?: string | null }[];
}): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  const emp = input.employeeName.trim();
  if (!emp || !input.projects.length) return byKey;

  const index = buildTimeEntryProjectIndex(input.projects);
  const wanted = new Set(input.projects.map((p) => p.key));
  const since = hoursSinceIso(LAST_HOURS_YEARS);
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('pa_time_entries')
      .select('project_name, parent_project_name, activity, phase, phase_name, work_date')
      .eq('employee_name', emp)
      .gte('work_date', since)
      .order('work_date', { ascending: false })
      .range(from, from + LAST_HOURS_PAGE - 1);
    if (error) return byKey;
    const chunk = data || [];
    for (const row of chunk) {
      if (isPtoOrSickTimeEntry(row)) continue;
      const workDate = String(row.work_date || '').slice(0, 10);
      if (!workDate) continue;
      for (const key of projectKeysForTimeEntry(row, index)) {
        if (!wanted.has(key) || byKey.has(key)) continue;
        byKey.set(key, workDate);
      }
    }
    if (byKey.size >= wanted.size) break;
    if (chunk.length < LAST_HOURS_PAGE) break;
    from += LAST_HOURS_PAGE;
    if (from >= LAST_HOURS_MAX_ROWS) break;
  }
  return byKey;
}

/** ASCII ilike token so PostgREST `.or()` isn't broken by `&` / commas. */
function teNamePrefilter(code: string, title: string): string | null {
  const parts: string[] = [];
  if (/^\d{2}-\d{3}$/.test(code)) {
    parts.push(`parent_project_name.ilike.%${code}%`, `project_name.ilike.%${code}%`);
  }
  const tok = titleTokens(title)[0] || '';
  if (/^[a-z0-9]{4,}$/i.test(tok)) {
    parts.push(`parent_project_name.ilike.%${tok}%`, `project_name.ilike.%${tok}%`);
  }
  return parts.length ? parts.join(',') : null;
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
  const prefilter = teNamePrefilter(code, input.projectTitle || input.projectFullName || '');

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
        'actual_hours,is_billable,project_name,parent_project_name,phase,phase_name,activity,work_date',
      )
      .eq('employee_name', emp)
      .order('work_date', { ascending: true })
      .range(from, from + pageSize - 1);

    if (prefilter) {
      q = q.or(prefilter);
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
      if (isPtoOrSickTimeEntry(r)) continue;
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
  const prefilter = teNamePrefilter(code, input.projectTitle || input.projectFullName || '');
  if (!prefilter) {
    return {
      ...empty,
      error:
        'Could not identify this project for time-entry matching (missing job code like 22-004).',
    };
  }

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
        'employee_name,actual_hours,is_billable,project_name,parent_project_name,phase,phase_name,activity,work_date',
      )
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    if (prefilter) {
      q = q.or(prefilter);
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
      if (isPtoOrSickTimeEntry(r)) continue;
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
