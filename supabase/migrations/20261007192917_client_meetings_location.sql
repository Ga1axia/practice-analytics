-- Where a client meeting happened: site visit vs in office.
alter table public.pa_client_meetings
  add column if not exists location text not null default '';

alter table public.pa_client_meetings
  drop constraint if exists pa_client_meetings_location_check;

alter table public.pa_client_meetings
  add constraint pa_client_meetings_location_check
  check (location in ('', 'site', 'office'));
