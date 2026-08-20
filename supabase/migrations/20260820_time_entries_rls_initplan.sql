-- pa_time_entries is ~90k+ rows. The employee SELECT policy called
-- pa_is_admin() / pa_my_employee_name() per row and compared with
-- lower(trim(employee_name)), which cannot use the employee_name index.
-- Unfiltered count=exact from the employee portal then hits the 8s
-- PostgREST statement timeout (HTTP 500).
--
-- Wrap helpers in (select ...) so Postgres evaluates them once (initplan),
-- and compare employee_name with equality so the existing
-- (employee_name, work_date) index can be used.

drop policy if exists pa_time_entries_select on public.pa_time_entries;
create policy pa_time_entries_select on public.pa_time_entries
  for select to authenticated
  using (
    (select public.pa_is_admin())
    or employee_name = (select public.pa_my_employee_name())
  );

drop policy if exists pa_bqe_sync_runs_admin_select on public.pa_bqe_sync_runs;
create policy pa_bqe_sync_runs_admin_select on public.pa_bqe_sync_runs
  for select to authenticated
  using ((select public.pa_is_admin()));
