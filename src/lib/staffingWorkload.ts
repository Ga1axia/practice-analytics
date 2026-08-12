import {
  activityBucket,
  daysAgoYmd,
  isDeliveryHours,
  weekStarts,
  ymd,
  addDays,
} from './staffingDelivery';
import { aggregateStaffingBoard } from './staffingAggregate';
import { supabase } from './supabase';
import type {
  EmployeeCapacityRow,
  EmployeeWorkloadDetail,
  PhaseAllocation,
  ProjectPhaseStaffing,
  ProjectStaffingProfile,
  StaffingBoardFilters,
  StaffingBoardResult,
  TimeEntryLite,
  TimeOffRow,
} from './staffingTypes';

export { aggregateStaffingBoard, buildWeekSlice } from './staffingAggregate';

const DEFAULT_CAPACITY = 32;

async function fetchPaged<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function parseSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function loadStaffingBoard(
  filters: StaffingBoardFilters,
): Promise<StaffingBoardResult> {
  const now = new Date();
  const trailStart = daysAgoYmd(Math.max(filters.trailingDays, 30), now);
  const trailEnd = ymd(addDays(now, 1));
  const weeks = weekStarts(now, filters.horizonWeeks);
  const lastWeekEnd = ymd(addDays(new Date(weeks[weeks.length - 1]! + 'T00:00:00Z'), 6));

  const teSelect =
    'id,bqe_time_entry_id,employee_id,employee_name,project_id,project_name,parent_project_name,phase,phase_name,client,activity_id,activity,work_date,actual_hours,is_billable,is_written_off,is_extra,description,memo';

  // Probe count first so RLS / missing-table failures surface clearly.
  const probe = await supabase
    .from('pa_time_entries')
    .select('id', { count: 'exact', head: true })
    .gte('work_date', trailStart)
    .lte('work_date', trailEnd);
  if (probe.error) {
    throw new Error(
      probe.error.message ||
        'Cannot read pa_time_entries. Confirm staffing migration and admin role.',
    );
  }

  const [
    capacitiesRaw,
    roster,
    entries,
    allocations,
    timeOff,
    profiles,
    phases,
    syncRun,
  ] = await Promise.all([
    fetchPaged<EmployeeCapacityRow>((from, to) =>
      supabase.from('pa_employee_capacity').select('*').range(from, to),
    ),
    fetchPaged<{ employee: string; team: string }>((from, to) =>
      supabase.from('pa_employee_roster').select('employee,team').range(from, to),
    ),
    fetchPaged<TimeEntryLite>((from, to) =>
      supabase
        .from('pa_time_entries')
        .select(teSelect)
        .gte('work_date', trailStart)
        .lte('work_date', trailEnd)
        .order('work_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchPaged<PhaseAllocation>((from, to) =>
      supabase
        .from('pa_employee_phase_allocations')
        .select('*')
        .gte('week_start', weeks[0]!)
        .lte('week_start', weeks[weeks.length - 1]!)
        .range(from, to),
    ),
    fetchPaged<TimeOffRow>((from, to) =>
      supabase
        .from('pa_employee_time_off')
        .select('*')
        .gte('off_date', weeks[0]!)
        .lte('off_date', lastWeekEnd)
        .range(from, to),
    ),
    fetchPaged<ProjectStaffingProfile>((from, to) =>
      supabase.from('pa_project_staffing_profiles').select('*').range(from, to),
    ),
    fetchPaged<ProjectPhaseStaffing>((from, to) =>
      supabase.from('pa_project_phase_staffing').select('*').range(from, to),
    ),
    supabase
      .from('pa_bqe_sync_runs')
      .select('completed_at')
      .in('sync_type', ['historical', 'incremental'])
      .in('status', ['succeeded', 'partial'])
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const board = aggregateStaffingBoard({
    capacities: capacitiesRaw.map((c) => ({
      ...c,
      skills: parseSkills((c as EmployeeCapacityRow).skills),
    })),
    rosterNames: roster.map((r) => r.employee),
    entries,
    allocations,
    timeOff,
    profiles,
    phases,
    filters,
    now,
    lastTimeEntrySyncAt: (syncRun.data?.completed_at as string) || null,
  });

  // If PostgREST count says rows exist but we loaded none, pagination/RLS failed.
  if ((probe.count || 0) > 0 && entries.length === 0) {
    throw new Error(
      `Supabase reports ${probe.count} time entries in the trailing window but none loaded. Try refreshing; if it persists, check admin RLS on pa_time_entries.`,
    );
  }

  return board;
}

export async function loadEmployeeWorkloadDetail(
  employeeName: string,
  filters: StaffingBoardFilters,
): Promise<EmployeeWorkloadDetail | null> {
  const board = await loadStaffingBoard({ ...filters, employee: employeeName });
  const row = board.employees.find((e) => e.employeeName === employeeName);
  if (!row) return null;

  const trail30 = daysAgoYmd(30);
  const { data: entries, error } = await supabase
    .from('pa_time_entries')
    .select(
      'id,bqe_time_entry_id,employee_id,employee_name,project_id,project_name,parent_project_name,phase,phase_name,client,activity_id,activity,work_date,actual_hours,is_billable,is_written_off,is_extra,description,memo',
    )
    .eq('employee_name', employeeName)
    .gte('work_date', trail30)
    .order('work_date', { ascending: false })
    .limit(200);
  if (error) throw error;

  const recent = (entries || []) as TimeEntryLite[];
  const byAct = new Map<string, number>();
  for (const e of recent) {
    if (
      !isDeliveryHours({
        isBillable: e.is_billable,
        isWrittenOff: e.is_written_off,
        activity: e.activity,
        projectName: e.project_name,
        phase: e.phase,
      })
    ) {
      continue;
    }
    const b = activityBucket(e.activity);
    byAct.set(b, (byAct.get(b) || 0) + (Number(e.actual_hours) || 0));
  }

  return {
    ...row,
    activityBreakdown30d: [...byAct.entries()]
      .map(([activity, hours]) => ({ activity, hours }))
      .sort((a, b) => b.hours - a.hours),
    recentEntries: recent,
  };
}

/** Ensure capacity rows exist for roster employees (idempotent). */
export async function ensureDefaultCapacities(): Promise<number> {
  const [{ data: roster, error: rosterErr }, { data: caps, error: capsErr }] = await Promise.all([
    supabase.from('pa_employee_roster').select('employee'),
    supabase.from('pa_employee_capacity').select('employee_name'),
  ]);
  // Table missing / RLS / network — caller treats as no-op until migration is applied.
  if (rosterErr || capsErr) return 0;
  const have = new Set((caps || []).map((c) => c.employee_name as string));
  const missing = [...new Set((roster || []).map((r) => r.employee as string))].filter(
    (n) => n && !have.has(n),
  );
  if (!missing.length) return 0;
  const rows = missing.map((employee_name) => ({
    employee_name,
    weekly_capacity_hours: DEFAULT_CAPACITY,
    active: true,
    skills: [],
  }));
  const { error } = await supabase.from('pa_employee_capacity').insert(rows);
  if (error) return 0;
  return rows.length;
}
