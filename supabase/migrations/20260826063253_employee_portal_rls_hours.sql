-- Exec + project_lead can read hour rollups; employees still limited to own name.

drop policy if exists pa_employee_monthly_select on public.pa_employee_monthly;
create policy pa_employee_monthly_select on public.pa_employee_monthly
  for select to authenticated
  using (
    public.pa_is_exec()
    or (
      public.pa_profile_role() in ('employee', 'project_lead')
      and employee is not null
      and public.pa_my_employee_name() is not null
      and lower(trim(employee)) = lower(trim(public.pa_my_employee_name()))
    )
  );

drop policy if exists pa_employee_totals_select on public.pa_employee_totals;
create policy pa_employee_totals_select on public.pa_employee_totals
  for select to authenticated
  using (
    public.pa_is_exec()
    or (
      public.pa_profile_role() in ('employee', 'project_lead')
      and employee is not null
      and public.pa_my_employee_name() is not null
      and lower(trim(employee)) = lower(trim(public.pa_my_employee_name()))
    )
  );

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
            or (parent_project_name is not null and parent_project_name ilike ('%' || m.project_key || '%'))
            or (project_name is not null and project_name ilike ('%' || m.project_key || '%'))
          )
      )
    )
  );
