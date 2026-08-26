-- Uppsamlingsdistrikt — sena röster (utlands-/sena förtidsröster) som val.se räknar
-- vid ONSDAGSRÄKNINGEN, inte på valnatten. De hör till ett ORGAN, inte till någon
-- geografisk plats: KF → kommunen, RF → regionen (länet), RD → riket. Genom att väga
-- in dem i organ-aggregaten matchar den slutgiltiga presentationen val.se:s officiella
-- totaler (RD SomSkaRaknas 6626 = 6312 geografiska + 314 uppsamling).
--
-- EGEN tabell, medvetet frikopplad från `result`:
--   • ingen geometri → ingen karta, ingen FK mot district (koden är 6-siffrig, inte 8).
--   • koden ÅTERANVÄNDS mellan RD- och RF-filer (samma "018001" i båda) → den 8-siffriga
--     valdistriktskoden duger inte som nyckel. Koden är dock unik INOM en valtyp
--     (= kommunkod + löpnummer, och kommunkod är läns-unik) → PK (valtyp, kod, partikod).
--   • routas ALLTID per explicit kommunkod/lankod ur filen, ALDRIG genom att parsa koden.
create table if not exists uppsamling_result (
  valtyp text not null,            -- 'RD' | 'RF' | 'KF'
  kod text not null,              -- uppsamlingsdistriktets kod (unik inom valtyp)
  kommunkod text not null,        -- 4 siffror → KF-organ
  lankod text not null,           -- 2 siffror → RF-organ
  partikod text not null references party(partikod),
  roster integer not null default 0,
  status text,                    -- 'preliminar' | 'slutlig' (informativt; driver ej status-taggen)
  updated_at timestamptz not null default now(),
  primary key (valtyp, kod, partikod)
);

create index if not exists uppsamling_result_kommun_idx on uppsamling_result (valtyp, kommunkod);
create index if not exists uppsamling_result_lan_idx on uppsamling_result (valtyp, lankod);

-- Varje tabell i public MÅSTE ha RLS (annars exponeras den via PostgREST). Publik
-- läsning (samma modell som result — datan är offentlig), skrivning bara service_role.
-- INGEN Realtime-publikation: uppsamling ändras i onsdagsräkningens dygnstakt, inte i
-- valnattens burst, och den målar aldrig kartan → klienten läser den i snapshot-passet.
alter table uppsamling_result enable row level security;
create policy "public read" on uppsamling_result for select to anon, authenticated using (true);
grant select on uppsamling_result to anon, authenticated;
grant all on uppsamling_result to service_role;
