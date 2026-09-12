-- Uppsamlingsdistrikt (sena röster) har ofta ändå en `kretskod` — Valmyndigheten löser
-- rösterna till sin RIKTIGA valkrets när hemvisten är känd (bekräftat mot 2022-facit,
-- 12 sep: RD:s slutliga fil hade kretskod på ALLA 314 uppsamlingsdistrikt, 220 640 röster;
-- RF/KF ibland — Ronneby ja, Uppsala nej). Ingesten har hittills bara läst kommunkod/lankod
-- (organ-hinken) och tyst kastat kretskod, vilket gjorde att LIVE-mandaträkningen alltid
-- klumpade uppsamling organ-vitt i stället för att lägga den lösta delen i sin riktiga
-- valkrets. Verifierat mot 2022 SLUTLIG-facit: utan attribuering 161/166 RD-(valkrets,parti)
-- -par exakt, MED 166/166 — se aggregate.ts UppsamlingBuckets-docstring för hela analysen.
alter table uppsamling_result
  add column kretskod text; -- valkretskod (kommunprefixad/länsprefixad, samma format som
                             -- district.vk_rd/vk_rf/vk_kf) — null = olöst, väger bara in i
                             -- organets spärr/mål, placeras aldrig geografiskt.

create index if not exists uppsamling_result_kretskod_idx
  on uppsamling_result (valtyp, kretskod)
  where kretskod is not null;

comment on column uppsamling_result.kretskod is
  'Valkrets uppsamlingsdistriktets sena röster är RESOLVDA till, om känd (rostfordelning.valdistrikt[].kretskod i val.se-filen). Null = olöst.';
