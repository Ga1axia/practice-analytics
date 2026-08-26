-- Roles: admin (dashboard + exec), exec (firm analytics), project_lead, employee, customer.
-- Microsoft (@mdesignsarchitects.com) auto-provision with named role seeds.

-- ---------------------------------------------------------------------------
-- Expand pa_profiles.role check
-- ---------------------------------------------------------------------------
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'pa_profiles'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%role%';
  if cname is not null then
    execute format('alter table public.pa_profiles drop constraint %I', cname);
  end if;
end $$;

alter table public.pa_profiles
  add constraint pa_profiles_role_check
  check (role = any (array[
    'admin'::text,
    'exec'::text,
    'project_lead'::text,
    'employee'::text,
    'customer'::text
  ]));

-- ---------------------------------------------------------------------------
-- Role helpers
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

create or replace function public.pa_is_exec()
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
      and p.role in ('admin', 'exec')
  );
$$;

create or replace function public.pa_is_staff()
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
      and p.role in ('admin', 'exec', 'project_lead', 'employee')
  );
$$;

revoke all on function public.pa_is_admin() from public;
revoke all on function public.pa_is_exec() from public;
revoke all on function public.pa_is_staff() from public;
grant execute on function public.pa_is_admin() to authenticated;
grant execute on function public.pa_is_exec() to authenticated;
grant execute on function public.pa_is_staff() to authenticated;

-- Member (any role) on a project key / parent header
create or replace function public.pa_is_project_member(p_project_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.pa_my_employee_name() is not null
    and exists (
      select 1
      from public.pa_project_members m
      where lower(trim(m.employee_name)) = lower(trim(public.pa_my_employee_name()))
        and (
          m.project_key = p_project_key
          or exists (
            select 1
            from public.pa_projects p
            where p.project = p_project_key
              and (
                p.parent_project = m.project_key
                or p.project = m.project_key
              )
          )
        )
    );
$$;

create or replace function public.pa_is_project_lead_member(p_project_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.pa_my_employee_name() is not null
    and exists (
      select 1
      from public.pa_project_members m
      where m.role = 'lead'
        and lower(trim(m.employee_name)) = lower(trim(public.pa_my_employee_name()))
        and (
          m.project_key = p_project_key
          or exists (
            select 1
            from public.pa_projects p
            where p.project = p_project_key
              and (
                p.parent_project = m.project_key
                or p.project = m.project_key
              )
          )
        )
    );
$$;

-- Time logged on this project (or its parent) — used to bootstrap membership visibility
create or replace function public.pa_employee_has_time_on_project(p_project_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.pa_my_employee_name() is not null
    and exists (
      select 1
      from public.pa_time_entries te
      where lower(trim(te.employee_name)) = lower(trim(public.pa_my_employee_name()))
        and (
          te.project_name = p_project_key
          or te.parent_project_name = p_project_key
          or exists (
            select 1
            from public.pa_projects p
            where p.project = p_project_key
              and (
                te.project_name = p.project
                or te.parent_project_name = p.project
                or (p.parent_project is not null and te.parent_project_name = p.parent_project)
                or (p.parent_project is not null and te.project_name = p.parent_project)
              )
          )
        )
    );
$$;

revoke all on function public.pa_is_project_member(text) from public;
revoke all on function public.pa_is_project_lead_member(text) from public;
revoke all on function public.pa_employee_has_time_on_project(text) from public;
grant execute on function public.pa_is_project_member(text) to authenticated;
grant execute on function public.pa_is_project_lead_member(text) to authenticated;
grant execute on function public.pa_employee_has_time_on_project(text) to authenticated;

-- Firm + lead project access helper (schedules / boards)
create or replace function public.pa_staff_project_access(p_project text, p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.pa_is_exec() then true
    when public.pa_profile_role() in ('employee', 'project_lead') then (
      exists (
        select 1
        from public.pa_projects p
        where p.manager = public.pa_profile_employee()
          and (
            p.project = p_project
            or p.parent_project = p_project
            or (p_client is not null and p.client = p_client)
          )
      )
      or public.pa_is_project_member(p_project)
      or public.pa_employee_has_time_on_project(p_project)
    )
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- Projects SELECT: exec sees all; staff see managed / member / TE projects
-- ---------------------------------------------------------------------------
drop policy if exists pa_projects_select on public.pa_projects;
create policy pa_projects_select on public.pa_projects
  for select to authenticated
  using (
    public.pa_is_exec()
    or (
      public.pa_profile_role() in ('employee', 'project_lead')
      and (
        manager = public.pa_profile_employee()
        or (
          coalesce(row_kind, 'phase') = 'project'
          and public.pa_employee_manages_project_header(project)
        )
        or public.pa_is_project_member(project)
        or (
          parent_project is not null
          and public.pa_is_project_member(parent_project)
        )
        or public.pa_employee_has_time_on_project(project)
        or (
          parent_project is not null
          and public.pa_employee_has_time_on_project(parent_project)
        )
      )
    )
    or (
      public.pa_profile_role() = 'customer'
      and client = public.pa_profile_client()
    )
  );

-- Keep project writes admin-only (dashboard management)
drop policy if exists pa_projects_admin_insert on public.pa_projects;
create policy pa_projects_admin_insert on public.pa_projects
  for insert to authenticated
  with check (public.pa_is_admin());

drop policy if exists pa_projects_admin_update on public.pa_projects;
create policy pa_projects_admin_update on public.pa_projects
  for update to authenticated
  using (public.pa_is_admin())
  with check (public.pa_is_admin());

drop policy if exists pa_projects_admin_delete on public.pa_projects;
create policy pa_projects_admin_delete on public.pa_projects
  for delete to authenticated
  using (public.pa_is_admin());

-- ---------------------------------------------------------------------------
-- Time entries: exec (firm), own rows, or lead on matching project
-- ---------------------------------------------------------------------------
drop policy if exists pa_time_entries_admin_select on public.pa_time_entries;
drop policy if exists pa_time_entries_select on public.pa_time_entries;
create policy pa_time_entries_select on public.pa_time_entries
  for select to authenticated
  using (
    public.pa_is_exec()
    or (
      employee_name is not null
      and public.pa_my_employee_name() is not null
      and lower(trim(employee_name)) = lower(trim(public.pa_my_employee_name()))
    )
    or (
      public.pa_my_employee_name() is not null
      and exists (
        select 1
        from public.pa_project_members m
        where m.role = 'lead'
          and lower(trim(m.employee_name)) = lower(trim(public.pa_my_employee_name()))
          and (
            m.project_key = project_name
            or m.project_key = parent_project_name
            or (
              parent_project_name is not null
              and parent_project_name ilike ('%' || m.project_key || '%')
            )
            or (
              project_name is not null
              and project_name ilike ('%' || m.project_key || '%')
            )
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Staffing tables: exec can use firm workload (was admin-only)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'pa_employee_capacity',
        'pa_employee_roster',
        'pa_employee_phase_allocations',
        'pa_employee_time_off',
        'pa_project_staffing_profiles',
        'pa_project_phase_staffing',
        'pa_bqe_sync_runs'
      )
      and (
        qual ilike '%pa_is_admin%'
        or with_check ilike '%pa_is_admin%'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      r.policyname,
      r.tablename
    );
  end loop;
end $$;

-- Recreate common staffing SELECT/ALL policies for exec
do $$
begin
  if to_regclass('public.pa_employee_capacity') is not null then
    drop policy if exists pa_employee_capacity_admin_all on public.pa_employee_capacity;
    drop policy if exists pa_employee_capacity_exec_all on public.pa_employee_capacity;
    create policy pa_employee_capacity_exec_all on public.pa_employee_capacity
      for all to authenticated
      using (public.pa_is_exec())
      with check (public.pa_is_exec());
  end if;

  if to_regclass('public.pa_employee_roster') is not null then
    drop policy if exists pa_employee_roster_admin_all on public.pa_employee_roster;
    drop policy if exists pa_employee_roster_exec_all on public.pa_employee_roster;
    create policy pa_employee_roster_exec_all on public.pa_employee_roster
      for all to authenticated
      using (public.pa_is_exec())
      with check (public.pa_is_exec());
  end if;

  if to_regclass('public.pa_employee_phase_allocations') is not null then
    drop policy if exists pa_employee_phase_allocations_admin_all on public.pa_employee_phase_allocations;
    drop policy if exists pa_employee_phase_allocations_exec_all on public.pa_employee_phase_allocations;
    create policy pa_employee_phase_allocations_exec_all on public.pa_employee_phase_allocations
      for all to authenticated
      using (public.pa_is_exec())
      with check (public.pa_is_exec());
  end if;

  if to_regclass('public.pa_employee_time_off') is not null then
    drop policy if exists pa_employee_time_off_admin_all on public.pa_employee_time_off;
    drop policy if exists pa_employee_time_off_exec_all on public.pa_employee_time_off;
    create policy pa_employee_time_off_exec_all on public.pa_employee_time_off
      for all to authenticated
      using (public.pa_is_exec())
      with check (public.pa_is_exec());
  end if;

  if to_regclass('public.pa_project_staffing_profiles') is not null then
    drop policy if exists pa_project_staffing_profiles_admin_all on public.pa_project_staffing_profiles;
    drop policy if exists pa_project_staffing_profiles_exec_all on public.pa_project_staffing_profiles;
    create policy pa_project_staffing_profiles_exec_all on public.pa_project_staffing_profiles
      for all to authenticated
      using (public.pa_is_exec())
      with check (public.pa_is_exec());
  end if;

  if to_regclass('public.pa_project_phase_staffing') is not null then
    drop policy if exists pa_project_phase_staffing_admin_all on public.pa_project_phase_staffing;
    drop policy if exists pa_project_phase_staffing_exec_all on public.pa_project_phase_staffing;
    create policy pa_project_phase_staffing_exec_all on public.pa_project_phase_staffing
      for all to authenticated
      using (public.pa_is_exec())
      with check (public.pa_is_exec());
  end if;

  if to_regclass('public.pa_bqe_sync_runs') is not null then
    drop policy if exists pa_bqe_sync_runs_admin_select on public.pa_bqe_sync_runs;
    drop policy if exists pa_bqe_sync_runs_exec_select on public.pa_bqe_sync_runs;
    create policy pa_bqe_sync_runs_exec_select on public.pa_bqe_sync_runs
      for select to authenticated
      using (public.pa_is_exec());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Microsoft OAuth: provision firm emails with seeded roles
-- ---------------------------------------------------------------------------
create or replace function public.pa_role_for_firm_email(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  email_norm text := lower(trim(coalesce(p_email, '')));
  local_part text := split_part(email_norm, '@', 1);
begin
  if email_norm not like '%@mdesignsarchitects.com' then
    return null;
  end if;
  return case local_part
    when 'taihei' then 'admin'
    when 'junaidq' then 'admin'
    when 'malikajunaid' then 'exec'
    when 'malika' then 'exec'
    when 'avery' then 'project_lead'
    when 'avery.cobe' then 'project_lead'
    else 'employee'
  end;
end;
$$;

create or replace function public.pa_employee_name_for_firm_email(p_email text, p_display text)
returns text
language plpgsql
immutable
as $$
declare
  email_norm text := lower(trim(coalesce(p_email, '')));
  local_part text := split_part(email_norm, '@', 1);
  display text := nullif(trim(coalesce(p_display, '')), '');
begin
  return case local_part
    when 'taihei' then coalesce(display, 'Taihei Eastwood')
    when 'junaidq' then coalesce(display, 'Junaid Qureshi')
    when 'malikajunaid' then 'Malika Junaid'
    when 'malika' then 'Malika Junaid'
    when 'avery' then 'Avery Cobe'
    when 'avery.cobe' then 'Avery Cobe'
    when 'arnita' then 'Arnita Serri'
    when 'nini' then 'Ni Ni'
    when 'zhengrui' then 'Zhengrui He'
    when 'maria' then 'Maria Abreu'
    when 'maurits' then 'Maurits de Gans'
    else coalesce(display, initcap(replace(local_part, '.', ' ')))
  end;
end;
$$;

create or replace function public.pa_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_norm text := lower(coalesce(new.email, ''));
  display text := nullif(
    trim(coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'display_name',
      ''
    )),
    ''
  );
  role_seed text;
  emp_name text;
begin
  role_seed := public.pa_role_for_firm_email(email_norm);
  if role_seed is null then
    return new;
  end if;

  emp_name := public.pa_employee_name_for_firm_email(email_norm, display);

  insert into public.pa_profiles (id, email, role, display_name, employee_name, client_name)
  values (
    new.id,
    new.email,
    role_seed,
    coalesce(display, emp_name),
    emp_name,
    null
  )
  on conflict (id) do update
  set
    email = excluded.email,
    -- Keep named seeds in sync; do not demote manually elevated users from employee→employee no-op
    role = case
      when excluded.role in ('admin', 'exec', 'project_lead') then excluded.role
      else public.pa_profiles.role
    end,
    display_name = coalesce(public.pa_profiles.display_name, excluded.display_name),
    employee_name = coalesce(nullif(trim(public.pa_profiles.employee_name), ''), excluded.employee_name);

  return new;
end;
$$;

revoke all on function public.pa_handle_new_auth_user() from public;
revoke all on function public.pa_handle_new_auth_user() from anon, authenticated;

drop trigger if exists pa_on_auth_user_created on auth.users;
create trigger pa_on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.pa_handle_new_auth_user();

-- Backfill / upsert firm profiles for existing Auth users
insert into public.pa_profiles (id, email, role, display_name, employee_name, client_name)
select
  u.id,
  u.email,
  public.pa_role_for_firm_email(u.email),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    public.pa_employee_name_for_firm_email(u.email, null)
  ),
  public.pa_employee_name_for_firm_email(
    u.email,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
  ),
  null
from auth.users u
where public.pa_role_for_firm_email(u.email) is not null
on conflict (id) do update
set
  role = excluded.role,
  email = excluded.email,
  display_name = coalesce(public.pa_profiles.display_name, excluded.display_name),
  employee_name = coalesce(nullif(trim(public.pa_profiles.employee_name), ''), excluded.employee_name);

-- Demo account role seeds (password demos)
update public.pa_profiles
set role = 'exec'
where lower(email) in ('malika.junaid@mdesigns.test');

update public.pa_profiles
set role = 'project_lead',
    employee_name = coalesce(nullif(trim(employee_name), ''), 'Avery Cobe'),
    display_name = coalesce(nullif(trim(display_name), ''), 'Avery Cobe')
where lower(email) in ('avery.cobe@mdesigns.test', 'avery@mdesigns.test');

-- Keep practice admin demo as dashboard admin
update public.pa_profiles
set role = 'admin'
where lower(email) = 'admin@mdesigns.test';
