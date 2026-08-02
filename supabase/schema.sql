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
  efficiency double precision default 0
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
  updated_at timestamptz default now()
);

create index if not exists pa_schedule_rows_schedule_idx
  on public.pa_schedule_rows (schedule_id, sort_order);

-- Staff (admin / assigned employee) may write schedules.
-- Customers may UPDATE client_comments only (enforced by pa_schedule_rows_guard trigger).

-- Project List upload (admin): pa_replace_project_list(jsonb)
-- Admin INSERT/UPDATE/DELETE policies on pa_projects (see migration pa_projects_upload_hierarchy).
