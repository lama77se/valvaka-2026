-- Valmyndighetens EGEN mandatfördelning — en förberedd, DORMANT alternativ källa till vår
-- egen beräkning (src/lib/mandate.ts, verifierad mot 2022-facit). Lars (13 sep, valnatten):
-- "vi mergar den nu men lägger den dormant med flaggan för mandatkälla" — oro att vår egen
-- beräkning skulle kunna avvika något från val.se:s live-publicerade siffror; en säker väg
-- att peka om till dem OM det visar sig behövas, utan att aktivera det nu.
--
-- Källan finns REDAN i organ-zip:arna ingest-result redan hämtar för röster
-- (mandatfordelning_<kod>_<VT>.json, samma zip som rostfordelning_<kod>_<VT>.json) — ingen
-- extra nätverksbudget. Format kartlagt i scripts/verify-mandatfordelning-live.ts:
--   valomrade.mandatfordelning.partiLista            (organnivå — riket/region/kommun)
--   valomrade.valkretsLista[].mandatfordelning.partiLista  (valkretsnivå, bara delade organ)
-- — matchar 1:1 klientens egen MANDAT_LEVELS-modell (organnivå + valkretsnivå, se
-- src/lib/areaView.ts). Koderna (valomrade.kod / valkretsLista[].kod) är REDAN i samma
-- paddade format som klientens egna area.code (2/4/6-siffrigt, se ResultsProvider.tsx:s
-- vk_rd/vk_rf/vk_kf-paddning) — ingen omformatering behövs. RD:s organnivå (riket) saknar
-- en meningsfull områdeskod i filen → lagras med den fasta sentinelen 'riket'.
create table mandat_valse (
  valtyp                 text not null,             -- 'RD' | 'RF' | 'KF'
  niva                   text not null,              -- 'organ' | 'valkrets'
  omradeskod             text not null,              -- 'riket' (RD/organ) | länskod/kommunkod (RF/KF/organ) | valkretskod (alla/valkrets)
  partikod               text not null references party (partikod),
  antal_mandat           integer not null,
  antal_fasta_mandat     integer,
  antal_utjamningsmandat integer,
  status                 text not null,              -- 'preliminar' | 'slutlig' (spegel av result.status)
  updated_at             timestamptz not null default now(),
  primary key (valtyp, niva, omradeskod, partikod)
);

-- Samma skydd mot sen preliminär re-ingest som result/turnout redan har.
create or replace function mandat_valse_no_status_downgrade() returns trigger
  language plpgsql as $$
begin
  if OLD.status = 'slutlig' and NEW.status is distinct from 'slutlig' then
    return null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists mandat_valse_no_status_downgrade on mandat_valse;
create trigger mandat_valse_no_status_downgrade
  before update on mandat_valse
  for each row execute function mandat_valse_no_status_downgrade();

-- Samma updated_at-auktoritet som result/turnout (framtida resync-stöd, se motivering där).
create or replace function bump_mandat_valse_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mandat_valse_bump_updated_at on mandat_valse;
create trigger mandat_valse_bump_updated_at
  before update on mandat_valse
  for each row execute function bump_mandat_valse_updated_at();

-- Klient läser (bara när mandat_kalla='aktiv', se nedan); edge/ingest skriver som service_role.
alter table mandat_valse enable row level security;
create policy "public read" on mandat_valse for select to anon, authenticated using (true);
grant select on mandat_valse to anon, authenticated;
grant all on mandat_valse to service_role;

-- Trestegsflagga (INTE bara på/av) för mandatkälla:
--   'av'     (DEFAULT/startläge nu) — edge FÖRSÖKER INTE ens parsa mandatfilen. Noll kostnad.
--   'shadow' — edge parsar + lagrar (tyst datainsamling), frontend läser ÄNDÅ vår egen
--              beräkning. Ger confidence-building utan att exponera användare för otestad kod.
--   'aktiv'  — frontend växlar till att läsa mandat_valse. Bara detta steg är användarsynligt.
-- Flippa läge är en DATABAS-ändring (denna kolumn), inte en deploy — medvetet: en flagga går
-- att slå av direkt om något är fel, en live-merge under press gör inte det.
alter table dataset_meta add column mandat_kalla text not null default 'av'
  check (mandat_kalla in ('av', 'shadow', 'aktiv'));
