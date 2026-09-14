-- Personröster för UPPSAMLINGSDISTRIKT (sena/olösta röster) — Beslut 0, handover 14 sep
-- (Lars, via Val ANALYSIS): personroster (20260914150000) fångade bara geografiska distrikt
-- (samma loop-gren som rows/turnoutRows), aldrig uppsamlingsdistrikten — så en kandidats
-- personröster från sena/utlandsröster saknades helt, tyst. Samma bugklass vi jagat två
-- gånger ikväll (turnout-triggern, RF/KF-överhänget): ett "vårt tal vs val.se:s tal"-gap
-- som annars upptäcks sent, av misstag. Fixas FÖRST, isolerat, innan RPC/frontend-arbetet
-- (kryssspärrens täljare OCH nämnare har samma blinda fläck tills detta är löst).
--
-- EGEN tabell, samma skäl som uppsamling_result (20260826130000) — INTE en utökning av
-- personroster: uppsamlingsdistrikt har ingen geometri/FK mot district (koden är kort och
-- ÅTERANVÄNDS mellan RD-/RF-/KF-filer, bara unik INOM en valtyp — personroster.valdistriktskod
-- har en FK mot district som uppsamlingskoder aldrig kan uppfylla). kretskod är med från
-- start (till skillnad från uppsamling_result, som fick den i en separat efterhandsmigration
-- 20260912110000) — samma betydelse: valkretsen sena röster är RESOLVDA till, om känd; null
-- = olöst, väger bara in i organets spärr/mål (aldrig en specifik valkrets).
create table uppsamling_personroster (
  valtyp              text not null,
  kod                 text not null,            -- uppsamlingsdistriktets kod (unik inom valtyp)
  kommunkod           text not null,            -- 4 siffror → KF-organ
  lankod              text not null,            -- 2 siffror → RF-organ
  kretskod            text,                     -- valkretskod, om löst (se uppsamling_result.kretskod)
  partikod            text not null references party (partikod),
  kandidatnummer      integer not null,
  namn                text not null,            -- denormaliserad (som personroster.namn) — se dess kommentar om namn-fällan
  antal_personroster  integer not null,
  status              text not null,
  updated_at          timestamptz not null default now(),
  primary key (valtyp, kod, partikod, kandidatnummer)
);

create index uppsamling_personroster_kommun_idx on uppsamling_personroster (valtyp, kommunkod);
create index uppsamling_personroster_lan_idx on uppsamling_personroster (valtyp, lankod);
create index uppsamling_personroster_kretskod_idx
  on uppsamling_personroster (valtyp, kretskod)
  where kretskod is not null;

-- Fullständig kolumnjämförelse från start (lärdomen från ikväll, se personroster-migrationen
-- och 20260914090000_fix_turnout_bump_trigger.sql) — jämför ALLA icke-nyckel-kolumner.
create or replace function public.bump_uppsamling_personroster_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.kretskod, old.namn, old.antal_personroster, old.status) is not distinct from (new.kretskod, new.namn, new.antal_personroster, new.status) then
    return null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists uppsamling_personroster_bump_updated_at on uppsamling_personroster;
create trigger uppsamling_personroster_bump_updated_at
  before update on uppsamling_personroster
  for each row execute function bump_uppsamling_personroster_updated_at();

-- Ingen no_status_downgrade-trigger, samma motivering som personroster: skrivs bara från
-- ingest-slutlig.mjs, ingen konkurrerande preliminär skrivväg.

alter table uppsamling_personroster enable row level security;
create policy "public read" on uppsamling_personroster for select to anon, authenticated using (true);
grant select on uppsamling_personroster to anon, authenticated;
grant all on uppsamling_personroster to service_role;
