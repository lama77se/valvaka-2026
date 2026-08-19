-- Fas 7 — dataset-provenance (EN rad). Skrivs av ingest-result ur resultatfilen så
-- klienten vet VILKEN datakälla som färgar kartan. Under förvalsperioden kör vi mot
-- generalrepet (source='genrep2026', test=true) → UI:t visar en tydlig "generalrep /
-- testdata"-banner. På valnatten byter ingest-result till val2026 och raden skrivs om
-- till source='val2026', test=false → bannern försvinner automatiskt (data-styrt).
create table dataset_meta (
  id                smallint primary key default 1,
  source            text not null,           -- 'genrep2026' | 'val2026'
  valtillfalle      text,                     -- filens valtillfalle ("Genrep_2026")
  test              boolean not null default false,
  rakningstillfalle text,                     -- 'preliminär' | 'slutlig'
  kalla_uppdaterad  timestamptz,              -- filens senasteUppdateringstid
  updated_at        timestamptz not null default now(),
  constraint dataset_meta_singleton check (id = 1)
);

-- Klient (anon) läser badgen; ingest (service_role) skriver. Samma mönster som result.
alter table dataset_meta enable row level security;
create policy "public read" on dataset_meta for select to anon, authenticated using (true);
grant select on dataset_meta to anon, authenticated;
grant all on dataset_meta to service_role;

-- Startvärde: generalrep (tills ingest-result skrivit sin provenance).
insert into dataset_meta (id, source, test) values (1, 'genrep2026', true)
  on conflict (id) do nothing;
