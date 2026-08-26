# Valvaka 2026

Realtidsvisualisering av valresultat per valdistrikt för det svenska valet 2026,
med [data.val.se](https://data.val.se) som enda källa.

Klienterna rör aldrig val.se: en ingestion-worker pollar de statiska filerna,
normaliserar till Postgres, och Supabase Realtime pushar förändringar ut till
kartklienten. På så vis byggs en egen realtidsfeed ovanpå en källa som bara
publicerar platta filer på schema.

**Live:** [valvaka-2026.vercel.app](https://valvaka-2026.vercel.app) — färgas just nu
av Valmyndighetens **generalrepetition** (testdata) tills skarpa resultat flödar på
valnatten 13 sep 2026.

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
  kartan, en live resultattabell, resultatstaplar (mandat + röstandel) och en departure board-ticker från
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
  (`npm run verify:aggregate`). Ovanför tabellen ritas resultatet som **två liggande
  staplar** (ersätter den tidigare mandatsoffan — kompaktare och mer lättläst): en
  **röstandelsstapel** och en **mandatstapel**, båda med partierna vänster→höger i
  politisk spektrumordning (V·S·MP·C·L·KD·M·SD) och en vit **50 %-linje** — halva
  väljarkåren respektive egen majoritet. Röstandelsstapeln visar **bara partier över
  spärren**; rösterna under spärren lämnas som ett tomt spår (bortkastade röster), så
  den summerar medvetet till < 100 % och 50 %-linjen förblir sann. Mandatstapelns bredd
  = totala mandat och matas, där ett organ faktiskt fördelas (RD@riket, RF@region,
  KF@kommun), från samma facit-verifierade mandat som tabellen. Varje riksdagsparti
  etiketteras inne i stapeln med läsbar textfärg mot bakgrunden. Under varje stapel
  ligger en tunn **2022-spökstapel** som baslinje (då-vs-nu), och innan 2026 kommit in
  faller stapeln tillbaka på 2022 så ytan aldrig står tom; medan det räknas bär
  röstandelsstapeln en amber **`Prognos · X %`**-markering. Partifärgerna följer
  `party.color` — V är medvetet en mörkare vinröd (`#8B0016`) än S så de två röda går
  att skilja åt. Mandatmodulen som staplarna matas ur täcks av `npm run verify:aggregate`.

- **Departure boards — live-tickers (klar).** Över kartan (nedre vänster) **tre**
  avgångstavlor, en per val (**Riksdag / Region / Kommun**), alltid synliga samtidigt:
  var och en visar sitt vals inrapporterade valdistrikt nyast överst (tid, **full
  hierarkiväg** i stället för bara distriktsnamnet — t.ex. kommun › valkrets › distrikt —,
  de **fem största partierna** med andel, färgkodad vänsterkant) samt rapporteringsgrad
  (t.ex. RF exkl. Gotland som saknar regionval). Prenumererar på samma per-distrikt-notis som kartan
  (`subscribeChanges`), rAF-koalescerad så den tål valnattsburst; seedas ur redan
  inrapporterade distrikt vid laddning (snapshot fanar inte ut till listeners). Nya
  distrikt glider in med en kort blänk; klick på en rad byter till det valet och drillar
  tabellen till distriktet.

- **Partilegend (klar).** Uppe till vänster kopplar en legend kartans distriktsfärger
  till parti: de 8 riksdagspartierna i politisk vänster→höger-ordning (färg ur
  `party.color`), plus "Lokalt parti" (grå — rapporterad vinnare utan märkesfärg,
  t.ex. lokala partier i region/kommun) och "Ej rapporterat" (mörkgrå). Färgerna
  importeras från kartan (en sanningskälla, ingen drift).

- **Status + tidsstämpel (klar).** Kartans rapporteringsgrad-HUD (överst) fick en
  live-status: en pulsande **Live/Offline**-prick som speglar Realtime-kanalens
  faktiska anslutning (`realtimeConnected` ur providerns `subscribe`-status), och en
  **"uppdaterad HH:MM:SS"**-stämpel som sätts när data ändras (piggybackar på kartans
  rAF-flush → inga extra renders). Räknaren märks dessutom **`Preliminärt`/`Slutgiltigt`**
  (datastyrt via `dataset_meta.rakningstillfalle`) — valnattens `X av 6 312 valdistrikt`
  är preliminärt tills Länsstyrelsernas slutliga sammanräkning (personröster + sena
  uppsamlingsröster tillkommer då). Gäller alla tre valen.

- **Drill-down + aggregat-paneler (klar).** Panelen har en **breadcrumb** med
  klickbara förfäder (navigera uppåt) och en **"Bryt ner"-matris** över det valda
  områdets barn (klick på rad → drilla nedåt). Hierarkin
  är valtyp-medveten: **RD: riket → valkrets → kommun → distrikt** (riksdagens riktiga
  nivå under Riket är de **29 valkretsarna**, inte län — mandaten delas ut per valkrets
  och val.se bryter ner RD så); **RF: region → valkrets → distrikt** (regionvalet delas
  också per valkrets — Stockholm i 12 valkretsar tvärs över kommungränser, så kommun­nivån
  utgår; 62 valkretsar); **KF: kommun → valkrets → distrikt** (17 kommuner är indelade i
  valkretsar — Stockholm 6, Linköping/Karlskrona/Borås 3, …). **Generell regel:** "Bryt ner"
  är alltid nästa FAKTISKT finare indelning — en nivå som bara speglar området (enkommuns-
  valkrets = kommun, en oindelad kommuns enda valkrets, en en-valkrets-region) hoppas över
  i både drill och breadcrumb. Alltså syns valkretsnivån bara där den verkligen delar
  (RD läns-valkretsar, RF fler-vk-regioner, de 17 indelade KF-kommunerna); annars går man
  direkt till distrikt. Valkrets är inte ett kod-prefix (Stockholm/Skåne/VG delas i flera
  valkretsar inom samma län), så providern förberäknar ett valkretsindex per valtyp
  (`districtToVk`/`vkToDistricts`, plus `kommunToVk` för RD där valkretsen är hela kommuner)
  ur distrikt­metadata (`vk_rd` → 2 siffror, `vk_rf` → 4 län-prefixade, `vk_kf` → 6 kommun-
  prefixade — tomma koder, t.ex. Gotland utan regionval, faller bort). Övriga hopp är
  prefix-rena (`lib/hierarchy.ts`, testat i `verify:aggregate` steg 10 inkl. Stockholm-
  splittarna + kollapsfallen). Klick-navigation bevisad headless (RD/RF/KF: enkommuns-/en-
  vk-nivåer → distrikt; fler-dels → valkretsar/kommuner). Varje barnrad är en **per-parti-
  matris**: en kolumn per riksdagsparti (spektrumordning V·S·MP·C·L·KD·M·SD, färgade rubriker)
  med **andel i en decimal** för live-året + **▲/▼-delta mot 2022** under; radens vänsterkant
  färgas av ledande parti och en "Räkn."-kolumn visar rapporteringsgrad. Innan ett område
  har 2026-röster visas 2022 års andel med en tydlig **"2022"-etikett**; när rösterna kommer
  byts talet till 2026-andelen + deltat (område för område). 2022 per parti hämtas ur
  `comparison-2022.json` (aggregatnivåer) resp. `district_result_2022` (distriktsnivå).

- **Riksdagsmandat per valkrets — 2022 (klar).** På valkretsnivå visar tabellen 2022 års
  **faktiska riksdagsmandat** per parti (ur Valmyndighetens officiella facit, matchar
  val.se exakt — t.ex. Norrbottens län S 4 · SD 2 · M 1 · V 1 = 8; alla 29 valkretsar
  summerar till 349), och 2022-soffan blir en riktig fylld mandatbåge. 2026-mandaten
  projiceras nationellt (349) och lämnas "–" per valkrets (per-valkrets-placering av
  utjämningsmandaten är knivseggs-känslig och beräknas medvetet inte live). Genereras av
  `npm run comparison` (`RD_byValkrets` i `comparison-2022.json`).

- **Region- & kommunval per valkrets — 2022 (klar, andel).** RF drillas region →
  **valkrets** → distrikt (62 valkretsar), KF kommun → **valkrets** → distrikt (314
  valkretsar; `RF_byValkrets`/`KF_byValkrets` + namn). Både region- och kommun­fullmäktige­
  mandaten fördelas visserligen per valkrets (fasta valkretsmandat + utjämning), men den
  per-parti-per-valkrets-uppdelningen publicerar Valmyndigheten **bara på resultat.val.se**,
  inte som nedladdningsfil (de nedladdningsbara facit-filerna aggregerar till region-/
  kommunnivå — till skillnad mot RD, vars per-valkretsmandat finns i officiellt facit).
  Valkretsnivån visar därför **2022 års röstandel** + en tydligt märkt **ungefärlig procent-
  soffa** (mandat "–"), precis som RD:s *live* valkretssoffa. De **exakta** RF/KF-mandaten
  ligger kvar på organet (region resp. kommun), verifierade 20/20 resp. 289/290 mot facit.

Återstår:

- **Skarp valnatt-drift.** Resultat-ingesten är byggd och kör mot Valmyndighetens
  **generalrep** (`genrep2026`, live testdata) via samma edge-function + `pg_cron`
  som valnatten; på valnatten byts källan till `val2026` (en konstant) + tightas
  cron-kadensen (30–60 s). Kvar inför natten: lasttesta klientens läslast (den verkliga
  skalningsrisken — DB:n är uppskalad till Pro med small-compute inför valnatten), samt
  den stora/slutliga RD-filen (post-valnatt: streaming-parse eller Node-worker, då
  ~26 MB-zip:en spränger edge-runtimens 256 MB-tak). Fullständig genomgång i
  **[docs/resultat-ingest-genrep.md](./docs/resultat-ingest-genrep.md)**.

Se **[docs/arkitektur.md](./docs/arkitektur.md)** för hela underlaget och
**[docs/implementationsplan.md](./docs/implementationsplan.md)** för faser och
infrastruktur.

## Stack

| Lager | Val |
|-------|-----|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui |
| Karta | MapLibre GL JS (pinnad v5.24) — statisk GeoJSON via Supabase Storage |
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

Statisk geometri (GeoJSON) ─────────────── laddas en gång ──────────▶ React-klient
```

Geometrin går vid sidan om databasflödet: distrikten är statiska och laddas en
gång som statisk GeoJSON (hostad i Supabase Storage, utpekad via `VITE_GEOMETRY_URL`),
medan bara resultatvärdena flödar i realtid. (Komprimering till vektortiles är en
senare optimering; i dag räcker den förenklade GeoJSON:en.)

## Byggordning

1. Geometri (statiskt, kan göras nu) — ladda, reprojicera SWEREF99 TM → WGS84,
   förenkla, hosta som statisk GeoJSON i Supabase Storage.
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
npm run geometry           # regenerera distriktsgeometrin från källan (mapshaper) + district-bounds.json
npm run bounds             # regenerera bara public/district-bounds.json ur befintlig geometri (fitBounds-underlag)
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
