-- Uppsamling live: publicera `uppsamling_result`-ändringar via Realtime.
--
-- Ursprungligen medvetet UTAN publikation (uppsamling ändras i onsdagsräkningens dygnstakt,
-- inte i valnattens burst). Men om uppsamling mot förmodan kommer PRELIMINÄRT redan under
-- valnatten (edge tar den då via /p/) satt den bara i DB:n — klienten läste `uppsamling_result`
-- EN gång vid mount, så en långöppen flik vägde inte in den i organtotalerna förrän en reload.
-- Denna publikation + klientens självläkning (Realtime-event + periodisk resync + reconnect →
-- full omladdning av det lilla uppsamlings-aggregatet) stänger den luckan: natt-uppsamling syns
-- live utan reload. Säkerhetsgardering; normalfallet (onsdag, dygnstakt) påverkas inte.
--
-- RLS (anon SELECT using(true)) från skapelse-migrationen gäller även Realtime — anon får bara
-- de rader den redan får läsa. Default replica identity (PK) räcker: klienten laddar om hela
-- aggregatet på event, den behöver inte `old`-raden.
--
-- Idempotent: `add table` kastar om tabellen redan är publicerad, så guarda.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'uppsamling_result'
  ) then
    alter publication supabase_realtime add table uppsamling_result;
  end if;
end $$;
