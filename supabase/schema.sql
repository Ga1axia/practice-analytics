-- Practice Analytics schema (pa_* tables)
-- RLS: anon SELECT only; writes via service role

create table if not exists public.pa_projects (
  id bigserial primary key,
  project text not null unique,
  client text,
  city text,
  manager text,
  status text,
  type text,
  phase text,
  contract double precision default 0,
  spent double precision default 0,
  billed double precision default 0,
  pct_used double precision,
  pct_billed double precision,
  retainer_paid double precision default 0,
  retainer_balance double precision default 0,
  ar double precision default 0,
  profit double precision default 0,
  margin double precision,
  row_kind text not null default 'phase' check (row_kind in ('project', 'phase')),
  parent_project text,
  billed_hours double precision default 0,
  spent_hours double precision default 0,
  contract_outstanding double precision default 0,
  sort_order int not null default 0
);

create table if not exists public.pa_employee_monthly (
  id bigserial primary key,
  employee text not null,
  month text not null,
  nb_hours double precision default 0,
  bill_hours double precision default 0,
  total_hours double precision default 0,
  efficiency double precision default 0,
  pto_hours double precision default 0,
  network_days double precision default 0,
  standard_hours double precision default 0,
  unique (employee, month)
);

create table if not exists public.pa_employee_totals (
  id bigserial primary key,
  employee text not null unique,
  bill_hours double precision default 0,
  nb_hours double precision default 0,
  total_hours double precision default 0,
  standard_hours double precision default 0,
  efficiency double precision default 0
);

create table if not exists public.pa_employee_roster (
  id bigserial primary key,
  team text not null,
  employee text not null,
  unique (team, employee)
);

create table if not exists public.pa_ar_clients (
  id bigserial primary key,
  client text not null unique,
  d0_30 double precision default 0,
  d31_60 double precision default 0,
  d61_90 double precision default 0,
  d91_plus double precision default 0,
  credit double precision default 0,
  balance double precision default 0
);

create table if not exists public.pa_invoice_ledger (
  id bigserial primary key,
  client text,
  invoice_date date,
  payment_date date,
  net double precision default 0,
  balance double precision default 0
);

create index if not exists pa_invoice_ledger_date_idx on public.pa_invoice_ledger (invoice_date);
create index if not exists pa_invoice_ledger_client_idx on public.pa_invoice_ledger (client);

create table if not exists public.pa_monthly_revenue (
  id bigserial primary key,
  month text not null unique,
  gross_billed double precision default 0,
  amount_paid double precision default 0,
  net_billed double precision default 0
);

create table if not exists public.pa_company_monthly (
  id bigserial primary key,
  month text not null unique,
  bill_hours double precision default 0,
  nb_hours double precision default 0,
  total_hours double precision default 0,
  standard_hours double precision default 0,
  efficiency double precision default 0,
  capacity_hours double precision default 0,
  client_nb_hours double precision default 0,
  mbd_hours double precision default 0,
  pto_sick_hours double precision default 0,
  others_nb_hours double precision default 0,
  probono_hours double precision default 0
);

create table if not exists public.pa_project_monthly_billed (
  id bigserial primary key,
  project text not null,
  month text not null,
  amount double precision default 0,
  unique (project, month)
);

create table if not exists public.pa_client_monthly_billed (
  id bigserial primary key,
  client text not null,
  month text not null,
  amount double precision default 0,
  unique (client, month)
);

create table if not exists public.pa_meta (
  key text primary key,
  value jsonb not null
);

-- RLS
alter table public.pa_projects enable row level security;
alter table public.pa_employee_monthly enable row level security;
alter table public.pa_employee_totals enable row level security;
alter table public.pa_employee_roster enable row level security;
alter table public.pa_ar_clients enable row level security;
alter table public.pa_invoice_ledger enable row level security;
alter table public.pa_monthly_revenue enable row level security;
alter table public.pa_company_monthly enable row level security;
alter table public.pa_project_monthly_billed enable row level security;
alter table public.pa_client_monthly_billed enable row level security;
alter table public.pa_meta enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'pa_projects','pa_employee_monthly','pa_employee_totals','pa_employee_roster',
    'pa_ar_clients','pa_invoice_ledger','pa_monthly_revenue','pa_company_monthly',
    'pa_project_monthly_billed','pa_client_monthly_billed','pa_meta'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I; create policy %I on public.%I for select to anon, authenticated using (true);',
      t || '_select', t, t || '_select', t
    );
  end loop;
end $$;

grant select on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;

-- Auth profiles + role RLS (applied via migration pa_auth_profiles_and_rls)
-- See pa_profiles, pa_profile_role(), and per-table authenticated SELECT policies.
-- Anon SELECT is revoked; clients must sign in.

-- Project schedules (applied via migration; RLS by role)
create table if not exists public.pa_schedules (
  id uuid primary key default gen_random_uuid(),
  project_key text not null unique,
  client_name text,
  title text,
  start_date text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.pa_schedule_rows (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.pa_schedules(id) on delete cascade,
  sort_order int not null default 0,
  row_kind text not null check (row_kind in ('phase', 'task', 'subtask')),
  task text not null default '',
  budget_remaining text not null default '',
  target_start text not null default '',
  target_end text not null default '',
  actual_start text not null default '',
  actual_end text not null default '',
  action text not null default '',
  estimate_time text not null default '',
  mdesigns_comments text not null default '',
  client_comments text not null default '',
  assignee_name text not null default '',
  updated_at timestamptz default now()
);

-- Project team membership (see migration 20260813_project_members_assignee.sql)
create table if not exists public.pa_project_members (
  id uuid primary key default gen_random_uuid(),
  project_key text not null,
  employee_name text not null,
  role text not null default 'member' check (role in ('lead', 'member')),
  created_at timestamptz not null default now(),
  unique (project_key, employee_name)
);

create index if not exists pa_schedule_rows_schedule_idx
  on public.pa_schedule_rows (schedule_id, sort_order);

-- Staff (admin / assigned employee) may write schedules.
-- Customers may UPDATE client_comments only (enforced by pa_schedule_rows_guard trigger).

-- Project List upload (admin): pa_replace_project_list(jsonb)
-- Admin INSERT/UPDATE/DELETE policies on pa_projects (see migration pa_projects_upload_hierarchy).

-- Client portal board (see migration pa_client_board_checks_messages):
--   pa_process_checks  — checklist done state per project/phase/side/item
--   pa_client_messages — direct PM ↔ client messages
--   pa_staff_or_client_project(project, client) — RLS helper
--   pa_client_box_links — staff-posted Box share URLs on the client Documents tab
--
-- Meeting history (see migration pa_client_meetings):
--   pa_client_meetings — dated meetings + notes per client (PM/admin only)
--   pa_staff_project_access(project, client) — staff RLS helper
--
-- Demo employees (see migration pa_employee_demos_arnita_nini_zhengrui):
--   arnita@ / nini@ / zhengrui@ mdesigns.test → DemoEmployee2026!
--   RLS: employees see managed rows + parent project headers they work under

-- ---------------------------------------------------------------------------
-- Staffing & Active Workload (see migration 20260811_staffing_workload.sql)
-- Admin-only via public.pa_is_admin() → pa_profiles.role = 'admin'
-- ---------------------------------------------------------------------------
-- pa_bqe_sync_runs — historical/incremental/dry_run audit
-- pa_time_entries — persisted BQE CORE time entries (no billRate/costRate cols)
-- pa_employee_capacity — weekly capacity / role / discipline / skills
-- pa_project_staffing_profiles — planning project metadata
-- pa_project_phase_staffing — planning phases
-- pa_employee_phase_allocations — weekly planned hours (unique emp+phase+week)
-- pa_employee_time_off — day-based PTO/holiday/training/other
