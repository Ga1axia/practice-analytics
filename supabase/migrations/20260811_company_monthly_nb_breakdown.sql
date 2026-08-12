-- Firm monthly NB category breakdown for Bill/NB Efficiency Analysis
alter table public.pa_company_monthly
  add column if not exists client_nb_hours double precision default 0,
  add column if not exists mbd_hours double precision default 0,
  add column if not exists pto_sick_hours double precision default 0,
  add column if not exists others_nb_hours double precision default 0,
  add column if not exists probono_hours double precision default 0,
  add column if not exists capacity_hours double precision default 0;
