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
      │  cron: conditional GET (ETag)
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
5. Realtime + kart-paint.
6. Generalrep på 2022-datan uppspelad genom snapshot-tabellen (§10 i doc:en).

Fullständig motivering, datafallgropar (`;`-avgränsare, BOM, inledande nollor,
decimalkomma), schema och 2022-replay-harness finns i
[docs/arkitektur.md](./docs/arkitektur.md).

## Utveckling

```
npm install
npm run dev        # dev-server på fast port http://localhost:5926
npm run build      # typkoll + prod-bygge
```

Kopiera `.env.example` → `.env.local` och fyll i Supabase-URL + anon-nyckel.
Geometrin (`public/valdistrikt-2026-wgs84.geojson`) är gitignore:ad och
regenereras från källan (mapshaper, se docs/implementationsplan.md Fas 1); i
produktion hostas den i Supabase Storage och pekas ut via `VITE_GEOMETRY_URL`.

## Datakälla

All data kommer från Valmyndigheten. Rådata laddas från
[råvaru-sidan för val 2026](https://www.val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026)
(filer på `www.val.se/download/...`; den gamla `data.val.se/filer/`-sökvägen är
avvecklad). Innehållet lyder under Valmyndighetens villkor.
