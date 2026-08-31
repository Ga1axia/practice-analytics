-- Employee/lead pa_projects SELECT was evaluating membership + time-entry
-- helpers per row. With ~4.7k projects and ~93k time entries that times out
-- (PostgREST 500) — especially for new Microsoft users with no memberships.
-- Compute visible keys once, then filter with = any().

create or replace function public.pa_my_visible_project_keys()
returns text[]
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  with me as (
    select
      nullif(trim(public.pa_profile_employee()), '') as emp,
      nullif(trim(public.pa_my_employee_name()), '') as my_name
  ),
  seed as (
    select m.project_key as k
    from public.pa_project_members m
    cross join me
    where me.my_name is not null
      and lower(trim(m.employee_name)) = lower(trim(me.my_name))
    union
    select p.project
    from public.pa_projects p
    cross join me
    where me.emp is not null
      and p.manager = me.emp
    union
    select p.parent_project
    from public.pa_projects p
    cross join me
    where me.emp is not null
      and p.manager = me.emp
      and p.parent_project is not null
    union
    select te.project_name
    from public.pa_time_entries te
    cross join me
    where me.my_name is not null
      and lower(trim(te.employee_name)) = lower(trim(me.my_name))
      and te.project_name is not null
    union
    select te.parent_project_name
    from public.pa_time_entries te
    cross join me
    where me.my_name is not null
      and lower(trim(te.employee_name)) = lower(trim(me.my_name))
      and te.parent_project_name is not null
  ),
  expanded as (
    select k from seed
    union
    select p.project
    from public.pa_projects p
    where p.parent_project in (select k from seed)
    union
    select p.parent_project
    from public.pa_projects p
    where p.project in (select k from seed)
      and p.parent_project is not null
  )
  select coalesce(array_agg(distinct k), '{}'::text[])
  from expanded
  where k is not null
    and trim(k) <> '';
$$;

revoke all on function public.pa_my_visible_project_keys() from public;
grant execute on function public.pa_my_visible_project_keys() to authenticated;

drop policy if exists pa_projects_select on public.pa_projects;
create policy pa_projects_select on public.pa_projects
  for select to authenticated
  using (
    public.pa_is_exec()
    or (
      public.pa_profile_role() in ('employee', 'project_lead')
      and project = any (public.pa_my_visible_project_keys())
    )
    or (
      public.pa_profile_role() = 'customer'
      and client = public.pa_profile_client()
    )
  );

create or replace function public.pa_staff_project_access(p_project text, p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select case
    when public.pa_is_exec() then true
    when public.pa_profile_role() in ('employee', 'project_lead') then (
      p_project = any (public.pa_my_visible_project_keys())
      or (
        p_client is not null
        and exists (
          select 1
          from public.pa_projects p
          where p.client = p_client
            and p.manager = public.pa_profile_employee()
        )
      )
    )
    else false
  end;
$$;

drop policy if exists pa_project_monthly_billed_select on public.pa_project_monthly_billed;
create policy pa_project_monthly_billed_select on public.pa_project_monthly_billed
  for select to authenticated
  using (
    public.pa_profile_role() = 'admin'
    or (
      public.pa_profile_role() in ('employee', 'project_lead')
      and project = any (public.pa_my_visible_project_keys())
    )
    or (
      public.pa_profile_role() = 'customer'
      and exists (
        select 1
        from public.pa_projects p
        where p.project = pa_project_monthly_billed.project
          and p.client = public.pa_profile_client()
      )
    )
  );
