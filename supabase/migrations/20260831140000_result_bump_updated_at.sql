-- Auto-resync-stöd (klientens självläkning mot Realtime-släpning).
--
-- Efter första snapshot lever klienten bara på Realtime-event. Realtime TAPPAR stora txns
-- (>~100 rader) under bursts → en långöppen flik driver efter DB och läks idag bara av en full
-- sidladdning. Klienten kör därför en periodisk INKREMENTELL resync: hämtar deltan via
-- `updated_at > cursor` och spelar upp den genom samma per-distrikt-väg som Realtime.
--
-- Problemet: edge-upserten (ingest-result) sätter INTE `updated_at` i payloaden, så kolumnens
-- `default now()` bumpar bara vid INSERT. En in-place-omräkning (samma PK, ny röstsiffra → UPDATE)
-- skulle då INTE bumpa updated_at och cursorn missa den. Genrepets reinsert-churn bumpar redan
-- via INSERT, men skarpa nattens preliminär-omräkningar (fler röster räknade i samma distrikt)
-- är UPDATE:ar. Denna trigger gör `updated_at` auktoritativ för ALLA mutationer så cursorn ser
-- även omräkningar. Kort ACCESS EXCLUSIVE-lås, ingen tabellomskrivning.

create or replace function bump_result_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists result_bump_updated_at on result;
create trigger result_bump_updated_at
  before update on result
  for each row execute function bump_result_updated_at();
