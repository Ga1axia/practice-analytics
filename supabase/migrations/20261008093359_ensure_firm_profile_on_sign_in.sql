-- Self-heal firm portal profiles when Auth exists but pa_profiles row is missing
-- (e.g. trigger not applied yet, or user created before auto-provision).

create or replace function public.pa_role_for_firm_email(p_email text)
returns text
language plpgsql
immutable
as $$
declare
  email_norm text := lower(trim(coalesce(p_email, '')));
  local_part text := split_part(email_norm, '@', 1);
begin
  if email_norm not like '%@mdesignsarchitects.com' then
    return null;
  end if;
  return case local_part
    when 'taihei' then 'admin'
    when 'junaidq' then 'admin'
    when 'malikajunaid' then 'exec'
    when 'malika' then 'exec'
    when 'avery' then 'project_lead'
    when 'avery.cobe' then 'project_lead'
    else 'employee'
  end;
end;
$$;

create or replace function public.pa_employee_name_for_firm_email(p_email text, p_display text)
returns text
language plpgsql
immutable
as $$
declare
  email_norm text := lower(trim(coalesce(p_email, '')));
  local_part text := split_part(email_norm, '@', 1);
  display text := nullif(trim(coalesce(p_display, '')), '');
begin
  return case local_part
    when 'taihei' then coalesce(display, 'Taihei Eastwood')
    when 'junaidq' then coalesce(display, 'Junaid Qureshi')
    when 'malikajunaid' then 'Malika Junaid'
    when 'malika' then 'Malika Junaid'
    when 'avery' then 'Avery Cobe'
    when 'avery.cobe' then 'Avery Cobe'
    when 'arnita' then 'Arnita Serri'
    when 'nini' then 'Ni Ni'
    when 'zhengrui' then 'Zhengrui He'
    when 'maria' then 'Maria Abreu'
    when 'maurits' then 'Maurits de Gans'
    else coalesce(display, initcap(replace(local_part, '.', ' ')))
  end;
end;
$$;

create or replace function public.pa_ensure_firm_profile()
returns public.pa_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  u record;
  role_seed text;
  emp_name text;
  display text;
  row public.pa_profiles;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into row from public.pa_profiles where id = uid;
  if found then
    return row;
  end if;

  select id, email, raw_user_meta_data into u from auth.users where id = uid;
  if not found then
    raise exception 'Auth user not found';
  end if;

  role_seed := public.pa_role_for_firm_email(u.email);
  if role_seed is null then
    return null;
  end if;

  display := nullif(
    trim(coalesce(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      u.raw_user_meta_data->>'display_name',
      ''
    )),
    ''
  );

  emp_name := public.pa_employee_name_for_firm_email(u.email, display);

  insert into public.pa_profiles (id, email, role, display_name, employee_name, client_name)
  values (
    uid,
    u.email,
    role_seed,
    coalesce(display, emp_name),
    emp_name,
    null
  )
  on conflict (id) do update
  set
    email = excluded.email,
    role = case
      when excluded.role in ('admin', 'exec', 'project_lead') then excluded.role
      else public.pa_profiles.role
    end,
    display_name = coalesce(public.pa_profiles.display_name, excluded.display_name),
    employee_name = coalesce(nullif(trim(public.pa_profiles.employee_name), ''), excluded.employee_name)
  returning * into row;

  return row;
end;
$$;

revoke all on function public.pa_ensure_firm_profile() from public;
grant execute on function public.pa_ensure_firm_profile() to authenticated;

-- Backfill any firm Auth users still missing profiles.
insert into public.pa_profiles (id, email, role, display_name, employee_name, client_name)
select
  u.id,
  u.email,
  public.pa_role_for_firm_email(u.email),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    public.pa_employee_name_for_firm_email(u.email, null)
  ),
  public.pa_employee_name_for_firm_email(
    u.email,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
  ),
  null
from auth.users u
where public.pa_role_for_firm_email(u.email) is not null
on conflict (id) do update
set
  role = case
    when excluded.role in ('admin', 'exec', 'project_lead') then excluded.role
    else public.pa_profiles.role
  end,
  email = excluded.email,
  display_name = coalesce(public.pa_profiles.display_name, excluded.display_name),
  employee_name = coalesce(nullif(trim(public.pa_profiles.employee_name), ''), excluded.employee_name);

update public.pa_profiles
set role = 'admin',
    employee_name = coalesce(nullif(trim(employee_name), ''), 'Taihei Eastwood'),
    display_name = coalesce(nullif(trim(display_name), ''), 'Taihei Eastwood')
where lower(email) = 'taihei@mdesignsarchitects.com';
