# Implementationsplan

Detta dokument expanderar byggordningen i [arkitektur.md §9](./arkitektur.md#9-föreslagen-byggordning)
till konkreta faser med acceptanskriterier, och väver in när infrastruktur ska
sättas upp. **Faserna 1–6 följer §9:s numrering exakt** — arkitektur.md motiverar
*varför*, detta dokument beskriver *ordning, leverabler och grindar*. Vid konflikt
om ordningsföljd gäller detta dokument.

Valdagen: **söndag 13 september 2026** (andra söndagen i september). Idag är det
~7 veckor kvar — de datumstyrda milstolparna nedan är knutna till det datumet.

---

## Infrastruktur — två sorters triggers

"Hur och när" för infrastruktur styrs av två olika logiker. Blanda inte ihop dem.

### A. Fasstyrd — skapas när den första fasen behöver den

| Tjänst | Trigger (skapa senast här) | Vad som aktiveras |
|--------|----------------------------|-------------------|
| **Supabase** | Fas 1 om geometrin reprojiceras i PostGIS (`ST_Transform`/`ST_Simplify`); annars Fas 2 (referensdata). | Skapa projekt i **EU-region** — drivet av websocket-/Realtime-latens mot svenska användare, inte GDPR (datan är offentlig aggregerad statistik). Aktivera `postgis` via migration i Fas 0 (behövs först för reprojicering); `pg_cron`/`pg_net` skjuts upp till Fas 3 (slås på via Dashboard → Extensions när ingestion schemaläggs). |
| **Vercel** | Fas 1 (första frontend-deployen: tom karta). | Koppla GitHub-repot → **automatisk produktionsdeploy vid push till `main`; previews avstängda** (dashboard: Settings → Git → Ignored Build Step, skippa när `VERCEL_ENV != production`). **Vercel hostar bara frontend.** Ingestion körs på Supabase edge functions + `pg_cron`, aldrig Vercel cron. |

### B. Datumstyrd — knuten till valnatten 13 sep 2026

| Milstolpe | Tidpunkt | Åtgärd |
|-----------|----------|--------|
| Generalrep (§10-harness) | T‑minus ~3–4 veckor | Lastning av hela ingest→aggregat→mandat-kedjan på uppspelad 2022-data. Validera mot Valmyndighetens facit. |
| Uppskalning Supabase | T‑minus ~1 vecka | Free → Pro: compute, Realtime-anslutningar, egress. Verifiera att preliminär mandatmodell håller under burst. |
| Uppskalning Vercel | T‑minus ~1 vecka | Bandbreddsmarginal för trafiktopp; bekräfta tile-hosting (se nedan) klarar spiken. |
| Skarp drift | Valnatten | Tätare cron-kadens (30–60 s) för resultatfiler; bevaka rapporteringsgrad. |

### Två infrastruktur-specifika regler (bär hela systemet)

- **Nyckelhygien.** Ingestion-edge-funktionen använder **service-role-nyckeln
  (endast server-side)**. Vercels env får **bara `VITE_SUPABASE_URL` +
  anon-nyckeln**. Service-role-nyckeln får aldrig hamna i frontend-bundlen.
- **Var bor pmtiles?** Öppet infrastrukturval (statisk asset vs pg_tileserv).
  Beslutas i **Fas 1**: Vercel static / Supabase Storage / separat object store —
  välj med valnattens bandbreddstopp i åtanke. Servas alltid som statisk asset,
  aldrig per-request genom DB:n.

---

## Faser

### Fas 0 — Projektuppsättning & infrastrukturgrund

**Mål:** körbart skelett, deploybart, med infrastruktur-konton på plats.

- Scaffold Vite + React 18 + TypeScript (Vite 6 för Node-kompat); lägg på
  Tailwind **v3** + shadcn/ui (stable-CLI:n; shadcn ≥4 kräver Tailwind v4).
  Node **≥20.19** krävs av toolingen (`.nvmrc` + `engines` satta).
- `npm run dev` kör på **fast port 5926** (`strictPort`) så den aldrig krockar
  med andra projekt under `c:\dev`.
- Supabase CLI + migrations-mapp (`supabase/migrations/`). **Ingen lokal Docker:**
  vi kör migrations mot **moln-projektet** (`supabase link` → `supabase db push`),
  inte `supabase start`.
- Skapa Supabase-projekt (EU) och Vercel-projekt (koppla repot). Sätt env:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` i Vercel; service-role-nyckeln
  auto-injiceras i edge functions (ingen `secrets set`), aldrig i Vercel/klient.
- `.env.example` incheckad; riktiga `.env`/`.env.local` gitignore:ad (redan
  konfigurerat).

**Acceptans:** en tom app deployar automatiskt till **Vercel produktion vid push
till `main`** (inga previews); `npm run build` passerar; migrations kan appliceras
mot **moln-Supabase** via `supabase db push`.

### Fas 1 — Geometri (§9.1)

**Mål:** tom karta över alla ~6 500 distrikt renderad i klienten.

- Ladda läns-zip:arna (SWEREF99 TM / EPSG:3006).
- Reprojicera → WGS84 (EPSG:4326), förenkla (`ST_SimplifyPreserveTopology`).
- Generera vektortiles (pmtiles via tippecanoe, eller Martin/pg_tileserv).
- **Infra-beslut:** var pmtiles hostas (se ovan) — låst i denna fas.
- MapLibre GL laddar tiles en gång; joinnyckel `valdistriktskod` i paint-uttryck.

**Infra:** Supabase krävs om reprojicering görs i PostGIS (annars offline). Vercel
för första deployen.

**Acceptans:** hela riket ritas som distrikt i webbläsaren; tiles laddas som
statisk asset; ingen 27 MB GeoJSON går till klienten.

**Status: klar & verifierad (dev + prod headless).** Beslut som låstes:
- **Källa:** `www.val.se/download/<cms-id>/.../valdistrikt-riket-2026.zip` (en enda
  ren GeoJSON, EPSG:3006 — inte den gamla per-län-JSON:en; se arkitektur.md §1.1).
  Index: [råvaru-sidan](https://www.val.se/valresultat-och-statistik/statistik-och-data/radata-val-2026).
- **Pipeline:** `mapshaper` (ren npm, inget Docker/tippecanoe) — förenkla i plana
  meter, reprojicera 3006→4326, precision 1e-5. Ut: **6.25 MB GeoJSON, 6 312
  distrikt** (reprojicering verifierad mot bounds + Blekinge-koordinat).
- **Format:** rå GeoJSON (ingen pmtiles behövs vid den storleken); MapLibre läser
  nativt, `promoteId: 'Valdistriktskod'` för resultat-join i Fas 5.
- **Hosting:** **Supabase Storage** (publik CDN-bucket `geometry`). Prod pekas via
  `VITE_GEOMETRY_URL`; lokalt servas filen från `public/`. Filen committas aldrig.
- **maplibre-gl pinnad till v5.24.0** — v6.0.0 har en trasig prod-worker (loadData
  hänger) + dev-worker som inte laddas via Vites optimizer. Rör inte utan att
  headless-verifiera bygget (`scripts/verify-map.mjs`).

### Fas 2 — Referensdata (§9.2)

**Mål:** `party`, `district`, `district_comparison` fyllda från redan publicerade
2026-filer.

- Migrations för de tre tabellerna (schema enligt arkitektur.md §4).
- `district_comparison.koder_foreg` som `text[]` (0..N träffar, inte fasta kolumner).
- Bygg 8-siffrig `valdistriktskod` (län+kommun+distrikt) vid ingest.

**Infra:** Supabase krävs senast här om inte redan uppe.

**Acceptans:** distrikt i kartan kan färgas/slås upp mot referensdata på `valdistriktskod`.

**Status: klar & verifierad.** Genomfört:
- Migration `20260728100000_reference_tables.sql` (party/district/district_comparison,
  utan geom) + `20260728110000_grant_service_role_reference.sql` — applicerade via CI
  (GitHub Action, se Fas 3-noten). RLS på + anon SELECT-grant/policy; service_role
  skrivgrant (auto-expose är av → grants krävs explicit).
- Källor: `district` ur geometrins properties; `party` ur `deltagande-partier.csv`
  (378 partier, husstil, riksdagsfärger via förkortning); `district_comparison` ur
  jämförelse-xlsx (JAMFORELSETYP→JA/NEJ/FLERA, 2022-koder padd:ade till 8).
  Set-likhet geojson↔xlsx verifierad (6312, noll diff).
- Ingest: `npm run ingest:reference` (idempotent upsert, service-role ur `.env.local`).
- Verifierat via anon-klienten: partifärger, distrikt + inbäddad jämförelse (PostgREST
  FK-join), FLERA-fall med 2 paddade koder.

### Fas 3 — Ingestion parti/kandidat-CSV (§9.3)

**Mål:** verifierad poll-pipeline end-to-end mot riktig data.

- Deno edge function: fetch → conditional GET (`Last-Modified` i `ingest_state` —
  ETag honoreras inte av val.se) → strippa BOM → parsa `;` → normalisera
  (decimalkomma, behåll nollor, versala nycklar) → upsert.
- Aktivera `pg_cron` + `pg_net` (medvetet uppskjutna från Fas 0 — de slås på via
  **Dashboard → Database → Extensions**, inte via migration). De schemalägger
  ingestion; kadens 1×/timme i förvalsperioden.
- Exponentiell backoff + jitter vid fel; `304` → hoppa parsning.
- **Migrationer via GitHub Action** (infört i Fas 2, se `.github/workflows/db-migrate.yml`).
  Kör `supabase db push` vid push till `main` när `supabase/migrations/**` ändras —
  speglar Vercel-modellen (bara `main`, ingen preview). **Inte** Supabase Branching
  (betald add-on, krockar med "inga previews"). Repo-secrets: `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DB_PASSWORD` (projekt-ref är publik, hårdkodad i workflow:en).

**Acceptans:** alla datafallgropar (§1.2) hanterade och verifierade mot faktisk
`data.val.se`-fil; conditional GET ger `304`-skip; ingen körning duplicerar rader.

**Status: klar & verifierad.** Genomfört:
- Migration `20260728120000_ingest_state.sql` (conditional-GET-state) — via CI.
- Edge function `ingest-parti` (`supabase/functions/`): **If-Modified-Since** →
  304-skip → husstil-parsning (BOM/`;`/versala nycklar/nollor) → idempotent upsert
  `party` (rör inte `color`). Deployad via `.github/workflows/deploy-functions.yml`.
  Service-role auto-injiceras (ingen `secrets set`).
- **Viktigt:** ETag returneras av val.se men honoreras INTE (`If-None-Match`→200);
  `Last-Modified`/`If-Modified-Since`→304. `ingest_state.last_modified` driver skip.
- Schemalagt: `20260728130000_schedule_ingest_parti.sql` — `pg_cron` (minut 7/timme)
  → `pg_net` → funktionen. `pg_cron`/`pg_net` aktiverade via Dashboard.
- Verifierat: 2× direkt-anrop (1:a upsert 378, 2:a 304-skip); färger orörda; inga
  dubbletter; cron/pg_net-vägen bevisad via `ingest_state.last_ok`.

### Fas 4 — Resultatschema + mandatmodul (§9.4)

**Mål:** idempotent resultatlagring + mandatberäkning mot historisk 2022-data som
stand-in tills 2026-filerna publiceras.

- `result` (upsert på `(valtyp, valdistriktskod, partikod)`, `updated_at`,
  `status`) + append-only `result_snapshot`.
- Aggregat (kommun/län/rike, valdeltagande, vinnande parti) som materialiserade
  vyer eller triggade summeringstabeller.
- Mandatmodul: jämkade uddatalsmetoden (Sainte-Laguë, första divisor 1,2), 349
  mandat (310 fasta + 39 utjämning), spärrar som **konfig, ej hårdkodat**.
- Delta mot förra valet joinas via `district_comparison`, inte direkt på koden;
  `FLERA` summeras, `NEJ` markeras "ingen jämförelse".

**Acceptans:** mandatberäkning på 2022:s slutliga data matchar Valmyndighetens
mandatfil exakt (regressionstest för hela kedjan).

**Status — mandatmodul + resultatschema klara.**
- Ren TS-modul `src/lib/mandate.ts` (röster in → mandat ut, spärrar/divisor/fasta
  mandat som konfig). `result` + `result_snapshot` migrerade (FK mot 2026 års
  district/party; anon läser, service_role skriver).
- Verifierat mot 2022 RD-facit (`npm run verify:mandate`, 5 steg):
  röstaggregat (6 477 970) → spärrset (8 partier) → fasta mandat → **349 exakt mot
  Riket-facit**. Steg B (fasta per valkrets) verifieras *diskriminerande*: exakt
  match mot Valkrets-facit på de 9 "rena" valkretsarna (dit inget utjämningsmandat
  föll, så totalt == fasta) + invarianten fasta ≤ totalt på alla 29.
- **Overifierat av detta dataset:** överhängsgrenen (steg D set-aside) triggas inte
  av RD 2022 — täcks nu av ett syntetiskt handräknat fall, men verifieras skarpt
  först när RF/KF körs (regioner/kommuner har överhäng). Utjämningsmandatens
  *placering per valkrets* (steg E) är inte implementerad — behövs inte för
  riks-mandaten och skjuts till när kart-paint kräver mandat per distrikt.

### Fas 5 — Realtime + kart-paint (§9.5)

**Mål:** förändringar pushas och animeras i kartan.

- Supabase Realtime: prenumerera på `result`-ändringar (ev. filtrerat på `valtyp`).
- Vid burst: edge-funktionen `broadcast`:ar färdiga aggregat/deltan på en kanal
  i stället för att CDC:a varje rad; klienten debouncar repaint.
- MapLibre paint: `match`/`interpolate` på partikod/marginal + "just
  inrapporterad"-puls; ticker över inrapporterade distrikt; drill-down rike→län→kommun.

**Acceptans:** en simulerad upsert syns i kartan inom sekunder utan omladdning;
repaint debouncad under burst.

### Fas 6 — Generalrep (§9.6, §10-harness)

**Mål:** hela kedjan lastad på en uppspelad *riktig* valnatt före skarpt läge.

- Konvertera 2022 XLSX → normaliserade rader; syntetisera inrapporteringsordning
  (klungor, viktat på storlek).
- `replay_clock` matar in i `result_snapshot` + `result` i komprimerad tid
  (t.ex. 3 h → 3 min) via **samma ingest-kod** som skarp drift.
- Validera aggregat + mandat mot 2022:s facit.

**Infra (datumstyrt):** kör generalrepet vid T‑minus 3–4 veckor; skala upp
Supabase/Vercel efteråt baserat på observerad last.

**Acceptans:** replay av 2022 ger exakt rätt slutligt mandatresultat; Realtime,
kart-paint och mandatprojektion triggas som skarpt; observerad resursförbrukning
ligger till grund för uppskalningsbeslutet.

---

## Öppna punkter att lösa under resans gång

- Den exakta JSON-endpoint som `resultat.val.se`-SPA:n pollar på själva kvällen är
  odokumenterad — fånga via DevTools under generalrep, eller arbeta mot de
  nedladdningsbara filerna på `data.val.se/filer/val2026/...` (arkitektur.md §9).
- Resultatfilernas exakta 2026-schema är inte publicerat — ha staging-tabell med
  lös typning som buffert (arkitektur.md §8).
- Tile-hosting (Fas 1) och Realtime-broadcast-granularitet (Fas 5) är de två
  infrastrukturval som mest påverkar valnattens skalbarhet.
