-- Auto-provision pa_profiles for M·Designs Microsoft (Azure) sign-ins.
-- New auth users with @mdesignsarchitects.com get an employee profile; role stays
-- employee until an admin promotes them. Clients keep using password accounts.

create or replace function public.pa_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_norm text := lower(coalesce(new.email, ''));
  display text := nullif(
    trim(coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'display_name',
      ''
    )),
    ''
  );
  local_part text := split_part(email_norm, '@', 1);
  emp_name text;
begin
  if email_norm not like '%@mdesignsarchitects.com' then
    return new;
  end if;

  emp_name := case local_part
    when 'arnita' then 'Arnita Serri'
    when 'nini' then 'Ni Ni'
    when 'zhengrui' then 'Zhengrui He'
    when 'maria' then 'Maria Abreu'
    when 'malika' then 'Malika Junaid'
    when 'maurits' then 'Maurits de Gans'
    else coalesce(display, initcap(replace(local_part, '.', ' ')))
  end;

  insert into public.pa_profiles (id, email, role, display_name, employee_name, client_name)
  values (
    new.id,
    new.email,
    'employee',
    coalesce(display, emp_name),
    emp_name,
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.pa_handle_new_auth_user() from public;
revoke all on function public.pa_handle_new_auth_user() from anon, authenticated;

drop trigger if exists pa_on_auth_user_created on auth.users;
create trigger pa_on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.pa_handle_new_auth_user();

-- Backfill firm emails that already exist in Auth without a profile.
insert into public.pa_profiles (id, email, role, display_name, employee_name, client_name)
select
  u.id,
  u.email,
  'employee',
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    case split_part(lower(u.email), '@', 1)
      when 'arnita' then 'Arnita Serri'
      when 'nini' then 'Ni Ni'
      when 'zhengrui' then 'Zhengrui He'
      when 'maria' then 'Maria Abreu'
      when 'malika' then 'Malika Junaid'
      when 'maurits' then 'Maurits de Gans'
      else initcap(replace(split_part(u.email, '@', 1), '.', ' '))
    end
  ),
  case split_part(lower(u.email), '@', 1)
    when 'arnita' then 'Arnita Serri'
    when 'nini' then 'Ni Ni'
    when 'zhengrui' then 'Zhengrui He'
    when 'maria' then 'Maria Abreu'
    when 'malika' then 'Malika Junaid'
    when 'maurits' then 'Maurits de Gans'
    else coalesce(
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      initcap(replace(split_part(u.email, '@', 1), '.', ' '))
    )
  end,
  null
from auth.users u
where lower(u.email) like '%@mdesignsarchitects.com'
on conflict (id) do nothing;
