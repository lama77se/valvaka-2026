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

**Status — realtidsfärgning klar.**
- Migration `20260728150000`: `result` publicerad till `supabase_realtime`.
- Klient (`DistrictMap.tsx` + `lib/results.ts`): prenumererar på `result`
  (postgres_changes, RD-filtrerat) *före* snapshot-hämtning, ackumulerar röster
  per parti per distrikt (`ResultStore`), räknar om vinnare + marginal, och färgar
  via **feature-state** (`coalesce`-paint på tile-features) — geometrin laddas en
  gång, bara resultatvärden flödar. Rapporteringsgrad-HUD ("X av Y distrikt").
- **"Debounce" = rAF-koalescerad** `setFeatureState` (många events/tick → en
  repaint), inte en fördröjande timer — ger "inom sekunder" + burst-tålighet.
- Bevisat headless (`npm run verify:realtime`): Node upsertar som service_role,
  sidan tar emot som anon → feature-state satt **inom ~350 ms**; burst 5/5
  reflekterade; service_role rör aldrig webbläsaren. Simulator + teardown:
  `npm run simulate:valnatt` / `results:reset`.
- **Medvetet uppskjutet (namngivet, ej luckor):** (a) edge-funktion som
  `broadcast`:ar färdiga aggregat i stället för per-rad-CDC — en *skalnings*-
  optimering för valnattsburst, inte denna acceptans; rAF-batchning bär klienten
  tills vidare. (b) drill-down rike→län→kommun, (c) ticker över inrapporterade
  distrikt, (d) puls-animation, (e) live mandatprojektion (kopplar in Fas 4:s
  modul — egen skiva). RF/KF-realtid följer när de valtyperna ingesteras.

### Fas 6 — Flervals-dimension: RD / RF / KF (§4, §5, §7)

**Mål:** generalisera RD-MVP:n (Fas 3–5) till alla tre valen — riksdag (RD),
region (RF) och kommun (KF) — som **en karta med valtyp-väljare**, per-valtyp
räknare och tre mandatberäkningar.

**Utgångsläge:** dataryggraden är redan flervalsklar och behöver inte byggas om —
`result` har `valtyp` i primärnyckeln, aggregat sker per valtyp, spärrar/divisorer/
fasta mandat är **konfig** (Fas 4), och `district` bär `vk_rd`/`vk_rf`/`vk_kf`. Det
som saknas är RF/KF-*ingestion*, *UI-axeln* och RF/KF-*mandatverifiering*. Fas 3–5
pinnade medvetet `RD`.

**Nyckelinsikt (inte tre kartor):** geometrin är EN uppsättning 6 312 fysiska
valdistrikt för alla tre valen — varje distrikt röstar i alla tre samtidigt. Det
som "tredubblas" är resultat­lagret ovanpå samma geometri, inte distrikten. Därför:
en karta, en väljare som byter vilket `valtyp`-resultat som färgar choropleten.

- **Ingestion RF + KF:** parsa röster-per-distrikt-filerna (en per valtyp, samma
  husstil: BOM/`;`/nollor/decimalkomma) och upserta till `result` med rätt
  `valtyp`. Generalisera RD-ingesten till en valtyp-parameter (samma kod, tre körningar).
- **Valtyp-väljare (bekräftat val — EN karta, inte small multiples):** `RESULT_VALTYP`
  → en `valtyp`-state (default `RD`). Väljaren byter aktiv snapshot + Realtime-
  prenumeration (`filter: valtyp=eq.<vald>`) och färgar om samma tile-features via
  feature-state — ingen omladdning, samma geometri. Motiv: 6 312 delade distrikt,
  sparad skärmyta, direkt jämförbar växling.
- **Per-valtyp rapporteringsgrad:** `Y = 6 312` är oförändrat för alla tre; `X`
  (inrapporterat) skiljer per valtyp (filerna droppar i olika takt). HUD speglar
  vald valtyps grad och byts vid växling.
- **Partifärger per valtyp:** lokala partier i RF/KF saknar riksfärg (`party.color`
  null) → per-valtyp-palett/fallback, annars faller allt på neutralgrått.
- **Mandat ×3:** samma modul (`lib/mandate.ts`), tre configar. RF (regionfullmäktige,
  per region) och KF (kommunfullmäktige, per kommun) har egna platsantal/valkretsar/
  spärrar → verifieras mot 2022 RF/KF-facit.

**Acceptans:** växling RD→RF→KF färgar om samma karta utan omladdning; räknaren
speglar vald valtyp; RF/KF-resultat strömmar via Realtime som RD; mandatberäkningens
partitotal för alla tre valtyper matchar Valmyndighetens 2022-facit.

**Ordning:** bör ligga före ett *fullständigt* generalrep (Fas 7).

**Status — valtyp-väljaren (UI-axeln) klar; RF/KF-mandat återstår.**
- Klient (`DistrictMap.tsx` + `lib/results.ts`): EN `ResultStore` per valtyp,
  prenumererar på ALLA valtyper (inget filter) och routar events per `valtyp`,
  färgar från vald valtyp. Väljaren (Riksdag/Region/Kommun) färgar om samma
  geometri utan omladdning. Nämnaren härleds per valtyp ur `count(vk_<valtyp> ej
  null)` — inte hårdkodad 6312 (Gotland/regionval-fallet).
- Växlingen färgar om **unionen** av alla valtypers distrikt → distrikt som fanns
  i förra valtypen men saknas i den nya nollställs till grått (feature-state
  persisterar annars). Regressionstestat.
- Bevisat headless (`npm run verify:realtime`): enkel upsert ~350–500 ms, burst
  5/5, **och växling** — RF-distrikt färgas + RD-only-distrikt blir grått i
  Region-vyn. Simulator tar `--valtyp RD|RF|KF|alla`.
**Status — Track B (RF/KF-mandat) verifierad mot 2022-facit.**
- Modulen generaliserad: `computeRiksdag` → `computeAssembly` (samma jämkade
  uddatalsmetod driver alla tre; bara config skiljer). RD oförändrat (349 exakt).
- **RF** (`npm run verify:mandate-rf`): partitotal per region = regionvid
  proportionell (jämkad 1,2, ≥3 %) matchar facit **20/20 regioner exakt**.
- **KF** (`npm run verify:mandate-kf`): partitotal per kommun (spärr **2 % odelad /
  3 % delad** — 17 delade 2022) matchar facit **289/290 exakt**. De två avvikelserna
  är inte metodfel: Vårgårda avgjordes av **lottning** vid exakt lika jämförelsetal
  (279/3 = 1023/11 = 93), och Tyresö ändrade fullmäktigestorlek (51 → 61) efter att
  fasta-filen skapades → använd faktisk 2022-storlek.
- **Överhängsgrenen förblir OVERIFIERAD av verklig data.** Rättelse mot tidigare
  antagande: 2022 har inga verkliga överskottsmandat i RD/RF/KF — partitotalen ÄR
  den proportionella fördelningen. Steg D:s set-aside täcks alltså bara av det
  syntetiska Fas-4-fallet. Min per-valkrets fasta-fördelning (steg B) avviker med
  ett mandat i knivseggs-valkretsar (<0,4 %) och tillverkade *spuriösa* överhäng —
  därför verifieras **partitotalen** (det produkten visar), inte exakt placering.
- **Uppskjutet:** exakt mandat*placering* per valkrets (steg B/E) behövs ej för
  produkten (2026 visar röster/distrikt + partitotal/församling). RF/KF-*ingestion*
  av skarp 2026-data görs när filerna publiceras (parsern är valtyp-parametriserad).
- **2026-flagga (beslut, ej latent bugg):** beräkna live-partitotal från den
  församlingsvida proportionalen och grinda överskottsmandat konservativt — lita
  inte på per-valkrets-fasta-summan för att *detektera* överhäng (knivseggs-känsligt).
- **Demogräns:** simulatorn använder de 8 färgade riksdagspartierna även för
  RF/KF; riktiga lokala partier saknar färg (grå) tills en per-valtyp-palett finns.

### Fas 7 — Generalrep (§9.6, §10-harness)

**Mål:** hela kedjan lastad på en uppspelad *riktig* valnatt före skarpt läge —
nu för alla tre valtyper (RD/RF/KF) efter Fas 6.

- Konvertera 2022 XLSX → normaliserade rader; syntetisera inrapporteringsordning
  (klungor, viktat på storlek).
- `replay_clock` matar in i `result_snapshot` + `result` i komprimerad tid
  (t.ex. 3 h → 3 min) via **samma ingest-kod** som skarp drift.
- Validera aggregat + mandat mot 2022:s facit, per valtyp.

**Infra (datumstyrt):** kör generalrepet vid T‑minus 3–4 veckor; skala upp
Supabase/Vercel efteråt baserat på observerad last.

**Acceptans:** replay av 2022 ger exakt rätt slutligt mandatresultat; Realtime,
kart-paint och mandatprojektion triggas som skarpt; observerad resursförbrukning
ligger till grund för uppskalningsbeslutet.

**Status — generalrep-harness (delmängd); fullständig trohet väntar på skarp ingest.**
Det *fullständiga* generalrepet delar "exakt samma ingest-kod som skarp drift"
(§10). Den skarpa RESULTAT-ingesten finns inte än (blockerad på 2026 års opublicerade
filschema; Fas 3 byggde parti-CSV-ingest, ej roster-per-distrikt). Byggt nu = den
durabla, återanvändbara delmängden, uppdelad i två dataidentiteter (advisor):

- **Korrekthet — replay + live mandatprojektion** (`npm run replay:2022 -- --valtyp
  RD|RF|KF`, `scripts/replay-2022.ts`): kör på ÄKTA 2022-geografi. Parsar rostern →
  röster per distrikt, syntetiserar storleksviktad inrapporteringsordning (klungor),
  driver en replay-klocka i komprimerad tid, och kör en **löpande mandatprojektion**
  (samma verifierade logik som Fas 4/6) som konvergerar mot facit — throttlad till
  ~10 %-milstolpar (KF = 290 organ/omräkning):
  - **RD**: 349-organet via `computeAssembly` → 349 exakt (realistisk tidig
    volatilitet: S överskattas tidigt, L passerar 4 %-spärren ~40 %).
  - **RF**: 20 regionorgan (regionvid proportionell) → **20/20 matchar facit**;
    nationellt aggregat 1 720 regionmandat exakt.
  - **KF**: 290 kommunorgan (spärr 2/3 %) → **290/290 matchar facit** (Vårgårda-
    lottningen synlig i aggregatet: KD 756/L 508 vs facit 755/509, räknad som matchad).
  - Församlingarna "blir klara" en och en allt eftersom deras distrikt rapporteras —
    äkta live-projektionsbeteende.
  - `--stream` matar rostern genom det append-only `result_snapshot` (FK-fria
    replay-fordonet, ~98 k rader för RD) och städar efter sig.
- **Klient-last/throughput** (`npm run loadtest:valnatt`, 2026-koder, riktig karta):
  streamar full RD-valnattsvolym (6 312 distrikt × 8 partier = **50 496 rader**) och
  mäter Realtime-leverans + repaint. **Fynd:**
  - **rAF-koalescerad per-rad-CDC BÄR volymen:** 100 % av raderna nådde klienten,
    alla 6 312 distrikt färgade, ~400 events/s ihållande, drain ~8 s efter sista
    upsert. → broadcast-aggregat-vägen (Fas 5-uppskjuten) behövs **inte** vid denna
    volym — uppskjutningen validerad med data.
  - **Operativt krav upptäckt:** Realtime släpper bara igenom ändringar från
    transaktioner under ett tak (~100 rader); en jättebatch (4 000 rader/txn) tappas
    HELT. **Skarp resultat-ingest måste upserta i små transaktioner** (per distrikt/
    klunga), inte jättebatchar — annars når inget kartan.
  - *Förbehåll:* testet körde RD ensamt; tre valtyper samtidigt ger ~3× event-takt.
    Stream-takten (421 rader/s) begränsades av harnessens round-trips, inte av
    Realtime/klienten — verklig burst kan vara högre. Om nätter/tak överskrids är
    broadcast-vägen redo som nästa steg.

**Kartan under RD-replay:** 2022 ≠ 2026 distriktskoder, så replayen färgar INTE
2026-geometrin (rätt data, fel geografi). On-map-valnatt med äkta geografi väntar
på skarp 2026-data; last testas separat på 2026-koder (ovan).

---

## Presentation (efter faserna — allt utom kartan)

Egen arbetsström för presentationslagret ovanpå datan. **Klientsidig** aggregering
som återanvänder den verifierade mandatmodulen (advisor) — ingen aggregering/mandat
i SQL-vyer (skulle forka den modul Fas 4/6 verifierade).

**Increment 1 — resultattabell (klar).** `<ResultTable>` + ren aggregering
(`lib/aggregate.ts`) driver alla nivåer (rike/region/kommun/valkrets); låst radmodell
där ej wirade fält är `null` → renderas "–". Visar alla partier ≥ 1 %, resten i en
`Övriga partier (N st)`-rad (kollaps vid RENDER; andel/spärr räknas på hela
uppsättningen), med spärr-linje och giltiga-fot. Verifierad mot 2022-facit
(`npm run verify:aggregate`): nationellt aggregat (giltiga 6 477 970, de 8 partierna
över 4 %, S ≈ 30,3 %), Övriga-kollaps, och områdesfiltrering. `ResultPanel` (höger
panel) laddar snapshot + distriktsmetadata och drilldownar Riket → kommun.

**Increment 2 — mandatkolumn (klar).** Använder den VERIFIERADE proportionella
metoden per församling (`proportionalSeats`/`computeMandate` i `lib/aggregate.ts`):
RD nationellt (349), RF per region, KF per kommun; riksaggregat = summa över
församlingar. 2026 års platsantal + spärr genereras ur Valmyndighetens fasta-fil
(`npm run seat-config` → `lib/seatConfig2026.ts`), nycklat på områdeskod (län 2 /
kommun 4 siffror) — ingen fasta-valkretsmandat/namn-mappning behövs eftersom
partitotalen = proportionalen (Fas 6-insikten). Spärr 4 % (RD) / 3 % (RF) / 2–3 %
(KF, delad kommun). Väljaren fick region-nivå. Validerat: RD-proportionell 349 =
2022-facit + config-sanity (`npm run verify:aggregate`). Demonstrerat: RD/Riket 349,
RF/Region Stockholm 149, KF/Kommun Stockholm 101 (3 %, indelad).

**Återstår:**
**Increment 3 — ±2022 (klar).** 2022 års andel + mandat per LÖV-församling (RD riket,
RF per region, KF per kommun) genereras ur 2022-rostern + fasta-2022
(`npm run comparison` → `public/comparison-2022.json`, ~236 kB statisk asset),
nycklat på områdeskod + partinamn (beteckning). Klienten joinar 1:1 (`applyComparison`)
→ fyller `deltaAndel` (procentenheter, grön/röd) + `deltaMandat`; parti utan
2022-motsvarighet → **`ny`**. Aggregatnivåer (RF/KF-riket, KF-region) och valkrets
visar "–" tills vidare. Validerat mot facit (`npm run verify:aggregate`).
Demonstrerat: RD/Riket och KF/Kommun med färgkodade ±andel + ±mandat.

**Återstår:**
- ~~**2022 alltid synligt + full drilldown-täckning**~~ **(klar).** 2022 års andel +
  mandat visas alltid i egna kolumner bredvid 2026 (union-sådda rader → syns även
  innan 2026 kommit in; se `applyComparison`). **Alla valbara nivåer** jämförs nu mot
  2022: RD riket/län/kommun, RF region/kommun, KF kommun. `comparison-2022.json` har
  RD_byLan/RD_byKommun + RF_byKommun med **röstandel per område** (ur respektive
  roster); mandat lämnas "–" på nedbrytningsnivåer där mandat inte fördelas per
  område (riksmandat är nationellt, regionmandat per region). Strikt-omöjliga aggregat
  (RF/KF-riket, KF-region) är bortvalda i väljaren → inga kvarvarande ±2022-luckor.
- ~~**Distriktsnivå i tabellen**~~ **(klar).** Klick på ett valdistrikt i kartan
  visar DET distriktets fullständiga partibrytning i tabellen (röster + andel).
  Minsta kartdelen = minsta tabellnivån (`Level` fick `'distrikt'`; `districtsInArea`
  matchar exakt kod). Mandat och spärr-linjen döljs/visar "–" på distriktsnivå
  (församlingsvida bestämningar, inte per-distrikt — ett distrikt väljer inget organ).
  Distriktsvalet behålls vid valtyp-byte (samma kod i alla tre valen → jämför
  distriktets RD/RF/KF). Bevisat headless: kartklick → väljaren blir `d:<kod>`.
- ~~**2022 på distriktsnivå (DB-lookup)**~~ **(klar).** 2026-distrikt ≠ 2022-distrikt,
  så 2022 föraggregeras per 2026-distrikt via `district_comparison.koder_foreg`
  (JA = 1:1, FLERA = summa, NEJ = "–") in i tabellen `district_result_2022` (alla tre
  valtyper, ~198 k rader, `npm run ingest:district-2022`). Klienten hämtar distriktets
  2022 per klick (cache:at) och fyller 2022-andelskolumnen; mandat förblir "–". ~80 %
  av distrikten (JA+FLERA) får 2022; NEJ visar "–". Bevisat headless: klick på JA-
  distrikt → 2022-kolumnen fylls ur DB.
- ~~**Live + delad state**~~ **(klar).** Result-flödet lyft till en gemensam
  `ResultsProvider` som både kartan och tabellen delar: EN Realtime-prenumeration,
  en `ResultStore` per valtyp (stabil ref), delad `valtyp` + `selectedArea`. Två
  signalkanaler — synkron per-distrikt-notis (kartans rAF-repaint) + strypt
  `revision` (~750 ms, tabellens omräkning). Kartklick → drilldown (kommun); egen
  panel-väljare borttagen (en väljare). Bevisat headless (`verify:realtime`): panel
  går live via Realtime, och delad `selectedArea` driver panelen (dropdown →
  rubrikbyte). Commit `abeeb4d`, prod-deploy READY.
- **Valtyp-medveten områdesväljare (klar, beslut: strikt).** Väljaren erbjuder bara
  nivåer som motsvarar ett *faktiskt valt organ* för valtypen — den aggregerar aldrig
  uppåt förbi den nativa nivån: RD → Riket + geografisk nedbrytning (län/kommun),
  RF → Region (native) + kommun inom, KF → Kommun (native). Ingen KF-riket/län, ingen
  RF-riket (de vore bara röstaggregat utan församling). Vid valtyp-byte nollställs
  området till valtypens native-default; RF/KF utan valt organ visar "välj region/
  kommun"-prompt. Kartklick drillar till native-nivån (RD→kommun, RF→region, KF→kommun).
- **Mandatprojektion / riksdagssoffa (klar).** Halvcirkel (parliament-arc) ovanför
  tabellen: fylld soffa där ett organ fördelas (RD@riket 349, RF@region, KF@kommun)
  ur den verifierade mandatmodulen, annars **ungefärlig procent-soffa** (100 platser
  = procent, largest-remainder `hareSeats`, ingen spärr, ihåliga ringar + `≈`-etikett)
  på nivåer utan organ (RD-nedbrytning, distrikt). **2026 och 2022 visas som två
  bilder sida vid sida** — 2022 (förra valet) fungerar som baslinje och ligger kvar
  även efter att 2026 börjat räknas, så innan första rösten syns förra valets soffa i
  stället för tom yta. **50 %-linje** rakt genom valvet visar var egen majoritet skär.
  Geometrin i `lib/soffa.ts` (ren/testbar); `seatPositions` + `hareSeats` täckta av
  `npm run verify:aggregate` (steg 8–9). Bevisat headless (Playwright).
- **Departure board-ticker (klar).** `DepartureBoard.tsx` — avgångstavla över kartan
  (nedre vänster) med inrapporterade valdistrikt, nyast överst: tid, distriktsnamn,
  ledande parti (färgchip + andel), färgkodad kant. Tappar samma per-distrikt-notis
  som kartan (`subscribeChanges`), rAF-koalescerad (burst-tålig), följer vald valtyp,
  seedas ur store vid laddning (snapshot fanar ej ut till listeners → seed på
  `snapshotVersion`). Radklick → distrikt-drilldown. Bevisat headless (ladda-först-
  sedan-simulera): live-tickning + seed + vinnarchip.
- **Partilegend (klar).** `PartyLegend.tsx` — uppe till vänster, kopplar kartans
  distriktsfärger till parti: 8 riksdagspartier i politisk ordning (färg ur
  `party.color`) + "Lokalt parti" (grå) + "Ej rapporterat" (mörkgrå). Färgkonstanterna
  exporteras från `DistrictMap` (en sanningskälla). Dedupar förkortning över valtyper.
- **Status + tidsstämpel (klar).** Kartans rapporteringsgrad-HUD fick en Live/Offline-
  prick (speglar Realtime-kanalens `subscribe`-status via providern) + "uppdaterad
  HH:MM:SS" (stämplas i kartans rAF-flush + vid snapshot → inga extra renders).
- **Drill-down + aggregat-paneler (klar).** Breadcrumb (klickbara förfäder → navigera
  upp) + "Bryt ner"-lista över barnen (ledande parti + rapporteringsgrad, klick →
  drilla ned). Valtyp-medveten hierarki i ren, testbar `lib/hierarchy.ts`; barn visar
  även 2022-vinnaren. `verify:aggregate` steg 10, klick-navigation bevisad headless.
- **RD:s nivå under Riket = VALKRETS (klar, omstrukturering).** Riksdagens riktiga
  fördelningsnivå är de 29 valkretsarna, inte län (mandat per valkrets; val.se bryter
  ner RD så). RD-hierarkin: riket → valkrets → kommun → distrikt. Valkrets är metadata
  (`district.vk_rd`), inte kod-prefix (Stockholm/Skåne/VG delas i flera valkretsar inom
  ett län), så providern förberäknar `kommunToVk`/`vkToDistricts` (valkrets byggs av
  hela kommuner → många-till-en). **Kritisk fälla:** `vk_rd` är opaddat i DB ("1".."29")
  men facit-koderna paddade → normaliseras till 2 siffror på EN plats, annars faller
  Stockholms två ensiffriga valkretsar (01/02) tyst bort. Stockholm-splitten testas i
  `verify:aggregate` steg 10 + bevisad headless (vk 01 = bara Stockholm, vk 02 = övriga).
- **2022 riksdagsmandat per valkrets (klar).** Tabellen visar 2022 års faktiska mandat
  per parti på valkretsnivå ur Valmyndighetens facit (`rd-jamforande` 'Valkrets'-bladet →
  `RD_byValkrets` i comparison-2022.json), matchar val.se exakt (Norrbotten S4/SD2/M1/V1=8;
  alla 29 → 349), och 2022-soffan blir en fylld mandatbåge. 2026 projiceras nationellt →
  "–" per valkrets (utjämningsmandatplacering beräknas ej live). Facit-fallgropar fångade:
  "Summa"-rad exkluderas (dubblade annars totalen), parti-rader tilldelas (ej summeras).
- **RF:s nivå under regionen = VALKRETS (klar, omstrukturering).** Regionvalet fördelas
  också per valkrets, men — till skillnad mot RD — är RF-valkretsen INTE hela kommuner:
  Stockholm delas i 12 valkretsar tvärs över kommungränser. Därför utgår kommunnivån och
  RF-hierarkin blir region → valkrets → distrikt (62 valkretsar). Indexet generaliserades
  per valtyp: `districtToVk`/`vkToDistricts` (distrikt→valkrets är alltid entydigt) + för
  RD dessutom `kommunToVk`. **Fälla (samma familj som `vk_rd`):** `vk_rf` är län-prefixat
  men opaddat i DB ("112") och TOMSTRÄNG för Gotland (saknar regionval) → normaliseras till
  4 siffror på EN plats, tomt = null. Verifierat med **set-likhet** mot rostern (exakt de 62
  koderna, inte bara en Stockholm-stickprovskoll) + `verify:aggregate` steg 10b (Sthlm kommun
  0180 i två RF-valkretsar 0101≠0104).
- **2022 regionmandat per valkrets — medvetet EJ per valkrets.** RF-valkretsnivån visar
  2022 års **röstandel** (`RF_byValkrets`) + ungefärlig procent-soffa, mandat "–". Den
  per-parti-per-valkrets-uppdelningen (fasta valkretsmandat + utjämningsplacering) publicerar
  Valmyndigheten bara på resultat.val.se, inte som nedladdningsfil — de nedladdningsbara
  facit-filerna (`mandat-2018-2022` = `Mandatfordelning-jamforelser`) aggregerar RF till
  **regionnivå**. Att beräkna per-valkretsplaceringen är knivseggs-känsligt (±1 i tighta
  valkretsar, se `verify-mandate-rf` steg B/E) och ger ingen bättre precision än live-läget.
  De exakta RF-mandaten ligger kvar på regionnivå (organet), verifierade 20/20.

---

## Öppna punkter att lösa under resans gång

- Den exakta JSON-endpoint som `resultat.val.se`-SPA:n pollar på själva kvällen är
  odokumenterad — fånga via DevTools under generalrep, eller arbeta mot de
  nedladdningsbara filerna på `data.val.se/filer/val2026/...` (arkitektur.md §9).
- Resultatfilernas exakta 2026-schema är inte publicerat — ha staging-tabell med
  lös typning som buffert (arkitektur.md §8).
- Tile-hosting (Fas 1) och Realtime-broadcast-granularitet (Fas 5) är de två
  infrastrukturval som mest påverkar valnattens skalbarhet.
