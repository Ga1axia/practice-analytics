-- Interior Design phase title is just "Interior Design" (drop spreadsheet note).

update public.pa_schedule_rows
set task = 'Interior Design'
where row_kind = 'phase'
  and task ~* '^interior design\s*\(';
