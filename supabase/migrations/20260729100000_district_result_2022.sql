-- 2022 års resultat per 2026-distrikt — underlag för distriktsnivå-jämförelsen i
-- resultattabellen (klick på ett distrikt i kartan). 2026-distrikt ≠ 2022-distrikt,
-- så raderna är föraggregerade via district_comparison.koder_foreg: JA = 1:1,
-- FLERA = summa över föregående 2022-distrikt, NEJ = ingen rad (visar "–").
-- Fylls av scripts/ingest-district-2022.mjs (service_role). Bara röstandel lagras
-- (mandat fördelas inte per distrikt → "–" i tabellen).
create table district_result_2022 (
  valtyp          text not null,   -- RD | RF | KF
  valdistriktskod text not null,   -- 2026-distriktskod (8 siffror)
  beteckning      text not null,   -- partinamn (join mot party.beteckning / 2026-raden)
  andel           real not null,   -- 0..1, 2022 års andel i distriktet
  primary key (valtyp, valdistriktskod, beteckning)
  -- Klientuppslaget (valtyp, valdistriktskod) täcks av PK-prefixet.
);

-- Klient-läsning (statiskt offentligt referensdata). Auto-expose är AV → explicit
-- grant krävs utöver policy. service_role skriver (ingest).
alter table district_result_2022 enable row level security;
create policy "public read" on district_result_2022
  for select to anon, authenticated using (true);
grant select on district_result_2022 to anon, authenticated;
grant all on district_result_2022 to service_role;
