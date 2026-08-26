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
supabase/functions/ingest-result  (Deno edge function)
        │  md5-diff (ingest_state) → hämta ändrade organ-zip → fflate-unzip
        │  → parsa röstfördelnings-JSON → filtrera mot FK → upsert
        ▼
result  (Postgres)  ──Realtime──►  kartan färgas + rapporteringsgrad tickar
dataset_meta (1 rad) ──────────►  provenance-banner (genrep/testdata)
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
- `valdistriktskod` med **len ≠ 8** (uppsamlingsdistrikt, t.ex. `011400`) hoppas över.
- `partikod` som saknas i `party` hoppas över. (I genrep 2026: 0 tappade — full täckning.)

## Kadens & första fyllning

`MAX_FILES = 25` organ-filer per körning → första fyllningen av alla ~314 organ tar
~10–15 cron-varv (~20–30 min), sen hämtas bara det som ändrats (manifest-md5-diff).
På valnatten: tighta kadensen (30–60 s) i en egen migration.

## Verifiera lokalt

```bash
# Deno-vägen (unzip via esm.sh fflate) — ingen Supabase krävs:
deno run --allow-net supabase/functions/ingest-result/index.ts   # servas; POST {base} för test

# eller hela funktionen mot remote-DB:
supabase functions serve ingest-result --env-file .env.local
curl -XPOST localhost:54321/functions/v1/ingest-result -d '{"base":"https://resultat.val.se/resultatfiler/genrep2026","max":5}'
```

Städa testdata ur `result` med `npm run results:reset` vid behov.

## Kända begränsningar (att lösa före valnatten)

- **Storleksvakt: organ-zip > 4 MB packas inte upp** (skippas + markeras done). Edge-
  runtimen har **256 MB minne — EJ höjbart, inte ens på Pro** (och wall-time 150 s free
  / 400 s paid). En ~9 MB slutlig RD-zip (~130 MB uppackad) spränger minnestaket och
  dödar hela invokeringen (`WORKER_RESOURCE_LIMIT`, ej fångbart) → utan vakten skulle
  den crash-loopa varje varv (äldst-först) och svälta resten. Preliminär RD (~2 MB) ryms.
- **Preliminära filer + slutliga RF/KF ingestas.** Slutlig RF (~2 MB) och KF (~0,03 MB)
  är små och går in via samma väg (ger slutgiltiga region-/kommunresultat efter
  sluträkningen); den slutliga RD-filen (~26 MB) utesluts i manifest-filtret (laddas
  inte ens ner) och hanteras av en separat worker (nedan). En BEFORE UPDATE-trigger
  (`result_no_status_downgrade`) hindrar att en sen preliminär re-ingest skriver över
  en slutlig rad.
- **🔴 Slutlig RD-fil är monolitisk (~26 MB).** RD kommer som EN riks-fil för alla
  distrikt. Mätt mot genrepet: **preliminär** RD stannar på ~2,2 MB även vid 100 %
  räknat (ryms väl under 4 MB-vakten → valnatten är trygg med preliminär-vägen), men
  **slutlig** RD är ~26 MB (~hundratals MB uppackad) och spränger 256 MB-taket
  (`WORKER_RESOURCE_LIMIT`). Den utesluts därför ur edge-ingesten. **Åtgärd (post-
  valnatt, ej tidskritiskt):** streaming-parse *eller* en Node-worker utan 256 MB-taket
  för just slutlig-RD.
- **Realtime:** rösterna upsertas i **≤100-radersbatchar** — Realtime tappar ändringar
  från stora transaktioner (>~100 rader), så större batchar skulle inte måla om
  live-kartan (snapshot vid omladdning fungerar ändå).
- **🟠 Uppsamlingsröster ingår inte i aggregaten (upp till ~3 % sent på kvällen).**
  De 314 uppsamlingsdistrikten (förtids-/reströster, koder ≠ 8 siffror) hoppas över, så
  riks-/regions-/kommunsummorna underskattar med **~0 % tidigt → upp till ~3 % sent**
  när reströsterna kommer in. Officiella `SomSkaRaknas` räknar IN dem (RD 6626 = 6312 +
  314), men vår rapporteringsgrad + karta är geografisk (6312/6272) — det matchar det
  kartan faktiskt kan måla. Att lägga in deras röster i riket/region/kommun-aggregaten
  är billigt (prefix-aggregat), MEN **RD-valkrets förblir fel oavsett** (uppsamling
  saknar valkrets), och `reportedCount` måste vaktas så den inte överstiger nämnaren.
  Medvetet **ej gjort** — värderingsval (3 %-korrigering med en oreducerbar valkrets-
  lucka). Beslut: dokumenterad känd begränsning tills annat bestäms.
- **🟠 "Övriga" småpartier klumpas på valnatten.** Bara mandat-relevanta partier räknas
  individuellt på valkvällen; övriga registrerade partier redovisas ihop och ligger i
  `rosterEjPaverkaMandat` (som vi INTE tar per parti). Vår andel blir därför *andel av de
  mandatpåverkande rösterna*, inte av alla giltiga → små partier saknas och de stora får
  någon tiondels procent för hög andel (samma typ av liten avvikelse som uppsamlings-3%:an).
  **Personröster** räknas inte alls i det preliminära — de kommer först i slutlig räkning.
- **OS-/utlandsfiler ger 0 rader** (koderna är inte 8-siffriga geografiska distrikt),
  men markeras behandlade så de inte körs om i oändlighet.

## Checklista inför valnatten (13 sep 2026)

1. Byt `RESULT_BASE_DEFAULT` → `…/val2026` i `ingest-result/index.ts`.
2. Slutlig RF/KF ingestas redan; bygg en separat worker för slutlig **RD** (~26 MB) —
   streaming eller Node utan 256 MB-taket. (Ej tidskritiskt för valnatten.)
3. Ny migration: tighta cron-kadensen (30–60 s) för `ingest-result-genrep` (döp om).
4. Merge → CI deployar funktionen + applicerar migrationen. På skarpa filerna
   **FÖRSVINNER `test`-attributet helt** (val.se sätter det inte till `false`, det tas
   bort) — vår `test: !!meta.test` ger då `false`, så `dataset_meta` skrivs om till
   `source='val2026', test=false` när första skarpa filen kommer → **bannern släcks
   automatiskt**. (Redan hanterat; inget att ändra.)
