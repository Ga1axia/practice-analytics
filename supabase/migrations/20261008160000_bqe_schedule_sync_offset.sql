-- Cursor for daily / chunked CORE → schedule sync (server-only).
alter table public.pa_bqe_connection
  add column if not exists schedule_core_sync_offset int not null default 0;

comment on column public.pa_bqe_connection.schedule_core_sync_offset is
  'Next 0-based index into ACTIVE project headers for chunked schedule CORE resync.';
