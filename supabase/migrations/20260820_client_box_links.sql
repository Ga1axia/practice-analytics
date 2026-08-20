-- Shared Box file links for the client portal Documents tab.
-- Staff (admin / employee) add and remove; customers may only read their client.

create table if not exists public.pa_client_box_links (
  id uuid primary key default gen_random_uuid(),
  project_key text not null,
  client_name text not null,
  title text not null,
  box_url text not null,
  section text not null default '',
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint pa_client_box_links_url_https check (box_url ~* '^https://'),
  constraint pa_client_box_links_url_box check (
    box_url ~* '^https://([a-z0-9-]+\.)*box\.com/'
    or box_url ~* '^https://([a-z0-9-]+\.)*boxcloud\.com/'
  )
);

create index if not exists pa_client_box_links_project_idx
  on public.pa_client_box_links (project_key, created_at desc);
create index if not exists pa_client_box_links_client_idx
  on public.pa_client_box_links (client_name);

alter table public.pa_client_box_links enable row level security;

drop policy if exists pa_client_box_links_select on public.pa_client_box_links;
create policy pa_client_box_links_select on public.pa_client_box_links
  for select to authenticated
  using (
    (select public.pa_is_staff())
    or (
      client_name is not null
      and client_name = (select public.pa_profile_client())
    )
  );

drop policy if exists pa_client_box_links_insert on public.pa_client_box_links;
create policy pa_client_box_links_insert on public.pa_client_box_links
  for insert to authenticated
  with check ((select public.pa_is_staff()));

drop policy if exists pa_client_box_links_update on public.pa_client_box_links;
create policy pa_client_box_links_update on public.pa_client_box_links
  for update to authenticated
  using ((select public.pa_is_staff()))
  with check ((select public.pa_is_staff()));

drop policy if exists pa_client_box_links_delete on public.pa_client_box_links;
create policy pa_client_box_links_delete on public.pa_client_box_links
  for delete to authenticated
  using ((select public.pa_is_staff()));

grant select, insert, update, delete on public.pa_client_box_links to authenticated;
