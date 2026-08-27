# Resultat-ingestion — körs mot GENERALREPET (genrep2026)

> **Kartan färgas just nu av Valmyndighetens _generalrepetition_ — testdata, inte
> skarpa valresultat.** Det syns i UI:t (amber-banner högst upp) och i datan
> (`dataset_meta.test = true`). På valnatten 13 sep 2026 byter vi källa till den
> skarpa katalogen och bannern försvinner av sig själv.

Detta är den **skarpa valnatt-ingesten** ("2026-resultat flödar in"), inte ett
engångsskript. Samma pipeline körs på valnatten — vi pekar den bara på generalrepets
katalog nu för att verifiera hela kedjan i förväg mot en live, kontinuerligt
uppdaterad feed.

## Kedja

```
resultat.val.se/resultatfiler/<base>/index.md5   (manifest: md5 + organ-zip)
        │  pg_cron var 2:e min → net.http_post
        ▼
supabase/functions/ingest-result  (Deno edge function — BARA preliminära /p/-filer)
        │  md5-diff (ingest_state) → hämta ändrade organ-zip → STREAMA (fflate + SAX)
        │  → filtrera mot FK → batch-upsert   (ALLA slutliga /s/-filer: lokalt skript, se nedan)
        ▼
result + uppsamling_result (Postgres) ──Realtime──►  kartan färgas + rapporteringsgrad tickar
dataset_meta (1 rad) ──────────────────►  provenance-banner (genrep/testdata)
```

- **Funktion:** [`supabase/functions/ingest-result/index.ts`](../supabase/functions/ingest-result/index.ts)
- **Schema:** [`20260818120000_schedule_ingest_result.sql`](../supabase/migrations/20260818120000_schedule_ingest_result.sql) (pg_cron, `*/2 * * * *`)
- **Provenance:** [`20260818100000_dataset_meta.sql`](../supabase/migrations/20260818100000_dataset_meta.sql)
- **Deploy:** `.github/workflows/deploy-functions.yml` (push till `main` → `supabase functions deploy`)

## Källa (base) — genrep nu, skarpt på valnatten

| | Katalog | Status |
|---|---|---|
| **Generalrep (nu)** | `resultat.val.se/resultatfiler/genrep2026` | live, `test:true`, ~314 organ-zip |
| **Skarpt (valnatten)** | `resultat.val.se/resultatfiler/val2026` | 404 tills 13 sep, sen samma format |

Bytet är **en konstant**: `RESULT_BASE_DEFAULT` i funktionen. (Funktionen tar även
`{ "base": "…" }` i POST-body för lokal test mot en annan katalog.)

## Generalrep-testfönster (17 aug – 2 sep 2026)

Genrepet är **inte** en kontinuerlig feed — Valmyndigheten kör schemalagda simuleringar
(tiderna är "mycket preliminära", och filerna raderas efter varje veckas körningar).
Valnatts-simuleringen (preliminär valkväll — det som liknar skarpa natten mest) körs på
måndagar; mellan körningarna hittar cron:en `changed:0` (no-op, korrekt).

| Vecka | Valnatt (preliminär) | Uppsamling + slutlig |
|---|---|---|
| 1 | mån 17 aug 13–15 | tis 18 aug 10–12 / 13–15 · ons 19 aug 08–12 |
| 2 | **mån 24 aug 13–15** | tis 25 aug 10–12 / 13–15 · ons 26 aug 08–12 |
| 3 | **mån 31 aug 13–15** | tis 1 sep 10–12 / 13–15 · ons 2 sep 08–12 |

Fönstret **stänger 2 sep**; sen är genrep troligen tyst tills `val2026` dyker upp ~13 sep.
Kör ett **sista live end-to-end-test under en valnatts-simulering (mån 13–15)** — då
pushas preliminär valkvällsdata så man ser kartan fyllas i realtid, precis som skarpa
natten. Källa: `teknisk-beskrivning-av-resultatfiler` (val.se).

## Format (verifierat mot genrep 2026-08-18)

Resultatfilerna är **JSON** (inte husstil-`;`-CSV som referensfilerna på `data.val.se`).
En zip per organ — RD riket (`00`), RF per region, KF per kommun — innehåller
`…_rostfordelning_<kod>_<VT>.json`. Röster som räknas:
`valdistrikt[].rostfordelning.rosterPaverkaMandat.partiRoster[].antalRoster`.

**FK-filtrering (annars bryter `result`s foreign keys):**
- Uppsamlingsdistrikt (`valdistriktstyp === 'uppsamlingsdistrikt'`, kod ≠ 8 siffror t.ex.
  `011400`) routas till **`uppsamling_result`** per explicit kommunkod/lankod (ej `result`).
- `partikod` som saknas i `party` hoppas över. (I genrep 2026: 0 tappade — full täckning.)

## Rollfördelning edge / lokalt skript

Edge tar **bara de preliminära (`/p/`) filerna** — det är allt som finns på valnatten och de ryms i
edge:ns CPU-tak. **Alla slutliga (`/s/`) filer** — riks-RD + alla 21 RF + alla ~290 KF — tas av det
lokala Node-skriptet (se nedan). Slutliga filer bär personröster (tunga att parsa); en klunga
medelstora slutliga i EN edge-invokering summerar >2 s CPU → `WORKER_RESOURCE_LIMIT`, och odelade
riks-RD spränger taket ensam. Att helt hålla `/s/` borta från edge tar bort hela den krasch-risken.

## Kadens & första fyllning

`MAX_FILES = 25` organ-filer per körning + en **CPU-budget** (~6 MB strömmade zip-bytes/invokering)
som säkerhetsnät: preliminära filer är små, så budgeten bör aldrig lösa ut i praktiken. Första
fyllningen tar några varv, sen hämtas bara det som ändrats. På valnatten: tighta kadensen (30–60 s)
i en egen migration.

## Verifiera lokalt

```bash
# Deno-vägen (unzip via esm.sh fflate) — ingen Supabase krävs:
deno run --allow-net supabase/functions/ingest-result/index.ts   # servas; POST {base} för test

# eller hela funktionen mot remote-DB:
supabase functions serve ingest-result --env-file .env.local
curl -XPOST localhost:54321/functions/v1/ingest-result -d '{"base":"https://resultat.val.se/resultatfiler/genrep2026","max":5}'
```

Städa testdata ur `result` med `npm run results:reset` vid behov.

## Slutliga filer — lokalt Node-skript (`npm run ingest:slutlig`)

**Alla slutliga (`/s/`) filer tas här, inte i edge** — riks-RD + alla 21 RF + alla ~290 KF. De
bär personröster och är tunga att parsa: riks-RD publiceras odelat nationellt (~260 MB uppackad),
de största regionerna blir ~50–95 MB. Edge kan INTE parsa de största — Supabase-edge har **~2 s
CPU/request** och att tokenisera 260 MB spränger det på ~4 s (`WORKER_RESOURCE_LIMIT`), och en
klunga medelstora slutliga summerar också >2 s → krasch. Den monolitiska JSON:en går inte att
chunka/resume:a (till skillnad från transport-repots radbaserade CSV). Node har inget sådant tak
(~1,1 GB RSS på 260 MB-filen, väl inom 7 GB) och tar hela den slutliga räkningen i en körning.
Skript: [`scripts/ingest-slutlig.mjs`](../scripts/ingest-slutlig.mjs).

**När:** under **sluträkningen (ons–fre efter valet)**, när de definitiva filerna dyker upp och
uppdateras (Länsstyrelsen räknar om). Preliminära natten behöver det INTE — då finns bara `/p/`,
som edge tar automatiskt.

**Hur:**
```bash
npm run ingest:slutlig            # tar bara filer som ändrats sedan sist (md5)
npm run ingest:slutlig -- --force # kör om alla slutliga filer
```
Kräver service-role i `.env.local`. Egna `ingest_state`-nycklar (`slutlig-local:`) → krockar
aldrig med edge:ns state. Verifierat: skriver 6312 slutliga RD-distrikt + regionerna;
`verify:uppsamling` bekräftar att slutlig RD → `computeMandate` == val.se-facit (349).

## Kända begränsningar

- **Streaming-parse (preliminära filer i edge).** ingest-result STREAMAR varje fil (fflate
  streaming-unzip → `@streamparser/json` SAX → batch-upsert) → minnet är bounded oavsett filstorlek
  (~110 MB peak lokalt på 260 MB-filen). Ersätter den gamla unzipSync + JSON.parse-vägen.
  Edge tar bara `/p/`; alla slutliga `/s/` (som spränger CPU-taket i klungor) tas av det lokala
  skriptet ovan. Storleksvakt + CPU-budget i edge är kvar som säkerhetsnät.
- **Realtime-batch:** preliminärt upsertas i **≤100-radersbatchar** — Realtime tappar txns >~100
  rader → live-kartan skulle inte målas om på valnatten. Slutligt använder **1000-radersbatchar**
  (Realtime behövs inte ons–fre; klienten läser via snapshot). En BEFORE UPDATE-trigger
  (`result_no_status_downgrade`) hindrar att en sen preliminär re-ingest skriver över en slutlig rad.
- **✅ Uppsamlingsröster vägs in i organtotalerna (löst, PR #30).** De 314 uppsamlingsdistrikten
  (sena röster, koder ≠ 8 siffror) routas till `uppsamling_result` per explicit kommunkod/lankod
  och vägs in i organ-aggregaten (KF-kommun, RF-region, RD-riket) → slutgiltiga röstsummor + mandat
  matchar val.se. Karta/valkrets/distrikt förblir geografiska (6312/6272) med flit → barnen
  summerar då inte exakt till organet. Verifierat mot facit: `npm run verify:uppsamling`.
- **🟠 "Övriga" småpartier klumpas på valnatten.** Bara mandat-relevanta partier räknas
  individuellt på valkvällen; övriga registrerade partier redovisas ihop och ligger i
  `rosterEjPaverkaMandat` (som vi INTE tar per parti). Vår andel blir därför *andel av de
  mandatpåverkande rösterna*, inte av alla giltiga → små partier saknas och de stora får
  någon tiondels procent för hög andel (samma typ av liten avvikelse som uppsamlings-3%:an).
  **Personröster** räknas inte alls i det preliminära — de kommer först i slutlig räkning.
- **OS-/utlandsfiler ger 0 rader** (koderna är inte 8-siffriga geografiska distrikt),
  men markeras behandlade så de inte körs om i oändlighet.

## Checklista inför valnatten (13 sep 2026)

1. Byt `RESULT_BASE_DEFAULT` → `…/val2026` **på BÅDA ställena i lockstep**:
   `ingest-result/index.ts` OCH `scripts/ingest-slutlig.mjs`. (Om bara den ena byts laddas
   den andra kategorin från fel katalog — tyst fel på de filer som betyder mest.) Redan förberett
   som draft-PR `chore/valnatt-switch-val2026`.
2. **Preliminärt (`/p/`)** tas av edge automatiskt. **Alla slutliga (`/s/`)** — riks-RD + alla 21
   RF + alla ~290 KF — tas av `npm run ingest:slutlig`, som körs under **sluträkningen (ons–fre)**
   när de definitiva filerna kommer/uppdateras (se avsnittet ovan). På själva natten finns bara
   `/p/`, så inget lokalt skript behövs då.
3. Cron-kadensen tightas till 30 s av migrationen `20260913193000_tighten_cron_valnatt.sql`
   (draft-PR `chore/valnatt-cron-tighten`; behåller jobbnamnet — kosmetiskt).
4. Merge → CI deployar funktionen + applicerar migrationen. På skarpa filerna
   **FÖRSVINNER `test`-attributet helt** (val.se sätter det inte till `false`, det tas
   bort) — vår `test: !!meta.test` ger då `false`, så `dataset_meta` skrivs om till
   `source='val2026', test=false` när första skarpa filen kommer → **bannern släcks
   automatiskt**. (Redan hanterat; inget att ändra.)
