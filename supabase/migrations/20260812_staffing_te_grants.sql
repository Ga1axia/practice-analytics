-- Ensure authenticated admins can read persisted time entries (Staffing board).
grant select on public.pa_time_entries to authenticated;
grant select on public.pa_bqe_sync_runs to authenticated;
grant execute on function public.pa_is_admin() to authenticated;

-- Time entries are written by service role during BQE sync only.
revoke insert, update, delete, truncate on public.pa_time_entries from anon, authenticated;
revoke all on public.pa_time_entries from anon;
