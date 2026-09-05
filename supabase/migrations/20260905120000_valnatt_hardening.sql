-- Valnatt-härdning (kodgranskning 5 sep 2026, "PR B"). Fem oberoende delar, alla idempotenta:
--
-- 1. VILLKORLIG updated_at-bump på result/turnout. Triggrarna bumpade updated_at på VARJE upsert
--    även när inget ändrats. Edge upsertar hela organ-filen (riks-RD ≈ 50k rader) varje gång val.se
--    publicerar om den → alla ~50k rader fick ny updated_at → varje klients nästa delta-poll
--    (`updated_at >= cursor`) hämtade hela RD-setet igen (~5 MB, 5+ requests). Med hundratals flikar
--    var det en full snapshot per klient var 45–90 s — precis lasten Realtime-borttaget skulle ta bort.
--    Nu: oförändrad rad → `return null` i BEFORE UPDATE → ingen ny tuple, inga indexposter, ingen
--    bump → deltan blir en äkta delta. Säkert med PostgREST-upsert: ON CONFLICT DO UPDATE sätter bara
--    kolumnerna i payloaden, så utelämnade kolumner (andel) jämförs old=old. Triggrar fyras i
--    bokstavsordning: *_bump_* före *_no_status_downgrade → null här kortsluter bara.
--
-- 2. INGEST-LEASE. pg_cron fyrar var 30 s via net.http_post (async) → invokeringar överlappade när en
--    körning tog > 30 s: båda räknade fram samma "changed"-lista, strömmade samma zip:ar, dubblerade
--    skrivlasten (positiv återkoppling) och kunde committa äldre payload sist. Lease via RPC (session-
--    advisory-lås överlever inte PostgREST-poolen). TTL 90 s > edge-budgeten 25 s; dör isolatet
--    släpps leasen av sig själv.
--
-- 3. AUTOVACUUM på de heta tabellerna. Default-tröskeln (50 + 20 %) ≈ 36k döda tupler för result;
--    under en flertimmars-burst hinner autovacuum inte med → heap/index-bloat 2–3× → långsammare
--    index-scans för varje pollande klient.
--
-- 4. anon statement_timeout 3 s → 10 s (plattformsdefault är 3 s). En snapshot-sida på 10k rader
--    som passerar 3 s under peak avbröts → klienten föll till retry-loopen. 10 s är skyddsnät.
--
-- 5. uppsamling_result: samma no-downgrade-skydd som result/turnout (saknades; efter onsdagen kunde
--    en ompublicerad /p/-fil skriva över slutliga uppsamlingsrader) + status not null. Samt en
--    daglig städning av cron.job_run_details (30 s-kadens ⇒ ~2 900 rader/dygn, obegränsat annars).

-- ---------------------------------------------------------------------------------------------
-- 1. Villkorlig bump
-- ---------------------------------------------------------------------------------------------
create or replace function public.bump_result_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.roster, old.andel, old.status, old.rapporteringstid)
     is not distinct from (new.roster, new.andel, new.status, new.rapporteringstid) then
    return null; -- oförändrad rad: ingen skrivning, ingen bump
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.bump_turnout_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.totalt_antal_roster, old.antal_rostberattigade, old.status)
     is not distinct from (new.totalt_antal_roster, new.antal_rostberattigade, new.status) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Ingest-lease
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ingest_lease (
  name        text primary key,
  expires_at  timestamptz not null,
  claimed_at  timestamptz not null default now()
);
alter table public.ingest_lease enable row level security; -- ingen policy → bara service_role/definer
grant all on public.ingest_lease to service_role;

-- true = leasen är din (ny eller utgången). false = någon annan håller den. Radlåset på konflikt
-- serialiserar två samtidiga anrop → exakt en vinner.
create or replace function public.ingest_claim(p_name text, p_ttl_seconds integer default 90)
returns boolean language plpgsql security definer set search_path = '' as $$
declare got boolean;
begin
  insert into public.ingest_lease (name, expires_at, claimed_at)
  values (p_name, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (name) do update
    set expires_at = excluded.expires_at, claimed_at = now()
    where public.ingest_lease.expires_at < now()
  returning true into got;
  return coalesce(got, false);
end $$;

create or replace function public.ingest_release(p_name text)
returns void language sql security definer set search_path = '' as $$
  update public.ingest_lease set expires_at = now() where name = p_name;
$$;

revoke all on function public.ingest_claim(text, integer) from public, anon, authenticated;
revoke all on function public.ingest_release(text) from public, anon, authenticated;
grant execute on function public.ingest_claim(text, integer) to service_role;
grant execute on function public.ingest_release(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Autovacuum
-- ---------------------------------------------------------------------------------------------
alter table public.result set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 2000,
  autovacuum_analyze_scale_factor = 0.05, autovacuum_vacuum_cost_delay = 0);
alter table public.turnout set (
  autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_scale_factor = 0.05, autovacuum_vacuum_cost_delay = 0);
alter table public.uppsamling_result set (
  autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 500);

-- ---------------------------------------------------------------------------------------------
-- 4. anon statement_timeout (skyddat: får inte fälla resten av migrationen om rollen inte får ändras)
-- ---------------------------------------------------------------------------------------------
do $$
begin
  execute $q$alter role anon set statement_timeout = '10s'$q$;
exception when others then
  raise notice 'kunde inte sätta anon statement_timeout (%): sätt manuellt i SQL-editorn', sqlerrm;
end $$;
notify pgrst, 'reload config';

-- ---------------------------------------------------------------------------------------------
-- 5. uppsamling_result no-downgrade + cron-städning
-- ---------------------------------------------------------------------------------------------
update public.uppsamling_result set status = 'preliminar' where status is null;
alter table public.uppsamling_result alter column status set not null;

create or replace function public.uppsamling_no_status_downgrade() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.status = 'slutlig' and new.status is distinct from 'slutlig' then
    return null; -- behåll den slutliga raden
  end if;
  return new;
end $$;

drop trigger if exists uppsamling_result_no_status_downgrade on public.uppsamling_result;
create trigger uppsamling_result_no_status_downgrade
  before update on public.uppsamling_result
  for each row execute function public.uppsamling_no_status_downgrade();

-- cron.schedule med befintligt namn ersätter jobbet (pg_cron ≥ 1.4) → idempotent.
select cron.schedule(
  'purge-job-run-details',
  '13 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$
);
