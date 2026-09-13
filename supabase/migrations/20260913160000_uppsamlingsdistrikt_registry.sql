-- Uppsamlingsdistrikt-REGISTRET — statisk(ish) referensdata: vilka uppsamlingsdistrikt
-- finns per valtyp, och var hör de hemma (kommun/lan/valkrets)? Handover 13 sep (Val
-- ANALYSIS, SJÄLVUPPDATERANDE variant — ersätter ett tidigare förslag om ett manuellt
-- körbart engångsskript mot en statisk JSON-fil).
--
-- Byggs upp AUTOMATISKT av ingest-result/index.ts (och scripts/ingest-slutlig.mjs,
-- lockstegat): kod/kommunkod/lankod/kretskod/namn är strukturellt KÄNT från start,
-- OAVSETT om distriktet rapporterat några röster än — val.se:s organfiler listar redan
-- uppsamlingsdistrikten innan rösträkningen. Ingen manuell körning, inget nytt live-
-- ingest-flöde — bara EN extra, isolerad rad per redan-läst uppsamlingsdistrikt-post
-- (samma isoleringsprincip som mandat_valse: eget try/catch, kan aldrig påverka röst-/
-- turnout-upserten eller filens done-status).
--
-- Används av klienten för "X av Y distrikt räknade"-nämnaren (ResultTable-undertexten,
-- kartans rapporteringsgrad-HUD, avgångstavlornas header, MandatBars "Prognos·X%") så
-- den matchar val.se/SVT (som räknar med uppsamlingsdistrikten: RD "X av 6626" = 6312
-- geografiska + 314 uppsamling — vi visade tidigare bara mot 6312).
--
-- EGEN tabell, samma skäl som uppsamling_result (20260826130000): uppsamlingsdistrikt
-- har ingen geometri/FK mot district (kod återanvänds mellan RD-/RF-/KF-filer, bara unik
-- INOM en valtyp).
create table uppsamlingsdistrikt_registry (
  valtyp     text not null,           -- 'RD' | 'RF' | 'KF'
  kod        text not null,          -- uppsamlingsdistriktets kod (unik inom valtyp)
  kommunkod  text not null,          -- 4 siffror → KF-organ
  lankod     text not null,          -- 2 siffror → RF-organ
  kretskod   text,                   -- valkretskod (RD 2 siffror / RF 4 / KF 6) — null om olöst
  namn       text,
  updated_at timestamptz not null default now(),
  primary key (valtyp, kod)
);

-- Publik läsning (samma modell som uppsamling_result/district — offentlig referensdata),
-- skrivning bara service_role (edge/ingest).
alter table uppsamlingsdistrikt_registry enable row level security;
create policy "public read" on uppsamlingsdistrikt_registry for select to anon, authenticated using (true);
grant select on uppsamlingsdistrikt_registry to anon, authenticated;
grant all on uppsamlingsdistrikt_registry to service_role;
