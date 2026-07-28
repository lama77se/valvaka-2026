-- Fas 2 — statiska referenstabeller: party, district, district_comparison.
-- Laddas en gång (idempotent upsert) från redan publicerade 2026-filer via
-- scripts/ingest-reference.mjs. Resultat-/ingest-tabellerna (arkitektur.md §4)
-- skapas först i Fas 3–4 — medvetet utanför denna migration.

create table party (
  partikod    text primary key,   -- 4 siffror, behåll ledande nollor
  beteckning  text not null,
  forkortning text,               -- kan vara tom (många småpartier)
  color       text                -- hex för choropleth; satt för riksdagspartier, annars null
);

create table district (
  valdistriktskod text primary key,   -- 8 siffror = kommunkod(4) + distrikt(4)
  namn            text not null,
  kommunkod       text not null,
  kommun          text,
  lanskod         text not null,
  lan             text,
  vk_rd           text,   -- riksdagsvalkretskod
  vk_rf           text,   -- regionvalkretskod (RF)
  vk_kf           text    -- kommunvalkretskod (KF)
  -- Ingen geom-kolumn med flit: distriktsgeometrin bor som statisk GeoJSON i
  -- Supabase Storage (låst Fas 1-beslut), inte i DB. Joinas mot kartans
  -- tile-/feature-features på valdistriktskod. Lägg inte till geom här.
);

create table district_comparison (
  valdistriktskod text primary key references district (valdistriktskod),
  jamforbarhet    text not null check (jamforbarhet in ('JA', 'NEJ', 'FLERA')),
  koder_foreg     text[] not null default '{}'  -- 0..N föregående (2022) koder, 8-siffriga
);

-- Klient-läsning: statiskt offentligt referensdata. RLS är på (projektets
-- auto-RLS), och läsning öppnas för anon/authenticated. Auto-expose är AV i
-- projektet → explicit grant krävs UTÖVER policy, annars ser klienten inget.
alter table party enable row level security;
alter table district enable row level security;
alter table district_comparison enable row level security;

create policy "public read" on party
  for select to anon, authenticated using (true);
create policy "public read" on district
  for select to anon, authenticated using (true);
create policy "public read" on district_comparison
  for select to anon, authenticated using (true);

grant select on party to anon, authenticated;
grant select on district to anon, authenticated;
grant select on district_comparison to anon, authenticated;
