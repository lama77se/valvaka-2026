-- Fas 4 — resultatlagring (2026 live). Muteras över tid (valnatt → onsdagsräkning
-- → sluträkning); `result` är idempotent (upsert), `result_snapshot` append-only
-- för replay/audit. Mandatberäkningen är en FRIKOPPLAD ren TS-modul (röster in →
-- mandat ut), inte SQL — se src/lib/mandate/.
--
-- OBS: `result` FK:ar mot 2026 års district/party. 2022 års stand-in-data (andra
-- distriktskoder) lagras INTE här; mandatmodulen regressionstestas direkt mot
-- 2022-filerna (aggregerat till valkrets), frikopplat från denna tabell.

create table result (
  valtyp          text not null,            -- 'RD' | 'RF' | 'KF'
  valdistriktskod text not null references district (valdistriktskod),
  partikod        text not null references party (partikod),
  roster          integer not null,
  andel           numeric(6, 3),
  status          text not null,            -- 'preliminar' | 'onsdag' | 'slutlig'
  updated_at      timestamptz not null default now(),
  primary key (valtyp, valdistriktskod, partikod)
);

-- Append-only logg: gör att en valnatt kan spolas tillbaka/spelas upp (§10-harness).
create table result_snapshot (
  id              bigint generated always as identity primary key,
  ingest_ts       timestamptz not null default now(),
  valtyp          text not null,
  valdistriktskod text not null,
  partikod        text not null,
  roster          integer not null,
  status          text not null
);

create index result_snapshot_replay_idx
  on result_snapshot (valtyp, ingest_ts);

-- Klient läser resultat (kartfärgning); edge/ingest skriver som service_role.
alter table result enable row level security;
alter table result_snapshot enable row level security;

create policy "public read" on result
  for select to anon, authenticated using (true);

grant select on result to anon, authenticated;
grant all on result to service_role;
grant all on result_snapshot to service_role;
