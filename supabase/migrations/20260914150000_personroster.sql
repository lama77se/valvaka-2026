-- Personröster — handover 14 sep (Lars, via Val ANALYSIS). Ligger REDAN i samma
-- rostfordelning-JSON scripts/ingest-slutlig.mjs redan hämtar/parsar för /s/-filer (bekräftat
-- mot verklig data) — ingen ny URL/fil. Per parti (partiRoster[]) finns ett redan-summerat
-- fält summeradePersonroster[]: {namn, kandidatnummer, antalPersonroster}, redan aggregerat
-- över partiets ev. flera listor i distriktet (en "riktig" lista + en syntetisk "90000"-
-- katalog för okryssade röster). v1 medvetet minimal: bara summeradePersonroster, ingen
-- listRoster[].personroster[]-sublistedetalj (intern redovisningsdetalj, behövs varken för
-- kryss-spärr-bedömning eller visning).
--
-- kandidatnummer är den ENDA stabila nyckeln — samma kandidat kan stavas OLIKA i olika delar
-- av samma fil (bekräftat, flera exempel: "Erik Lindgren" vs "Erik Peter Lindgren"; en accent-
-- variant "Ilona Szatmári"/"Szatmari Waldau"). namn är ren visningstext, aldrig en join-nyckel
-- — därför ingen unik-constraint på namn, bara kandidatnummer i primärnyckeln.
--
-- Personröster förekommer ALDRIG i preliminära filer (resultat-ingest-genrep.md rad 145) →
-- status blir i praktiken alltid 'slutlig'. Fältet finns ändå (symmetri med result/turnout/
-- mandat_valse, framtidssäkring) i stället för att hårdkoda antagandet i schemat.
--
-- namn är denormaliserad (ingen egen kandidat-referenstabell ännu — kandidaturer.csv-
-- ingestion är fortfarande bara "Fas 3" i implementationsplan.md, inte byggd).
create table personroster (
  valtyp              text not null,
  valdistriktskod     text not null references district (valdistriktskod),
  partikod            text not null references party (partikod),
  kandidatnummer      integer not null,
  namn                text not null,
  antal_personroster  integer not null,
  status              text not null,
  updated_at          timestamptz not null default now(),
  primary key (valtyp, valdistriktskod, partikod, kandidatnummer)
);

-- ⚠️ LÄRDOM FRÅN IKVÄLL (PR #187-utredningen, 20260914090000_fix_turnout_bump_trigger.sql):
-- en tidigare "hoppa över om oförändrad"-trigger (bump_turnout_updated_at, 5 sep) glömde
-- inkludera SENARE tillagda kolumner i sin jämförelse-tupel, vilket permanent blockerade
-- skrivningar av dem. Var explicit och FULLSTÄNDIG här från start — jämför ALLA icke-
-- nyckel-kolumner.
create or replace function public.bump_personroster_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.namn, old.antal_personroster, old.status) is not distinct from (new.namn, new.antal_personroster, new.status) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists personroster_bump_updated_at on personroster;
create trigger personroster_bump_updated_at
  before update on personroster
  for each row execute function bump_personroster_updated_at();

-- Ingen no_status_downgrade-trigger (till skillnad från result/turnout/mandat_valse):
-- personröster skrivs BARA från ingest-slutlig.mjs (aldrig från edge:ns preliminära väg),
-- så det finns ingen konkurrerande skrivväg som kan skriva över en redan satt rad med
-- sämre data.

alter table personroster enable row level security;
create policy "public read" on personroster for select to anon, authenticated using (true);
grant select on personroster to anon, authenticated;
grant all on personroster to service_role;
