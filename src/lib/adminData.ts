import { supabase } from './supabase';

/** Keep in sync with api/admin/data.ts ADMIN_TABLES. */
export const ADMIN_TABLES = [
  'pa_projects',
  'pa_profiles',
  'pa_project_members',
  'pa_time_entries',
  'pa_employee_monthly',
  'pa_employee_totals',
  'pa_employee_roster',
  'pa_employee_capacity',
  'pa_ar_clients',
  'pa_invoice_ledger',
  'pa_monthly_revenue',
  'pa_company_monthly',
  'pa_project_monthly_billed',
  'pa_client_monthly_billed',
  'pa_schedules',
  'pa_schedule_rows',
  'pa_bqe_sync_runs',
  'pa_project_staffing_profiles',
  'pa_project_phase_staffing',
  'pa_employee_phase_allocations',
  'pa_employee_time_off',
  'pa_client_messages',
  'pa_client_meetings',
  'pa_client_box_links',
  'pa_process_checks',
] as const;

export type AdminTable = (typeof ADMIN_TABLES)[number];

async function authHeaders(): Promise<HeadersInit> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  let token = refreshed.session?.access_token;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  }
  if (!token) throw new Error('Sign in as admin required.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function adminData<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/admin/data', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: T & { error?: string; detail?: string };
  try {
    json = JSON.parse(text) as T & { error?: string; detail?: string };
  } catch {
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }
  if (!res.ok) {
    throw new Error([json.error, json.detail].filter(Boolean).join(' ') || `HTTP ${res.status}`);
  }
  return json;
}

export type TableInfo = {
  table: string;
  count: number;
  ok: boolean;
  error?: string;
};

export function listAdminTables() {
  return adminData<{ tables: TableInfo[] }>({ action: 'tables' });
}

export function queryAdminTable(input: {
  table: AdminTable | string;
  columns?: string;
  filters?: Record<string, string | number | boolean | null>;
  search?: { column: string; value: string };
  order?: { column: string; ascending?: boolean };
  from?: number;
  limit?: number;
}) {
  return adminData<{
    rows: Record<string, unknown>[];
    count: number | null;
    from: number;
    limit: number;
  }>({ action: 'query', ...input });
}

export function upsertAdminRows(table: string, rows: Record<string, unknown>[]) {
  return adminData<{ upserted: number; rows: Record<string, unknown>[] }>({
    action: 'upsert',
    table,
    rows,
  });
}

export function updateAdminRows(input: {
  table: string;
  patch: Record<string, unknown>;
  ids?: string[];
  idColumn?: string;
  match?: Record<string, string | number | boolean | null>;
}) {
  return adminData<{ updated: number; rows: Record<string, unknown>[] }>({
    action: 'update',
    ...input,
  });
}

export function deleteAdminRows(input: {
  table: string;
  ids?: string[];
  idColumn?: string;
  match?: Record<string, string | number | boolean | null>;
}) {
  return adminData<{ deleted: number }>({ action: 'delete', ...input });
}

export function seedMembersFromTimeEntries(dryRun = false) {
  return adminData<{
    scannedTe: number;
    wouldInsert: number;
    wouldPromote: number;
    inserted: number;
    promoted: number;
    projectHeaders: number;
  }>({ action: 'seed_members_from_te', dryRun });
}

export function clearAllSchedules() {
  return adminData<{ ok: boolean; message?: string }>({ action: 'clear_schedules' });
}

export function clearProjectList() {
  return adminData<{ ok: boolean; result?: unknown }>({ action: 'clear_projects' });
}
