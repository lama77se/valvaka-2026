-- Valdeltagande 2026 — per distrikt. Källan finns redan i rostfordelnings-JSON:en vi ingestar
-- (per valdistrikt: totaltAntalRoster + antalRostberattigade); valdeltagande = totaltAntalRoster
-- / antalRostberattigade (ALLA avgivna röster inkl. blanka/ogiltiga / röstberättigade). Kan INTE
-- härledas ur `result` (som bara har giltiga partiröster) → egen tabell, egen grain (per distrikt,
-- inte per parti). Aggregat (valkrets/kommun/region/riket) = Σtotalt / Σröstberättigade i klienten.
--
-- Bara REGULJÄRA distrikt lagras (8-siffrig geo-kod, FK mot district). Uppsamlingsdistrikt har
-- ingen egen röstberättigad-nämnare (rösterna tillhör hemdistriktens röstlängd) och deras kod
-- återanvänds mellan filer → utelämnas här; deras bidrag till slutresultatets täljare wire:as in
-- separat senare (verifieras mot /s/-filer först).
--
-- INGEN Realtime-publikation (medvetet): valdeltagande behöver inte sub-sekund-liv och vi håller
-- nere Realtime-fan-out-lasten. Klienten laddar via keyset-snapshot + inkrementell resync
-- (updated_at) i den befintliga 60s-ticken — samma mönster som result-resyncen.

create table turnout (
  valtyp                text not null,             -- 'RD' | 'RF' | 'KF'
  valdistriktskod       text not null references district (valdistriktskod),
  totalt_antal_roster   integer not null,          -- alla avgivna röster (giltiga + blanka + ogiltiga)
  antal_rostberattigade integer not null,          -- röstlängden (fastställd; samma prel som slutligt)
  status                text not null,             -- 'preliminar' | 'slutlig' (spegel av result.status)
  updated_at            timestamptz not null default now(),
  primary key (valtyp, valdistriktskod)
);

-- updated_at auktoritativ för ALLA mutationer (som result) → klientens inkrementella resync ser
-- även omräkningar (samma PK, växande täljare = UPDATE, som annars ej bumpat default now()).
create or replace function bump_turnout_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists turnout_bump_updated_at on turnout;
create trigger turnout_bump_updated_at
  before update on turnout
  for each row execute function bump_turnout_updated_at();

-- Skydda slutliga rader mot sen preliminär re-ingest (samma fallgrop som result). Under valnatten
-- är allt preliminärt → no-op. KRITISKT: genrep lämnar slutliga rader → results:reset måste rensa
-- ÄVEN turnout inför skarpt (se scripts/reset-results.mjs + runbookens N1-steg).
create or replace function turnout_no_status_downgrade() returns trigger
  language plpgsql as $$
begin
  if OLD.status = 'slutlig' and NEW.status is distinct from 'slutlig' then
    return null; -- hoppa över nedgraderingen → behåll den slutliga raden
  end if;
  return NEW;
end;
$$;

drop trigger if exists turnout_no_status_downgrade on turnout;
create trigger turnout_no_status_downgrade
  before update on turnout
  for each row execute function turnout_no_status_downgrade();

-- Klient läser (valdeltagande i UI); edge/ingest skriver som service_role.
alter table turnout enable row level security;

create policy "public read" on turnout
  for select to anon, authenticated using (true);

grant select on turnout to anon, authenticated;
grant all on turnout to service_role;
