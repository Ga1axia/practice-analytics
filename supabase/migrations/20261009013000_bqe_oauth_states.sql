-- Short-lived OAuth state (server-side; avoids cookie loss on BQE redirect).
create table if not exists public.pa_bqe_oauth_states (
  state text primary key,
  user_id uuid not null,
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists pa_bqe_oauth_states_expires_idx
  on public.pa_bqe_oauth_states (expires_at);

alter table public.pa_bqe_oauth_states enable row level security;

drop policy if exists pa_bqe_oauth_states_deny on public.pa_bqe_oauth_states;
create policy pa_bqe_oauth_states_deny on public.pa_bqe_oauth_states
  for all using (false) with check (false);

comment on table public.pa_bqe_oauth_states is
  'BQE OAuth CSRF state; service role only.';
