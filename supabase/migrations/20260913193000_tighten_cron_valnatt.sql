-- VALNATT — tighta ingest-result-kadensen 2 min → 30 s.
--
-- Snabbare kart-uppdatering under den PRELIMINÄRA bursten: fler cron-varv = kortare tid
-- innan alla ~313 /p/-organ hämtats (MAX_FILES=25/varv). Preliminärt strömmas in av edge;
-- slutligt tas av det lokala skriptet, så 30 s slår aldrig i CPU-taket (bara små /p/-filer).
--
-- ⚠️ MERGAS PÅ VALNATTEN (runbook N3, valfritt) — db-migrate.yml auto-applar vid push till
-- main. Draft tills dess: mergad nu skulle bara tighta genrep-pollningen i förtid (ofarligt
-- men i onödan). Idempotent: sätter bara OM schemat på det befintliga jobbet.
--
-- Byter INTE jobbnamn ('ingest-result-genrep' är kosmetiskt — samma jobb kör val2026 lika
-- bra; unschedule+reschedule vore onödig risk/lucka på natten). pg_cron ≥1.5 stödjer
-- interval-scheman ('30 seconds'). Försiktigare alternativ: '1 minute'. Backa efter natten
-- (valfritt) med schedule => '*/2 * * * *'; utanför burst hittar cron ändå bara changed:0.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'ingest-result-genrep';
  if jid is null then
    raise notice 'cron-jobbet "ingest-result-genrep" saknas — hoppar (kör schedule_ingest_result-migrationen först).';
  else
    perform cron.alter_job(job_id => jid, schedule => '30 seconds');
    raise notice 'ingest-result-genrep → 30 s kadens (valnatt).';
  end if;
end
$$;
