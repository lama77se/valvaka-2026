-- Fixar bump_turnout_updated_at() (20260905120000_valnatt_hardening.sql): jämförelse-
-- tupeln uppdaterades aldrig när blanka/ej_anmalda_partier/ovriga_ogiltiga (12 sep,
-- 20260912090000_ogiltiga_roster.sql) eller roster_paverkar_mandat (13 sep,
-- 20260913140000_roster_paverkar_mandat.sql) lades till som kolumner.
--
-- En BEFORE UPDATE-trigger som returnerar null skippar HELA raden (Postgres-semantik),
-- inte bara updated_at-bumpen — så varje distrikt vars totalt_antal_roster/
-- antal_rostberattigade/status redan stabiliserats FÖRE denna fix blockerade tyst alla
-- senare skrivningar av de nyare kolumnerna. Källan till "RD Övriga-mysteriet"
-- (roster_paverkar_mandat null trots att ingesten skickat rätt värde varje poll-cykel) —
-- ca 1 307 av 6 273 RD-distrikt drabbade (de som redan var färdigräknade sedan innan
-- 13-sep-kolumnerna infördes). Utredning + bekräftelse: Val ANALYSIS (14 sep) — en
-- direkt SQL-UPDATE som superuser (inkl. en trivial "set blanka = blanka") vetades tyst
-- av samma trigger, vilket uteslöt edge-funktionen/PostgREST/RLS som orsak.
--
-- Ingen separat backfill behövs: nästa ordinarie ingest-poll per distrikt skickar redan
-- rätt roster_paverkar_mandat-värde — triggern (nu med rätt jämförelse) släpper igenom
-- den skrivningen i stället för att tyst kasta den, så de stuck distrikten självläker
-- vid nästa poll-cykel.
create or replace function public.bump_turnout_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.totalt_antal_roster, old.antal_rostberattigade, old.status,
      old.blanka, old.ej_anmalda_partier, old.ovriga_ogiltiga, old.roster_paverkar_mandat)
     is not distinct from
     (new.totalt_antal_roster, new.antal_rostberattigade, new.status,
      new.blanka, new.ej_anmalda_partier, new.ovriga_ogiltiga, new.roster_paverkar_mandat) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Samma granskning som Val ANALYSIS efterfrågade av systerfunktionerna:
-- bump_result_updated_at (20260905120000_valnatt_hardening.sql) jämför (roster, andel,
-- status, rapporteringstid) — samtliga fyra kolumner finns redan i result:s
-- ursprungliga schema (20260728140000_result.sql), inga nyare kolumner har lagts till
-- sedan → INTE drabbad av samma mönster, ingen ändring behövs.
-- bump_mandat_valse_updated_at (20260913130000_mandat_valse.sql) har ingen "hoppa över
-- oförändrad rad"-jämförelse alls (bumpar alltid ovillkorligt) → kan inte drabbas av
-- samma buggmönster.
