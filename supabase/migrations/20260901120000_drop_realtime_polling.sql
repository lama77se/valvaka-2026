-- Realtime → BORTTAGET. Klienten pollar i stället via den inkrementella resyncen (updated_at-delta)
-- var 45–90 s (jittrat) — mekanismen finns redan (#60), nu PRIMÄR i stället för backup. Varför:
--   1. Realtime/WAL logisk-decoding var den återkommande CPU-spiken (genrep ~90 %, och RD-churnen
--      1 sep). Att ta bort publikationen tar bort den lasten helt.
--   2. ≤100-rader-för-Realtime-batchningen i edge var ROTORSAKEN till 2s-CPU-taket: RD:s ~50k
--      result-rader vid 100/batch = ~505 upsert-anrop = >2 s CPU → filen markerades aldrig done →
--      evig re-churn. Utan Realtime → 1000/batch → ~51 anrop → klar med marginal (edge-fix i samma PR).
-- Polling-last skalar med klienter/intervall (lätt, ~15 q/s vid 1000 klienter), inte
-- writes×subscribers (tungt). UX förblir "live": staggrad reveal + pulsande live-indikator (frontend).

-- 1. Ta bort tabellerna ur Realtime-publikationen → stoppar WAL-decoding-lasten. Guardat + idempotent.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='result')
    then alter publication supabase_realtime drop table result; end if;
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='uppsamling_result')
    then alter publication supabase_realtime drop table uppsamling_result; end if;
end $$;

-- 2. Index för den inkrementella resync-deltan (eq valtyp + gte updated_at + order updated_at). UTAN
--    detta blir polling-at-scale en tabellscan → lika tungt som det vi tar bort. KRITISKT för vinsten.
--    (uppsamling_result behöver inget — dess resync är full-omladdning, inte updated_at-delta.)
create index if not exists result_valtyp_updated_at_idx on result (valtyp, updated_at);
create index if not exists turnout_valtyp_updated_at_idx on turnout (valtyp, updated_at);
