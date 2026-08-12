-- Employees can read their own time entries (match pa_profiles.employee_name).
-- Staff (admin + employee) can create schedules / seed dated rows.
-- Customers keep schedule SELECT + comment updates (existing trigger still applies).

create or replace function public.pa_my_employee_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(employee_name), '')
  from public.pa_profiles
  where id = auth.uid()
  limit 1;
$$;

revoke all on function public.pa_my_employee_name() from public;
grant execute on function public.pa_my_employee_name() to authenticated;

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
      and p.role in ('admin', 'employee')
  );
$$;

revoke all on function public.pa_is_staff() from public;
grant execute on function public.pa_is_staff() to authenticated;

-- Time entries: admin OR matching employee_name on profile
drop policy if exists pa_time_entries_admin_select on public.pa_time_entries;
drop policy if exists pa_time_entries_select on public.pa_time_entries;
create policy pa_time_entries_select on public.pa_time_entries
  for select to authenticated
  using (
    public.pa_is_admin()
    or (
      employee_name is not null
      and public.pa_my_employee_name() is not null
      and lower(trim(employee_name)) = lower(trim(public.pa_my_employee_name()))
    )
  );

grant select on public.pa_time_entries to authenticated;

alter table public.pa_schedules enable row level security;
alter table public.pa_schedule_rows enable row level security;

-- SELECT for all signed-in users (customer portal + staff)
drop policy if exists pa_schedules_select on public.pa_schedules;
create policy pa_schedules_select on public.pa_schedules
  for select to authenticated
  using (true);

drop policy if exists pa_schedule_rows_select on public.pa_schedule_rows;
create policy pa_schedule_rows_select on public.pa_schedule_rows
  for select to authenticated
  using (true);

-- Staff create / maintain schedules
drop policy if exists pa_schedules_staff_insert on public.pa_schedules;
create policy pa_schedules_staff_insert on public.pa_schedules
  for insert to authenticated
  with check (public.pa_is_staff());

drop policy if exists pa_schedules_staff_update on public.pa_schedules;
create policy pa_schedules_staff_update on public.pa_schedules
  for update to authenticated
  using (public.pa_is_staff())
  with check (public.pa_is_staff());

drop policy if exists pa_schedule_rows_staff_insert on public.pa_schedule_rows;
create policy pa_schedule_rows_staff_insert on public.pa_schedule_rows
  for insert to authenticated
  with check (public.pa_is_staff());

drop policy if exists pa_schedule_rows_staff_delete on public.pa_schedule_rows;
create policy pa_schedule_rows_staff_delete on public.pa_schedule_rows
  for delete to authenticated
  using (public.pa_is_staff());

-- Updates: staff (full) + authenticated (customer comments via existing guard trigger)
drop policy if exists pa_schedule_rows_update on public.pa_schedule_rows;
drop policy if exists pa_schedule_rows_staff_update on public.pa_schedule_rows;
create policy pa_schedule_rows_update on public.pa_schedule_rows
  for update to authenticated
  using (true)
  with check (true);

grant select, insert, update on public.pa_schedules to authenticated;
grant select, insert, update, delete on public.pa_schedule_rows to authenticated;
