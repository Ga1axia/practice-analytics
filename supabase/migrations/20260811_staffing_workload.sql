-- Staffing & Active Workload: raw BQE time entries + planning layer
-- Admin-only RLS via pa_is_admin() (reads pa_profiles.role).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helper: admin check (matches app convention: pa_profiles.role = 'admin')
-- ---------------------------------------------------------------------------
create or replace function public.pa_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pa_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function public.pa_is_admin() from public;
grant execute on function public.pa_is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Sync run audit
-- ---------------------------------------------------------------------------
create table if not exists public.pa_bqe_sync_runs (
  id uuid primary key default gen_random_uuid(),
  sync_type text not null check (sync_type in ('historical', 'incremental', 'dry_run', 'aggregates')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'partial')),
  since_date date,
  until_date date,
  last_cursor text,
  last_updated_cursor timestamptz,
  entries_fetched int not null default 0,
  entries_inserted int not null default 0,
  entries_updated int not null default 0,
  entries_skipped int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  initiated_by uuid,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pa_bqe_sync_runs_started_idx
  on public.pa_bqe_sync_runs (started_at desc);
create index if not exists pa_bqe_sync_runs_type_status_idx
  on public.pa_bqe_sync_runs (sync_type, status, started_at desc);

alter table public.pa_bqe_sync_runs enable row level security;

drop policy if exists pa_bqe_sync_runs_admin_select on public.pa_bqe_sync_runs;
create policy pa_bqe_sync_runs_admin_select on public.pa_bqe_sync_runs
  for select to authenticated
  using (public.pa_is_admin());

-- Writes go through service role (API); no authenticated insert/update policies.

-- ---------------------------------------------------------------------------
-- Raw BQE time entries (no billRate / costRate columns)
-- ---------------------------------------------------------------------------
create table if not exists public.pa_time_entries (
  id uuid primary key default gen_random_uuid(),
  bqe_time_entry_id text not null unique,
  employee_id text,
  employee_name text,
  project_id text,
  project_name text,
  parent_project_name text,
  phase text,
  phase_name text,
  client text,
  activity_id text,
  activity text,
  work_date date not null,
  actual_hours numeric not null default 0,
  client_hours numeric,
  is_billable boolean not null default false,
  is_written_off boolean not null default false,
  is_extra boolean not null default false,
  bill_status integer,
  invoice_id text,
  description text,
  memo text,
  bqe_created_at timestamptz,
  bqe_last_updated_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pa_time_entries_emp_id_date_idx
  on public.pa_time_entries (employee_id, work_date);
create index if not exists pa_time_entries_emp_name_date_idx
  on public.pa_time_entries (employee_name, work_date);
create index if not exists pa_time_entries_project_date_idx
  on public.pa_time_entries (project_id, work_date);
create index if not exists pa_time_entries_work_date_idx
  on public.pa_time_entries (work_date);
create index if not exists pa_time_entries_phase_date_idx
  on public.pa_time_entries (phase, work_date);
create index if not exists pa_time_entries_billable_date_idx
  on public.pa_time_entries (is_billable, work_date);
create index if not exists pa_time_entries_bqe_updated_idx
  on public.pa_time_entries (bqe_last_updated_at);
create index if not exists pa_time_entries_project_emp_date_idx
  on public.pa_time_entries (project_id, employee_id, work_date);

alter table public.pa_time_entries enable row level security;

drop policy if exists pa_time_entries_admin_select on public.pa_time_entries;
create policy pa_time_entries_admin_select on public.pa_time_entries
  for select to authenticated
  using (public.pa_is_admin());

-- ---------------------------------------------------------------------------
-- Planning: capacity
-- ---------------------------------------------------------------------------
create table if not exists public.pa_employee_capacity (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  weekly_capacity_hours numeric not null default 32 check (weekly_capacity_hours >= 0),
  target_delivery_hours numeric check (target_delivery_hours is null or target_delivery_hours >= 0),
  active boolean not null default true,
  role text,
  discipline text,
  skills jsonb not null default '[]'::jsonb,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pa_employee_capacity_name_active_uidx
  on public.pa_employee_capacity (employee_name)
  where active = true and effective_to is null;

create index if not exists pa_employee_capacity_name_idx
  on public.pa_employee_capacity (employee_name);

alter table public.pa_employee_capacity enable row level security;

drop policy if exists pa_employee_capacity_admin_all on public.pa_employee_capacity;
create policy pa_employee_capacity_admin_all on public.pa_employee_capacity
  for all to authenticated
  using (public.pa_is_admin())
  with check (public.pa_is_admin());

-- ---------------------------------------------------------------------------
-- Planning: project / phase staffing profiles
-- ---------------------------------------------------------------------------
create table if not exists public.pa_project_staffing_profiles (
  id uuid primary key default gen_random_uuid(),
  bqe_project_id text,
  project_key text,
  project_name text not null,
  client text,
  project_type text,
  project_status text not null default 'active'
    check (project_status in ('active', 'paused', 'completed')),
  project_manager text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pa_project_staffing_profiles_key_uidx
  on public.pa_project_staffing_profiles (project_key)
  where project_key is not null;

create unique index if not exists pa_project_staffing_profiles_bqe_uidx
  on public.pa_project_staffing_profiles (bqe_project_id)
  where bqe_project_id is not null;

create index if not exists pa_project_staffing_profiles_name_idx
  on public.pa_project_staffing_profiles (project_name);

alter table public.pa_project_staffing_profiles enable row level security;

drop policy if exists pa_project_staffing_profiles_admin_all on public.pa_project_staffing_profiles;
create policy pa_project_staffing_profiles_admin_all on public.pa_project_staffing_profiles
  for all to authenticated
  using (public.pa_is_admin())
  with check (public.pa_is_admin());

create table if not exists public.pa_project_phase_staffing (
  id uuid primary key default gen_random_uuid(),
  project_staffing_profile_id uuid not null
    references public.pa_project_staffing_profiles(id) on delete cascade,
  bqe_phase_id text,
  phase_key text,
  phase_code text,
  phase_name text not null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed')),
  target_completion_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pa_project_phase_staffing_bqe_uidx
  on public.pa_project_phase_staffing (bqe_phase_id)
  where bqe_phase_id is not null;

create unique index if not exists pa_project_phase_staffing_profile_key_uidx
  on public.pa_project_phase_staffing (project_staffing_profile_id, phase_key)
  where phase_key is not null;

create index if not exists pa_project_phase_staffing_profile_idx
  on public.pa_project_phase_staffing (project_staffing_profile_id);

alter table public.pa_project_phase_staffing enable row level security;

drop policy if exists pa_project_phase_staffing_admin_all on public.pa_project_phase_staffing;
create policy pa_project_phase_staffing_admin_all on public.pa_project_phase_staffing
  for all to authenticated
  using (public.pa_is_admin())
  with check (public.pa_is_admin());

-- ---------------------------------------------------------------------------
-- Planning: weekly allocations + time off
-- ---------------------------------------------------------------------------
create table if not exists public.pa_employee_phase_allocations (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  project_staffing_profile_id uuid not null
    references public.pa_project_staffing_profiles(id) on delete cascade,
  project_phase_staffing_id uuid not null
    references public.pa_project_phase_staffing(id) on delete cascade,
  week_start date not null,
  planned_hours numeric not null check (planned_hours >= 0),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_name, project_phase_staffing_id, week_start)
);

create index if not exists pa_employee_phase_allocations_emp_week_idx
  on public.pa_employee_phase_allocations (employee_name, week_start);
create index if not exists pa_employee_phase_allocations_week_idx
  on public.pa_employee_phase_allocations (week_start);

alter table public.pa_employee_phase_allocations enable row level security;

drop policy if exists pa_employee_phase_allocations_admin_all on public.pa_employee_phase_allocations;
create policy pa_employee_phase_allocations_admin_all on public.pa_employee_phase_allocations
  for all to authenticated
  using (public.pa_is_admin())
  with check (public.pa_is_admin());

create table if not exists public.pa_employee_time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  off_date date not null,
  hours numeric not null check (hours >= 0),
  type text not null default 'pto'
    check (type in ('pto', 'holiday', 'training', 'other')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pa_employee_time_off_emp_date_idx
  on public.pa_employee_time_off (employee_name, off_date);
create index if not exists pa_employee_time_off_date_idx
  on public.pa_employee_time_off (off_date);

alter table public.pa_employee_time_off enable row level security;

drop policy if exists pa_employee_time_off_admin_all on public.pa_employee_time_off;
create policy pa_employee_time_off_admin_all on public.pa_employee_time_off
  for all to authenticated
  using (public.pa_is_admin())
  with check (public.pa_is_admin());

grant select on public.pa_bqe_sync_runs to authenticated;
grant select on public.pa_time_entries to authenticated;
grant select, insert, update, delete on public.pa_employee_capacity to authenticated;
grant select, insert, update, delete on public.pa_project_staffing_profiles to authenticated;
grant select, insert, update, delete on public.pa_project_phase_staffing to authenticated;
grant select, insert, update, delete on public.pa_employee_phase_allocations to authenticated;
grant select, insert, update, delete on public.pa_employee_time_off to authenticated;
