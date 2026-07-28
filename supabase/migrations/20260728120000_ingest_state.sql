-- Fas 3 — conditional-GET-state per pollad fil.
--
-- Verifierat mot val.se juli 2026: ETag returneras men honoreras INTE
-- (If-None-Match ger 200). Last-Modified fungerar (If-Modified-Since ger 304).
-- Därför driver `last_modified` skip-logiken; `etag` sparas bara för audit.
create table ingest_state (
  file_path     text primary key,   -- källfilens URL
  last_modified text,               -- senaste Last-Modified-headern (driver If-Modified-Since)
  etag          text,               -- audit; honoreras inte av val.se-CDN:en
  last_ok       timestamptz,        -- senaste lyckade hämtning (200 eller 304)
  last_status   integer             -- senaste HTTP-status (200/304/fel)
);

-- Endast server-side (edge function som service_role) rör denna. RLS på, ingen
-- anon-policy; auto-expose är av så inga auto-grants — service_role behöver explicit.
alter table ingest_state enable row level security;
grant all on ingest_state to service_role;
