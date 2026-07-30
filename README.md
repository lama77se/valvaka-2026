# Valvaka 2026

Realtidsvisualisering av valresultat per valdistrikt för det svenska valet 2026,
med [data.val.se](https://data.val.se) som enda källa.

Klienterna rör aldrig val.se: en ingestion-worker pollar de statiska filerna,
normaliserar till Postgres, och Supabase Realtime pushar förändringar ut till
kartklienten. På så vis byggs en egen realtidsfeed ovanpå en källa som bara
publicerar platta filer på schema.

## Status

Under uppbyggnad. Klart hittills:

- **Fas 0** — projektuppsättning (Vite + React 18 + TS + Tailwind + shadcn/ui),
  Supabase-projekt (EU, PostGIS), Vercel (prod-only vid push till `main`).
- **Fas 1** — distriktsgeometrin: alla 6 312 valdistrikt reprojicerade
  (SWEREF99 TM → WGS84) och renderade i MapLibre GL.
- **Fas 2** — referensdata (`party`, `district`, `district_comparison`) i Postgres,
  läsbar av klienten på `valdistriktskod` (hover slår upp jämförbarhet mot 2022).
  DB-migrationer körs via GitHub Action vid push till `main`.
- **Fas 3** — poll-ingestion: Deno edge function med conditional GET
  (`If-Modified-Since`), schemalagd med `pg_cron` + `pg_net`.
- **Fas 4** — resultatschema (`result` idempotent, `result_snapshot` append-only)
  + mandatmodul (jämkade uddatalsmetoden, 349 mandat). Verifierad mot 2022 RD-facit
  (`npm run verify:mandate`) — 349-fördelningen och fasta mandat per valkrets
  matchar exakt.
- **Fas 5** — realtidsfärgning: kartklienten prenumererar på `result`-ändringar
  (Supabase Realtime) och färgar distrikten efter vinnarparti via feature-state,
  med rapporteringsgrad-HUD. Repaint rAF-koalescerad. Bevisad headless
  (`npm run verify:realtime`) — simulerad upsert syns inom ~350 ms.
- **Fas 6** — flervals-dimension (RD/RF/KF): **valtyp-väljare** (Riksdag/Region/Kommun)
  på samma karta — en `ResultStore` per valtyp, växling färgar om samma geometri utan
  omladdning, per-valtyp rapporteringsgrad. Mandatmodulen generaliserad
  (`computeAssembly`) och verifierad mot 2022-facit för alla tre valtyper:
  RD 349 exakt, **RF 20/20 regioner**, **KF 289/290 kommuner** (de två avvikelserna
  är lottning resp. ändrad fullmäktigestorlek, inte metodfel).

- **Fas 7 (delvis)** — generalrep-harness i två delar:
  - replay av en riktig 2022-valnatt i komprimerad tid
    (`npm run replay:2022 -- --valtyp RD|RF|KF`) med **löpande mandatprojektion** för
    alla tre valtyperna som konvergerar mot facit (RD 349, RF 20/20 regioner,
    KF 290/290 kommuner), streamad genom `result_snapshot` (äkta 2022-geografi).
  - klient-last/throughput (`npm run loadtest:valnatt`): full RD-volym (50 496 rader)
    levereras 100 % till klienten, alla distrikt färgade — rAF-koalescerad per-rad-CDC
    bär volymen (broadcast-vägen ej nödvändig än). Fynd: ingest måste ske i små
    transaktioner (Realtime tappar jättebatchar).

- **Presentation — resultatlager (pågår):** en delad `ResultsProvider` driver
  kartan, en live resultattabell, mandatsoffan och en departure board-ticker från
  samma Realtime-flöde (delad valtyp + valt område). Tabellen visar parti · röster ·
  andel (2026/2022/±) · mandat (2026/2022/±)
  på alla nivåer — **2022 års slutresultat visas alltid** i egna kolumner bredvid
  2026, även innan 2026 kommit in (raderna sås in ur 2022 och fylls på live).
  Områdesväljaren är **valtyp-medveten**: riksdagsval → riket + nedbrytning till
  län/kommun, regionval → region, kommunval → kommun (aggregerar aldrig uppåt förbi
  det organ valtypen faktiskt väljer). **Klick på ett distrikt i kartan** visar det
  enskilda valdistriktets brytning (röster + andel + 2022) i tabellen. 2022 på
  distriktsnivå föraggregeras via `district_comparison.koder_foreg` (2026-distrikt ≠
  2022-distrikt) till tabellen `district_result_2022` och hämtas per klick; ~80 % av
  distrikten (jämförbara) får 2022, övriga "–". Mandat och spärr-linjen döljs på
  distriktsnivå (församlingsvida bestämningar, inte per-distrikt). Aggregatet
  återanvänder den verifierade mandatmodulen och är kollat mot 2022-facit
  (`npm run verify:aggregate`). Ovanför tabellen ritas en **riksdagssoffa**
  (mandathalvcirkel, parliament-arc) — en prick per mandat, färgad per parti och
  ordnad vänster→höger på politisk skala, med en **50 %-linje** rakt genom valvet
  som visar var egen majoritet skär. Där ett organ faktiskt fördelas (RD@riket,
  RF@region, KF@kommun) är soffan fylld och matar från samma facit-verifierade mandat
  som tabellen; sittplatsgeometrin (`seatPositions`) är täckt av
  `npm run verify:aggregate`. Där inget organ fördelas (RD-nedbrytning till
  län/kommun, distriktsklick) ritas i stället en **ungefärlig procent-soffa** —
  100 platser = procent, ren proportion (largest-remainder `hareSeats`, ingen spärr)
  ur röstandelarna, tydligt märkt som ungefärlig (ihåliga ringar, `≈`-etikett) så den
  aldrig förväxlas med räknade mandat. **2026 och 2022 visas som två bilder sida vid
  sida** (`2026`- resp. `2022`-etikett): 2022 fungerar som baslinje och ligger kvar
  även efter att 2026 börjat räknas, så innan första rösten ser man ändå förra valets
  soffa i stället för en tom yta. 2026-soffan bär en amber **`Prognos · X % räknat`**-
  markering tills allt är räknat, så tidiga och volatila projektioner (runt spärren)
  inte läses som facit; 2022-baslinjen är alltid slutresultat och saknar den.
  `hareSeats` täcks också av `npm run verify:aggregate`.

- **Departure board — live-ticker (klar).** Över kartan (nedre vänster) en
  avgångstavla över inrapporterade valdistrikt, nyast överst: tid, distriktsnamn och
  ledande parti (färgchip + andel), färgkodad vänsterkant per vinnare. Prenumererar på
  samma per-distrikt-notis som kartan (`subscribeChanges`), rAF-koalescerad så den tål
  valnattsburst; följer vald valtyp och seedas ur redan inrapporterade distrikt vid
  laddning (snapshot fanar inte ut till listeners). Nya distrikt glider in med en kort
  blänk; klick på en rad drillar tabellen till distriktet.

- **Partilegend (klar).** Uppe till vänster kopplar en legend kartans distriktsfärger
  till parti: de 8 riksdagspartierna i politisk vänster→höger-ordning (färg ur
  `party.color`), plus "Lokalt parti" (grå — rapporterad vinnare utan märkesfärg,
  t.ex. lokala partier i region/kommun) och "Ej rapporterat" (mörkgrå). Färgerna
  importeras från kartan (en sanningskälla, ingen drift).

Återstår:

- **Fas 7 (resten)** — det fullständiga generalrepet mot den skarpa resultat-
  ingesten (väntar på 2026 års opublicerade filschema).

Se **[docs/arkitektur.md](./docs/arkitektur.md)** för hela underlaget och
**[docs/implementationsplan.md](./docs/implementationsplan.md)** för faser och
infrastruktur.

## Tänkt stack

| Lager | Val |
|-------|-----|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui |
| Karta | MapLibre GL JS (pinnad v5) — statisk GeoJSON via Supabase Storage |
| Realtid | Supabase Realtime |
| Backend | Supabase edge functions (Deno), `pg_cron` + `pg_net` |
| Databas | Postgres + PostGIS |

## Arkitektur i korthet

```
data.val.se (statiska CSV/JSON)
      │  cron: conditional GET (If-Modified-Since)
      ▼
Ingest edge function (Deno) ──upsert──▶ Postgres + PostGIS
                                             │ rollups, mandat, delta
                                             ▼
                                       Supabase Realtime ──websocket──▶ React-klient (MapLibre)

Statisk geometri (pmtiles) ─────────────── laddas en gång ──────────▶ React-klient
```

Geometrin går vid sidan om databasflödet: distrikten är statiska och laddas en
gång som vektortiles, medan bara resultatvärdena flödar i realtid.

## Byggordning

1. Geometri (statiskt, kan göras nu) — ladda, reprojicera SWEREF99 TM → WGS84,
   förenkla, generera tiles.
2. Referensdata — `party`, `district`, `district_comparison`.
3. Ingestion mot parti/kandidat-CSV.
4. Resultatschema + mandatmodul mot historisk 2022-data.
5. Realtime + kart-paint (RD).
6. Flervals-dimension — RD/RF/KF som en karta med valtyp-väljare + tre mandatberäkningar.
7. Generalrep på 2022-datan uppspelad genom snapshot-tabellen (§10 i doc:en).

Fullständig motivering, datafallgropar (`;`-avgränsare, BOM, inledande nollor,
decimalkomma), schema och 2022-replay-harness finns i
[docs/arkitektur.md](./docs/arkitektur.md).

## Utveckling

```
npm install
npm run dev                # dev-server på fast port http://localhost:5926
npm run build              # typkoll + prod-bygge
npm run geometry           # regenerera distriktsgeometrin från källan (mapshaper)
npm run ingest:reference   # ladda referensdata till Supabase (service-role i .env.local)
npm run ingest:district-2022 # 2022 per 2026-distrikt (koder_foreg-aggregat) → district_result_2022
npm run verify:mandate     # mandatmodul mot 2022 RD-facit (riksdag)
npm run verify:mandate-rf  # mandatmodul mot 2022 RF-facit (region, 20 regioner)
npm run verify:mandate-kf  # mandatmodul mot 2022 KF-facit (kommun, 290 kommuner)
npm run simulate:valnatt   # simulera inrapportering (RD) för realtidsdemo
npm run verify:realtime    # headless-acceptans: upsert → karta + tabell via Realtime
npm run verify:aggregate   # resultattabellens aggregat + mandat + ±2022 mot 2022-facit
npm run results:reset      # rensa simulerade resultat ur result-tabellen
```

Kopiera `.env.example` → `.env.local` och fyll i Supabase-URL + anon-nyckel.
Geometrin (`public/valdistrikt-2026-wgs84.geojson`) är gitignore:ad och
regenereras från källan (se docs/implementationsplan.md Fas 1); i produktion hostas
den i Supabase Storage och pekas ut via `VITE_GEOMETRY_URL`. DB-migrationer och
edge functions deployas via GitHub Actions vid push till `main`.

## Datakälla

All data kommer från Valmyndigheten; index är
[råvaru-sidan för val 2026](https://www.val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026).
Källorna ligger på två ställen: parti-/röstmottagnings-CSV på
`data.val.se/filer/val2026/...`, medan geometri-zip och de flesta xlsx ligger som
CMS-länkar på `www.val.se/download/...`. Innehållet lyder under Valmyndighetens villkor.
