# Valvaka 2026

Realtidsvisualisering av valresultat per valdistrikt för det svenska valet 2026,
med [data.val.se](https://data.val.se) som enda källa.

Klienterna rör aldrig val.se: en ingestion-worker pollar de statiska filerna och
normaliserar till Postgres. Kartklienten håller sig själv färsk med en lätt
inkrementell poll (en `updated_at`-delta, jittrad 45–90 s) och presenterar det som en
nära-live-feed — distrikt rullar in på avgångstavlorna, kartan målas om per distrikt
och en puls-indikator lyser — ovanpå en källa som bara publicerar platta filer på schema.

**Live:** [valvaka.tech](https://valvaka.tech) — färgas just nu av Valmyndighetens
**generalrepetition** (testdata) tills skarpa resultat flödar på valnatten 13 sep 2026.

## Status

**Live på [valvaka.tech](https://valvaka.tech), funktionellt komplett inför valet
13 sep 2026.** Hela kedjan är byggd och verifierad mot 2022 års officiella facit:
realtidsingest → Postgres → karta, resultatpanel och alla tre valen (riksdag, region,
kommun). Just nu matas appen av Valmyndighetens generalrepetition (testdata) — på
valnatten byts källan till de skarpa resultatfilerna via en enda konstant, utan andra
ändringar.

## Vad den gör

- **Realtidskarta** över alla 6 312 valdistrikt (reprojicerade SWEREF99 TM → WGS84,
  MapLibre GL), färgade efter vinnarparti. `result`-deltan hämtas av klientens
  inkrementella poll och målas om rAF-koalescerat per distrikt (trillar in, tål
  valnattsburst); rapporteringsgrad-HUD med pulsande **Live**-indikator (poll-hälsa) och
  "uppdaterad"-tidsstämpel.
- **Tre val på samma karta** — valtyp-väljare (Riksdag / Region / Kommun); en
  `ResultStore` per valtyp färgar om samma geometri utan omladdning.
- **Mandatberäkning** med jämkade uddatalsmetoden, verifierad mot 2022-facit:
  **riksdag 349 exakt, region 20/20, kommun 289/290** (de två avvikelserna är lottning
  resp. ändrad fullmäktigestorlek, inte metodfel).
- **Resultatpanel** — parti · röster · andel · mandat, **2026 mot 2022** i egna kolumner
  (2022 visas alltid, även innan första rösten kommit). Resultatet ritas som två liggande
  staplar (röstandel + mandat) med 50 %-linjer, spärr-filtrering och 2022-baslinje.
  Breadcrumb + "Bryt ner"-matris drillar valtyp-medvetet genom valkretsar, kommuner och
  distrikt; klick i kartan öppnar ett enskilt distrikt.
- **Valdeltagande i procent** för valt område (alla nivåer där röstberättigade finns), i
  resultatpanelens rubrik. Tas direkt ur val.se:s resultatfiler (totala avgivna röster /
  röstberättigade i räknade distrikt — verifierat mot summeringsfacit), ingen extra datakälla.
- **Avgångstavlor** — tre live-tickers (en per val) med de senast inrapporterade
  distrikten: val.se:s riktiga rapporteringstid, full hierarkiväg och de fem största
  partierna. Nya distrikt **rullar in staggrat** (ett par åt gången) så tavlan känns
  levande trots att data hämtas i poll-batchar.
- **Statustagg per valtyp** — *Preliminärt → Sluträknas · X % → Slutgiltigt*, härledd ur
  räkningsläget. De **preliminära** filerna strömmas in av edge-funktionen; **alla slutliga**
  filer (riks-RD + samtliga region- och kommunfiler) tas av ett lokalt Node-skript under
  sluträkningen (`npm run ingest:slutlig`).
- **Uppsamlingsröster invägda** — de sena rösterna (utlands-/sena förtidsröster som
  Valmyndigheten räknar vid onsdagsräkningen) vägs in i organtotalerna (kommun/region/riket)
  så den slutgiltiga presentationens röstsummor och mandat matchar val.se — verifierat mot
  generalrepets mandatfacit (`npm run verify:uppsamling`). Kartan/valkretsarna förblir geografiska.
- **Delbara vy-URL:er** — t.ex. `?val=KF&omrade=kommun:1488` öppnar "Kommunvalet Trollhättan".
  Mobil-fliken speglas i URL-hashen (`#resultat` / `#senaste`), så en länk kan öppna en
  specifik vy direkt.
- **Responsiv layout — desktop + mobil.** Från **xl (≥ 1280 px)** visas desktop-vyn:
  fullskärmskarta med svävande overlays — info + "Vinnande parti"-legend och tre
  avgångstavlor till vänster (tavlorna fyller höjden och visar fler rader på högre skärmar),
  resultatpanel till höger, och karta + valtyp-väljare + status centrerade i det rena fältet
  mellan overlayerna. Brytpunkten är satt vid 1280 px så normala kontorslaptops behåller
  desktop. **Under 1280 px** byter appen till en egen **flik-layout** (Karta / Resultat /
  Senaste) med persistent topp-chrome (valtyp + valt område + status) och tumvänlig bottom-nav;
  kartan monteras först när Karta-fliken öppnas (aldrig annars) och hålls sedan vid liv, så en
  besökare som bara läser resultat aldrig betalar för geometrin/WebGL-kontexten. Båda
  layouterna delar samma state, så valt val + område följer med över brytpunkten (t.ex. vid
  rotation) utan omladdning.
- **Skarp valnatt-ingest** — en Deno edge function schemalagd med `pg_cron` pollar de
  **preliminära** resultatfilerna och **strömmar** in dem (fflate streaming-unzip → SAX-parser →
  batch-upsert), så minnet är oberoende av filstorlek. Verifierad end-to-end mot generalrepet; på
  valnatten pekas den bara om till de skarpa filerna. De *slutliga* filerna spränger edge-runtimens
  CPU-tak (~2 s/request kan inte tokenisera 260 MB JSON, och klungor av medelstora slutliga summerar
  över taket) och tas i stället i sin helhet av ett lokalt Node-skript, `npm run ingest:slutlig`,
  som körs under sluträkningen (ons–fre).

Operativ **[runbook för valnatten](./docs/runbook-valnatt.md)** (inför/på/efter) och detaljerad
ingest-beskrivning i **[docs/resultat-ingest-genrep.md](./docs/resultat-ingest-genrep.md)**.

Fullständigt underlag i **[docs/arkitektur.md](./docs/arkitektur.md)** och
**[docs/implementationsplan.md](./docs/implementationsplan.md)**.

## Stack

| Lager | Val |
|-------|-----|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui |
| Karta | MapLibre GL JS (pinnad v5.24) — statisk GeoJSON via Supabase Storage |
| Uppdatering | Klient-polling — inkrementell resync-delta (`updated_at`), jittrad 45–90 s |
| Backend | Supabase edge functions (Deno), `pg_cron` + `pg_net` |
| Databas | Postgres + PostGIS |

## Arkitektur i korthet

```
data.val.se (statiska CSV/JSON)
      │  cron: conditional GET (If-Modified-Since)
      ▼
Ingest edge function (Deno) ──upsert──▶ Postgres + PostGIS
                                             ▲   (rollups, mandat, updated_at-delta)
                                             │
       React-klient (MapLibre) ──poll: updated_at-delta var 45–90 s (jittrat, synlig flik)

Statisk geometri (GeoJSON) ─────────────── laddas en gång ──────────▶ React-klient
```

Geometrin går vid sidan om databasflödet: distrikten är statiska och laddas en gång som
statisk GeoJSON (hostad i Supabase Storage, utpekad via `VITE_GEOMETRY_URL`), medan bara
resultatvärdenas delta hämtas av klientens poll (`updated_at`-delta, jittrad 45–90 s; bara
synlig flik pollar, bakgrundsflikar snappar färskt vid tab-fokus). Ingen Realtime/WAL-
decoding-last — polling-lasten skalar med klienter/intervall, inte writes × prenumeranter.
(Komprimering till vektortiles är en senare optimering; i dag räcker den förenklade GeoJSON:en.)

Fullständig motivering, datafallgropar (`;`-avgränsare, BOM, inledande nollor,
decimalkomma), schema och 2022-replay-harness finns i
[docs/arkitektur.md](./docs/arkitektur.md).

## Utveckling

```
npm install
npm run dev                # dev-server på fast port http://localhost:5926
npm run build              # typkoll + prod-bygge
npm run geometry           # regenerera distriktsgeometrin från källan (mapshaper) + district-bounds.json
npm run bounds             # regenerera bara public/district-bounds.json ur befintlig geometri (fitBounds-underlag)
npm run ingest:reference   # ladda referensdata till Supabase (service-role i .env.local)
npm run ingest:district-2022 # 2022 per 2026-distrikt (koder_foreg-aggregat) → district_result_2022
npm run verify:mandate     # mandatmodul mot 2022 RD-facit (riksdag)
npm run verify:mandate-rf  # mandatmodul mot 2022 RF-facit (region, 20 regioner)
npm run verify:mandate-kf  # mandatmodul mot 2022 KF-facit (kommun, 290 kommuner)
npm run simulate:valnatt   # simulera inrapportering (RD) för realtidsdemo
npm run verify:realtime    # headless-acceptans: upsert → syns i karta + tabell (nu via klientens poll/resync; Realtime borttaget)
npm run verify:aggregate   # resultattabellens aggregat + mandat + ±2022 mot 2022-facit
npm run verify:uppsamling  # uppsamlingsröster → riktiga computeMandate mot genrepets mandatfacit (nätverk)
npm run ingest:slutlig     # ingesta ALLA slutliga filer (riks-RD + alla region- och kommunfiler) — körs ons–fre under sluträkningen (service-role i .env.local)
npm run results:reset      # rensa simulerade resultat ur result-tabellen
```

Kopiera `.env.example` → `.env.local` och fyll i Supabase-URL + anon-nyckel.
Geometrin (`public/valdistrikt-2026-wgs84.geojson`) är gitignore:ad och regenereras från
källan; i produktion hostas den i Supabase Storage och pekas ut via `VITE_GEOMETRY_URL`.
DB-migrationer och edge functions deployas via GitHub Actions vid push till `main`.

## Datakälla

All data kommer från Valmyndigheten; index är
[råvaru-sidan för val 2026](https://www.val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026).
Källorna ligger på två ställen: parti-/röstmottagnings-CSV på
`data.val.se/filer/val2026/...`, medan geometri-zip och de flesta xlsx ligger som
CMS-länkar på `www.val.se/download/...`. Innehållet lyder under Valmyndighetens villkor.

## Bidra

Bidrag är välkomna. Projektet underhålls av en person på fritiden, så svarstiden
kan variera — ha tålamod. Buggar och idéer: öppna gärna ett
[GitHub Issue](https://github.com/lama77se/valvaka-2026/issues) först, så vi kan
stämma av inriktningen innan du lägger tid på kod.

Så här skickar du en ändring:

1. **Forka** repot på GitHub (utomstående kan inte pusha direkt — allt går via
   fork + pull request).
2. **Brancha** på din fork: `git checkout -b fix/kort-beskrivning`
   (eller `feat/...`, `docs/...`, `chore/...`).
3. **Koda.** Håll varje commit fokuserad och beskrivande. Följ stilen i koden
   omkring dig.
4. **Verifiera lokalt** innan du öppnar PR:
   ```sh
   npm run build      # typkoll (tsc) + prod-bygge
   npm run lint       # oxlint
   ```
   `verify:*`-skripten (mandat, aggregat, realtid) kräver en egen Supabase-instans
   med service-role-nyckel i `.env.local` och behövs bara om du rör ingest-,
   schema- eller mandatkod — se [Utveckling](#utveckling).
5. **Öppna en pull request** mot `main` med en kort beskrivning av *vad* och *varför*.
6. Vänta på granskning. `main` är skyddad (inga force-pushes, ingen radering);
   ändringar landar via PR.

Läs **[CLAUDE.md](./CLAUDE.md)** och **[docs/arkitektur.md](./docs/arkitektur.md)**
innan du rör ingest, schema eller mandat — några projektspecifika regler som sparar
tid:

- **Datamodellens join-nyckel är alltid `valdistriktskod`** (8 siffror =
  länskod + kommunkod + distriktskod). Bygg den själv vid ingest, ta den aldrig
  rakt ur en enskild kolumn.
- **val.se-filerna har en husstil med fallgropar** (verifierade mot 2022):
  `;`-avgränsare trots `.csv`, UTF-8 med BOM, koder som `string` (ledande nollor),
  decimalkomma i koordinater, versala svenska nyckelnamn. Bryt inte mot dem
  (§1 i arkitektur.md).
- **Mandatmodulen är en frikopplad ren TS-modul** (röster in → mandat ut), inte
  SQL. Ändrar du den: kör `verify:mandate{,-rf,-kf}` mot 2022-facit och håll
  RD 349 / RF 20/20 / KF exakt.
- **Varje ny tabell i schemat `public` måste ha RLS aktiverat** — annars exponeras
  den via PostgREST (se [SECURITY.md](./SECURITY.md)).
- **Committa aldrig rådata eller genererade artefakter** (`.zip`/`.xlsx`/
  `.geojson`/`.pmtiles` …) — de är gitignore:ade och regenereras från källan.
- Kod och identifierare får vara på engelska, men **datamodellens fältnamn följer
  doc:en** (`valdistriktskod`, `partikod`, …); docs och UI-text är svenska.

## Säkerhet

Rapportera **inte** säkerhetshål i publika issues. Använd GitHubs privata kanal
(**Security → Report a vulnerability**) enligt **[SECURITY.md](./SECURITY.md)**,
som också beskriver säkerhetsmodellen (publik anon-nyckel skyddad av RLS, inga
hemligheter i repot).

## Licens

[MIT](./LICENSE) © Lars Månsson. Valresultat-datan kommer från Valmyndigheten och
lyder under deras villkor (se [Datakälla](#datakälla)).
