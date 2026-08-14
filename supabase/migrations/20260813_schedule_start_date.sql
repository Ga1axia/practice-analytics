-- Project schedule kickoff / start date (drives preset autofill).
alter table public.pa_schedules
  add column if not exists start_date text not null default '';

comment on column public.pa_schedules.start_date is
  'Project start date as M/D/YYYY; autofilled schedule deadlines cascade from this.';
