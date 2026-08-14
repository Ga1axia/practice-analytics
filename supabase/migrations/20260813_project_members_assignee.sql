-- Project membership (leads add members) + task assignee on schedule rows.

alter table public.pa_schedule_rows
  add column if not exists assignee_name text not null default '';

create table if not exists public.pa_project_members (
  id uuid primary key default gen_random_uuid(),
  project_key text not null,
  employee_name text not null,
  role text not null default 'member'
    check (role in ('lead', 'member')),
  created_at timestamptz not null default now(),
  unique (project_key, employee_name)
);

create index if not exists pa_project_members_employee_idx
  on public.pa_project_members (lower(trim(employee_name)));

create index if not exists pa_project_members_project_idx
  on public.pa_project_members (project_key);

alter table public.pa_project_members enable row level security;

drop policy if exists pa_project_members_select on public.pa_project_members;
create policy pa_project_members_select on public.pa_project_members
  for select to authenticated
  using (public.pa_is_staff());

drop policy if exists pa_project_members_insert on public.pa_project_members;
create policy pa_project_members_insert on public.pa_project_members
  for insert to authenticated
  with check (public.pa_is_staff());

drop policy if exists pa_project_members_update on public.pa_project_members;
create policy pa_project_members_update on public.pa_project_members
  for update to authenticated
  using (public.pa_is_staff())
  with check (public.pa_is_staff());

drop policy if exists pa_project_members_delete on public.pa_project_members;
create policy pa_project_members_delete on public.pa_project_members
  for delete to authenticated
  using (public.pa_is_staff());

grant select, insert, update, delete on public.pa_project_members to authenticated;
