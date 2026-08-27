-- Tighta ingest-result-kadensen 2 min → 30 s.
--
-- Snabbare kart-uppdatering under en PRELIMINÄR burst: fler cron-varv = kortare tid innan alla
-- ~313 /p/-organ hämtats (MAX_FILES=25/varv). Bara små /p/-filer i edge (slutligt tas av det
-- lokala skriptet) → 30 s slår aldrig i CPU-taket. Gäller nu (genrep-simmarna blir snabbare) och
-- carry:ar in i valnatten — inget separat natt-steg.
--
-- Idempotent (sätter bara OM schemat) och guardad (hoppar med notice om jobbet saknas). Byter
-- INTE jobbnamn ('ingest-result-genrep' är kosmetiskt — samma jobb kör val2026 lika bra;
-- unschedule+reschedule vore onödig risk). pg_cron ≥1.5 stödjer interval-scheman ('30 seconds').
-- Backa (valfritt): schedule => '*/2 * * * *'; utanför burst hittar cron ändå bara changed:0.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'ingest-result-genrep';
  if jid is null then
    raise notice 'cron-jobbet "ingest-result-genrep" saknas — hoppar (kör schedule_ingest_result-migrationen först).';
  else
    perform cron.alter_job(job_id => jid, schedule => '30 seconds');
    raise notice 'ingest-result-genrep → 30 s kadens.';
  end if;
end
$$;
