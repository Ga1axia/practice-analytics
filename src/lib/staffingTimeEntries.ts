import { supabase } from './supabase';
import type { TimeEntryLite } from './staffingTypes';

export type HistoricalTimeEntryFilters = {
  fromDate: string;
  toDate: string;
  employee?: string;
  projectQuery?: string;
  billable?: 'all' | 'billable' | 'non_billable';
  page?: number;
  pageSize?: number;
};

export type HistoricalTimeEntriesResult = {
  rows: TimeEntryLite[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
};

const TE_SELECT =
  'id,bqe_time_entry_id,employee_id,employee_name,project_id,project_name,parent_project_name,phase,phase_name,client,activity_id,activity,work_date,actual_hours,is_billable,is_written_off,is_extra,description,memo';

function mapErr(error: { message?: string; code?: string } | null): string | null {
  if (!error) return null;
  const msg = error.message || 'Query failed';
  if (error.code === 'PGRST205' || /Could not find the table|schema cache/i.test(msg)) {
    return 'Time entry table is missing. Apply the staffing migration, then retry.';
  }
  if (/permission|row-level|rls|not accept/i.test(msg)) {
    return 'Cannot read time entries (admin RLS). Confirm your profile role is admin.';
  }
  return msg;
}

/** Page historical time entries for the Staffing sheet browser. */
export async function loadHistoricalTimeEntries(
  filters: HistoricalTimeEntryFilters,
): Promise<HistoricalTimeEntriesResult> {
  const page = Math.max(0, filters.page || 0);
  const pageSize = Math.min(200, Math.max(25, filters.pageSize || 50));
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let q = supabase
    .from('pa_time_entries')
    .select(TE_SELECT)
    .gte('work_date', filters.fromDate)
    .lte('work_date', filters.toDate)
    .order('work_date', { ascending: false })
    .order('employee_name', { ascending: true })
    .range(from, to);

  if (filters.employee) q = q.eq('employee_name', filters.employee);
  if (filters.billable === 'billable') q = q.eq('is_billable', true);
  if (filters.billable === 'non_billable') q = q.eq('is_billable', false);
  const pq = (filters.projectQuery || '').trim();
  if (pq) {
    q = q.or(
      `project_name.ilike.%${pq}%,parent_project_name.ilike.%${pq}%,client.ilike.%${pq}%,phase.ilike.%${pq}%,phase_name.ilike.%${pq}%`,
    );
  }

  const { data, error } = await q;
  const rows = (data || []) as TimeEntryLite[];
  return {
    rows,
    total: from + rows.length + (rows.length === pageSize ? 1 : 0),
    page,
    pageSize,
    error: mapErr(error),
  };
}

/** Firm totals for the selected historical window (admin). Paged sum — safe for large imports. */
export async function loadHistoricalTimeEntryStats(fromDate: string, toDate: string): Promise<{
  entries: number;
  hours: number;
  billableHours: number;
  employees: number;
  error: string | null;
}> {
  const employees = new Set<string>();
  let hours = 0;
  let billableHours = 0;
  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('pa_time_entries')
      .select('actual_hours,is_billable,employee_name')
      .gte('work_date', fromDate)
      .lte('work_date', toDate)
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      return { entries: 0, hours: 0, billableHours: 0, employees: 0, error: mapErr(error) };
    }
    const rows = data || [];
    for (const r of rows) {
      const h = Number(r.actual_hours) || 0;
      hours += h;
      if (r.is_billable) billableHours += h;
      if (r.employee_name) employees.add(r.employee_name as string);
    }
    if (rows.length < pageSize) {
      from += rows.length;
      break;
    }
    from += pageSize;
    if (from > 200_000) break;
  }
  return {
    entries: from,
    hours,
    billableHours,
    employees: employees.size,
    error: null,
  };
}
