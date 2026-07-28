# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Valvaka 2026 — realtidsvisualisering av svenska valresultat per valdistrikt.
Enda datakälla: `data.val.se` (statiska filer, inget publikt live-API — vi pollar
och bygger vår egen realtid ovanpå). Fullständig arkitektur i
[docs/arkitektur.md](./docs/arkitektur.md) — läs den innan du skriver ingest-,
schema- eller mandatkod.

## Status

Tidig fas. Repot är ännu bara dokumentation; ingen applikationskod finns.
Faser, acceptanskriterier och infrastruktur-uppsättning (Supabase/Vercel) står i
[docs/implementationsplan.md](./docs/implementationsplan.md); byggordningens
motivering i docs/arkitektur.md §9.

## Stack (planerad)

- Frontend: React 18 + TypeScript + Vite + Tailwind + shadcn/ui, MapLibre GL JS.
- Backend: Supabase edge functions (Deno), `pg_cron` + `pg_net`.
- Databas: Postgres + PostGIS.
- Realtid: Supabase Realtime.

## Kärnprincip

Klienterna rör aldrig val.se. En enda ingestion-worker pollar data.val.se,
normaliserar till Postgres, och Realtime pushar ut förändringar. Geometrin går
vid sidan om DB-flödet: statiska vektortiles (pmtiles) laddas en gång; bara
resultatvärden flödar i realtid och joinas mot tiles på `valdistriktskod`.

## Datafallgropar (val.se-husstilen — verifierade mot 2022)

Dessa gäller ALL parsning av val.se-filer. Bryt inte mot dem:

- **Avgränsare är `;`** trots filändelsen `.csv`.
- **UTF-8 med BOM** — strippa `0xFEFF` före parsning.
- **Läs alla koder som `string`, aldrig `number`** — inledande nollor faller
  annars bort (`PARTIKOD` 4 siffror, `LISTNUMMER` 5 siffror).
- **Decimalkomma** i koordinater: `"56,196602"` → byt `,`→`.` före `parseFloat`.
- **Versala svenska nyckelnamn**: `LÄNSKOD`, `VALDISTRIKTKOD`, `KOMMUNVALKRETSKOD`.
- **Booleska fält** är `J`/`N`/`I` (I = irrelevant), inte true/false.
- Koordinatsystem **skiljer per fil** — distriktsgeometri är SWEREF99 TM
  (EPSG:3006), men t.ex. vallokaler.json är redan WGS84. Anta inget; reprojicera
  till EPSG:4326.

## Datamodell — nyckelfakta

- Join-nyckel överallt: **`valdistriktskod`**, sammansatt 8 siffror =
  länskod(2) + kommunkod(2) + distriktskod(4). Bygg den själv vid ingest; ta den
  aldrig rakt från en enskild kolumn.
- Valkrets skiljer per valtyp (RD/RF/KF) — aggregera alltid inom rätt valtyp.
- Lagra bara distriktsnivå; högre nivåer är rena upprollningar (aggregera i DB).
- Resultat muteras över tid (valnatt → onsdagsräkning → sluträkning, personröster
  sent). `result` är idempotent: upsert på `(valtyp, valdistriktskod, partikod)`,
  aldrig insert-append. `result_snapshot` är append-only för replay/audit.
- Jämförbarhet mot förra valet är 0..N träffar (inte 1:1) — designa för array av
  föregående koder, inte fasta `kod1/kod2/kod3`.

## Konventioner

- Projektspråk i docs och UI-text: svenska. Kod/identifierare: engelska är okej,
  men datamodellens fältnamn följer doc:en (`valdistriktskod`, `partikod`, ...).
- Skicka aldrig rå geometri (riks-zip är 27 MB) till klienten — tiles, alltid.
- Nya beslut/underlag hör hemma i `docs/`.

## Git

- `main` är default branch. Privat repo: `lama77se/valvaka-2026`.
- Committa aldrig rådata eller genererade artefakter (`.zip`/`.xlsx`/`.pmtiles`/
  `.geojson` etc.) — de är gitignore:ade och regenereras från källan.
