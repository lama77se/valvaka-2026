-- Per-distrikt rapporteringstid från val.se (valdistrikt[].rapporteringsTid, t.ex.
-- "2026-08-25T10:21:59"). Tidigare visade avgångstavlan bara ett klientstämplat
-- klockslag på distrikt som tickade in LIVE medan sidan var öppen — redan
-- inrapporterade (seedade) rader fick "—". Med val.se:s egna klockslag lagrade får
-- VARJE rad en riktig rapporteringstid, även för sena påtittare.
--
-- Typ: `timestamp` UTAN tidszon — val.se ger naiv svensk lokaltid utan offset. Vi
-- lagrar den som den är och klienten läser HH:MM direkt ur strängen (ingen tz-
-- konvertering som annars skulle skifta klockslaget). Nullbar (distrikt utan tid).
-- Kolumnen ingår automatiskt i result-tabellens Realtime-publikation + RLS.
alter table public.result
  add column if not exists rapporteringstid timestamp without time zone;
