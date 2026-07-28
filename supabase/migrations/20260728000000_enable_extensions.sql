-- Fas 0 — infrastrukturgrund.
-- Endast postgis här: det aktiveras pålitligt via `create extension` i en
-- migration och behövs först (Fas 1, reprojicering SWEREF99 TM -> WGS84,
-- arkitektur.md §6).
create extension if not exists postgis;

-- pg_cron och pg_net (schemalagd ingestion, arkitektur.md §3) aktiveras i Fas 3.
-- På Supabase cloud slås de oftast på via Dashboard -> Database -> Extensions
-- (eller `create extension ... with schema extensions`), inte alltid via en ren
-- migration. Lämnas därför utanför Fas 0 för att första `db push` inte ska falla.
