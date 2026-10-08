alter table public.pa_profiles
  add column if not exists portal_prefs jsonb not null default '{}'::jsonb;

comment on column public.pa_profiles.portal_prefs is
  'Admin-set employee portal defaults (e.g. interior design project/hours focus).';
