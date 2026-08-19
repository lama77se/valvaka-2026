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

- **Endast preliminära filer (`./p/…`) ingestas.** De slutliga (`./s/…`) hoppas över:
  genrepets slutliga RD-fil är ~9 MB (~130 MB uppackad) och spränger edge-runtimens
  minne (`WORKER_RESOURCE_LIMIT`). Den skarpa preliminära RD-filen (~2 MB) fungerar,
  men vid full valnattsvolym kan även den växa nära taket. **Åtgärd före valnatten:**
  streaming-parse av RD-JSON:en (ladda inte hela i minnet) eller mer minne (Supabase
  Pro), och först då slå på slutlig-ingest för korrekta slutresultat.
- **OS-/utlandsfiler ger 0 rader** (deras koder är inte 8-siffriga geografiska distrikt)
  men markeras som behandlade så de inte körs om i all oändlighet.

## Checklista inför valnatten (13 sep 2026)

1. Byt `RESULT_BASE_DEFAULT` → `…/val2026` i `ingest-result/index.ts`.
2. Lös stor-RD/slutlig-parsningen (streaming eller mer minne) och släpp in `./s/…`.
3. Ny migration: tighta cron-kadensen (30–60 s) för `ingest-result-genrep` (döp om).
4. Merge → CI deployar funktionen + applicerar migrationen. `dataset_meta` skrivs om
   till `source='val2026', test=false` när första skarpa filen kommer → bannern släcks.
