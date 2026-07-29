-- Demo customer: one project only (Elena Vargas)
-- Safe to re-run.

insert into public.pa_projects (
  project, client, city, manager, status, type, phase,
  contract, spent, billed, pct_used, pct_billed,
  retainer_paid, retainer_balance, ar, profit, margin
)
values (
  'Vargas Residence — Oak Avenue Remodel',
  'Elena Vargas',
  'Palo Alto',
  'Maria Abreu',
  'ACTIVE',
  'FIXED',
  'Design Development',
  185000, 62400, 74000, 0.34, 0.4,
  15000, 8500, 12000, 11800, 0.16
)
on conflict (project) do update set
  client = excluded.client,
  city = excluded.city,
  manager = excluded.manager,
  status = excluded.status,
  type = excluded.type,
  phase = excluded.phase,
  contract = excluded.contract,
  spent = excluded.spent,
  billed = excluded.billed,
  pct_used = excluded.pct_used,
  pct_billed = excluded.pct_billed,
  retainer_paid = excluded.retainer_paid,
  retainer_balance = excluded.retainer_balance,
  ar = excluded.ar,
  profit = excluded.profit,
  margin = excluded.margin;

insert into public.pa_project_monthly_billed (project, month, amount)
values
  ('Vargas Residence — Oak Avenue Remodel', '2026-04', 22000),
  ('Vargas Residence — Oak Avenue Remodel', '2026-05', 28000),
  ('Vargas Residence — Oak Avenue Remodel', '2026-06', 24000)
on conflict (project, month) do update set amount = excluded.amount;

insert into public.pa_client_monthly_billed (client, month, amount)
values
  ('Elena Vargas', '2026-04', 22000),
  ('Elena Vargas', '2026-05', 28000),
  ('Elena Vargas', '2026-06', 24000)
on conflict (client, month) do update set amount = excluded.amount;

update public.pa_profiles
set client_name = 'Elena Vargas',
    display_name = 'Elena Vargas'
where email = 'customer@mdesigns.test';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('client_name', 'Elena Vargas', 'role', 'customer'),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object('display_name', 'Elena Vargas'),
    updated_at = now()
where email = 'customer@mdesigns.test';
