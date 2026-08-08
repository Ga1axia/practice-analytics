-- Store BQE CORE OAuth tokens (server-side only via service role).
create table if not exists public.pa_bqe_connection (
  id int primary key default 1 check (id = 1), -- single-company singleton
  access_token text not null,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  scope text,
  api_endpoint text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_message text
);

alter table public.pa_bqe_connection enable row level security;

-- No direct client access — API routes use service role.
drop policy if exists pa_bqe_connection_deny_all on public.pa_bqe_connection;
create policy pa_bqe_connection_deny_all on public.pa_bqe_connection
  for all using (false) with check (false);

comment on table public.pa_bqe_connection is
  'BQE CORE OAuth tokens for live sync. Written only by server (service role).';
