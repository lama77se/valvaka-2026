-- Fas 5 — Realtime: publicera `result`-ändringar så kartklienten kan prenumerera
-- och färga distrikten i realtid (postgres_changes). RLS från Fas 4 (anon SELECT
-- using(true)) gäller ÄVEN Realtime — anon får bara de rader den redan får läsa.
--
-- Default replica identity (PK) räcker: postgres_changes levererar hela `new`-raden
-- vid INSERT/UPDATE, och klienten behöver inte `old` (den ackumulerar röster per
-- parti och räknar om vinnaren, ingen diff mot föregående värde). REPLICA IDENTITY
-- FULL vore bara nödvändig om vi ville ha gamla värden — hoppas över.
--
-- Idempotent: `add table` kastar om tabellen redan är publicerad, så guarda.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'result'
  ) then
    alter publication supabase_realtime add table result;
  end if;
end $$;
