-- Value Engineering is a Contractor Selection task (with subtasks), not its own phase.
-- Older spreadsheet imports stored it as row_kind = 'phase'.

update public.pa_schedule_rows
set row_kind = 'task'
where row_kind = 'phase'
  and task ~* '^value engineering\b';
