import { supabase } from './supabase';
import type {
  EmployeeCapacityRow,
  PhaseAllocation,
  ProjectPhaseStaffing,
  ProjectStaffingProfile,
  TimeOffRow,
} from './staffingTypes';

function requirePositiveNumber(n: unknown, label: string): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) throw new Error(`${label} must be a non-negative number`);
  return v;
}

export async function upsertEmployeeCapacity(input: {
  id?: string;
  employeeName: string;
  employeeId?: string | null;
  weeklyCapacityHours: number;
  targetDeliveryHours?: number | null;
  active?: boolean;
  role?: string | null;
  discipline?: string | null;
  skills?: string[];
}): Promise<EmployeeCapacityRow> {
  const weekly = requirePositiveNumber(input.weeklyCapacityHours, 'Weekly capacity');
  const row = {
    employee_name: input.employeeName.trim(),
    employee_id: input.employeeId || null,
    weekly_capacity_hours: weekly,
    target_delivery_hours:
      input.targetDeliveryHours == null
        ? null
        : requirePositiveNumber(input.targetDeliveryHours, 'Target delivery hours'),
    active: input.active !== false,
    role: input.role || null,
    discipline: input.discipline || null,
    skills: input.skills || [],
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('pa_employee_capacity')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as EmployeeCapacityRow;
  }
  const { data, error } = await supabase
    .from('pa_employee_capacity')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data as EmployeeCapacityRow;
}

export async function upsertTimeOff(input: {
  id?: string;
  employeeName: string;
  employeeId?: string | null;
  offDate: string;
  hours: number;
  type: TimeOffRow['type'];
  notes?: string | null;
  userId?: string | null;
}): Promise<TimeOffRow> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.offDate)) throw new Error('offDate must be YYYY-MM-DD');
  const hours = requirePositiveNumber(input.hours, 'Time-off hours');
  const row = {
    employee_name: input.employeeName.trim(),
    employee_id: input.employeeId || null,
    off_date: input.offDate,
    hours,
    type: input.type,
    notes: input.notes || null,
    updated_by: input.userId || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('pa_employee_time_off')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as TimeOffRow;
  }
  const { data, error } = await supabase
    .from('pa_employee_time_off')
    .insert({ ...row, created_by: input.userId || null })
    .select('*')
    .single();
  if (error) throw error;
  return data as TimeOffRow;
}

export async function deleteTimeOff(id: string): Promise<void> {
  const { error } = await supabase.from('pa_employee_time_off').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertPhaseAllocation(input: {
  id?: string;
  employeeName: string;
  employeeId?: string | null;
  projectStaffingProfileId: string;
  projectPhaseStaffingId: string;
  weekStart: string;
  plannedHours: number;
  notes?: string | null;
  userId?: string | null;
}): Promise<PhaseAllocation> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)) {
    throw new Error('weekStart must be YYYY-MM-DD');
  }
  const hours = requirePositiveNumber(input.plannedHours, 'Planned hours');
  const row = {
    employee_name: input.employeeName.trim(),
    employee_id: input.employeeId || null,
    project_staffing_profile_id: input.projectStaffingProfileId,
    project_phase_staffing_id: input.projectPhaseStaffingId,
    week_start: input.weekStart,
    planned_hours: hours,
    notes: input.notes || null,
    updated_by: input.userId || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('pa_employee_phase_allocations')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as PhaseAllocation;
  }
  const { data, error } = await supabase
    .from('pa_employee_phase_allocations')
    .upsert(
      { ...row, created_by: input.userId || null },
      { onConflict: 'employee_name,project_phase_staffing_id,week_start' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data as PhaseAllocation;
}

export async function deletePhaseAllocation(id: string): Promise<void> {
  const { error } = await supabase.from('pa_employee_phase_allocations').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertProjectStaffingProfile(input: {
  id?: string;
  projectName: string;
  projectKey?: string | null;
  bqeProjectId?: string | null;
  client?: string | null;
  projectType?: string | null;
  projectStatus?: ProjectStaffingProfile['project_status'];
  projectManager?: string | null;
}): Promise<ProjectStaffingProfile> {
  const row = {
    project_name: input.projectName.trim(),
    project_key: input.projectKey || null,
    bqe_project_id: input.bqeProjectId || null,
    client: input.client || null,
    project_type: input.projectType || null,
    project_status: input.projectStatus || 'active',
    project_manager: input.projectManager || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('pa_project_staffing_profiles')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as ProjectStaffingProfile;
  }
  const { data, error } = await supabase
    .from('pa_project_staffing_profiles')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data as ProjectStaffingProfile;
}

export async function upsertProjectPhaseStaffing(input: {
  id?: string;
  projectStaffingProfileId: string;
  phaseName: string;
  phaseCode?: string | null;
  phaseKey?: string | null;
  bqePhaseId?: string | null;
  status?: ProjectPhaseStaffing['status'];
  targetCompletionDate?: string | null;
}): Promise<ProjectPhaseStaffing> {
  const row = {
    project_staffing_profile_id: input.projectStaffingProfileId,
    phase_name: input.phaseName.trim(),
    phase_code: input.phaseCode || null,
    phase_key: input.phaseKey || input.phaseName.trim(),
    bqe_phase_id: input.bqePhaseId || null,
    status: input.status || 'active',
    target_completion_date: input.targetCompletionDate || null,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('pa_project_phase_staffing')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as ProjectPhaseStaffing;
  }
  const { data, error } = await supabase
    .from('pa_project_phase_staffing')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  return data as ProjectPhaseStaffing;
}

/** Backfill staffing profiles from pa_projects project/phase rows. */
export async function backfillStaffingProfilesFromProjects(): Promise<{
  profiles: number;
  phases: number;
}> {
  const { data: projects, error } = await supabase
    .from('pa_projects')
    .select('project,client,manager,status,type,phase,row_kind,parent_project');
  if (error) throw error;

  const headers = (projects || []).filter((p) => p.row_kind === 'project');
  const phaseRows = (projects || []).filter((p) => p.row_kind !== 'project');

  let profiles = 0;
  let phases = 0;

  for (const h of headers) {
    const { data: existing } = await supabase
      .from('pa_project_staffing_profiles')
      .select('id')
      .eq('project_key', h.project)
      .maybeSingle();
    let profileId = existing?.id as string | undefined;
    if (!profileId) {
      const { data, error: insErr } = await supabase
        .from('pa_project_staffing_profiles')
        .insert({
          project_key: h.project,
          project_name: h.project,
          client: h.client,
          project_type: h.type,
          project_status:
            String(h.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'paused',
          project_manager: h.manager,
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      profileId = data.id;
      profiles += 1;
    }

    const children = phaseRows.filter((p) => p.parent_project === h.project);
    for (const ph of children) {
      const phaseName = (ph.phase || ph.project || 'Phase').trim();
      const { data: phExisting } = await supabase
        .from('pa_project_phase_staffing')
        .select('id')
        .eq('project_staffing_profile_id', profileId)
        .eq('phase_key', ph.project)
        .maybeSingle();
      if (phExisting) continue;
      const { error: phErr } = await supabase.from('pa_project_phase_staffing').insert({
        project_staffing_profile_id: profileId,
        phase_key: ph.project,
        phase_name: phaseName,
        phase_code: phaseName,
        status:
          String(ph.status || 'ACTIVE').toUpperCase() === 'ACTIVE' ? 'active' : 'paused',
      });
      if (phErr) throw phErr;
      phases += 1;
    }
  }

  return { profiles, phases };
}

export async function assignWeeklyAllocations(input: {
  employeeName: string;
  employeeId?: string | null;
  projectStaffingProfileId: string;
  projectPhaseStaffingId: string;
  weekStarts: string[];
  hoursPerWeek: number;
  userId?: string | null;
  notes?: string | null;
}): Promise<number> {
  const hours = requirePositiveNumber(input.hoursPerWeek, 'Hours per week');
  let n = 0;
  for (const weekStart of input.weekStarts) {
    await upsertPhaseAllocation({
      employeeName: input.employeeName,
      employeeId: input.employeeId,
      projectStaffingProfileId: input.projectStaffingProfileId,
      projectPhaseStaffingId: input.projectPhaseStaffingId,
      weekStart,
      plannedHours: hours,
      userId: input.userId,
      notes: input.notes || 'Assigned via Find a staffing match',
    });
    n += 1;
  }
  return n;
}
