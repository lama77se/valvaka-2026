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

Återstår:

- **Fas 7** — generalrep: hela kedjan lastad på uppspelad 2022-data (alla tre
  valtyper) i komprimerad tid via samma ingest-kod, validerad mot Valmyndighetens facit.

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
npm run verify:mandate     # mandatmodul mot 2022 RD-facit (riksdag)
npm run verify:mandate-rf  # mandatmodul mot 2022 RF-facit (region, 20 regioner)
npm run verify:mandate-kf  # mandatmodul mot 2022 KF-facit (kommun, 290 kommuner)
npm run simulate:valnatt   # simulera inrapportering (RD) för realtidsdemo
npm run verify:realtime    # headless-acceptans: upsert → kartfärgning via Realtime
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
