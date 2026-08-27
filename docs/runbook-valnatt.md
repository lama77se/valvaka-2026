# Runbook — valnatt 13 sep 2026

Exakt vad som ska göras: **inför**, **på**, och **efter** valnatten (sluträkningen). Öppna
detta dokument på natten. Bakgrund/detaljer: [resultat-ingest-genrep.md](./resultat-ingest-genrep.md).

## Systemet i ett svep

| Del | Vad | Var |
|---|---|---|
| **Edge `ingest-result`** | pollar val.se, **strömmar** in preliminärt + små slutliga filer (≤ 4 MB zip) → `result`/`uppsamling_result` → Realtime → karta | Supabase, pg_cron `*/2 min` |
| **Storleksvakt** | hoppar de 4 största slutliga filerna (för stora för edge) | i samma funktion |
| **Lokalt skript** | `npm run ingest:slutlig-rd` — de 4 giganterna (riks-RD + Sthlm/VGR/Skåne slutlig RF) | din dator, ons–fre |
| **Frontend** | valvaka.tech, auto-deploy från `main` | Vercel |

**Datakällan byts med EN konstant, `RESULT_BASE_DEFAULT`, på TVÅ ställen (lockstep):**
`supabase/functions/ingest-result/index.ts` **och** `scripts/ingest-slutlig-rd.mjs`.
`genrep2026` (test, nu) → `val2026` (skarpt, ~13 sep).

---

## 🔴 Den enda kritiska fallgropen

Genrep lämnar rader i `result`/`uppsamling_result` med **`status='slutlig'`**. No-downgrade-
triggern (`result_no_status_downgrade`) **blockerar** då de skarpa val2026-**preliminära**
upserterna (samma `(valtyp, valdistriktskod, partikod)`-nyckel) → **kartan skulle frysa på
genrep-testdata hela natten**. Därför MÅSTE DB:n rensas innan skarpt flödar (steg N1 nedan).

---

## Inför valnatten (dagarna innan)

- [ ] **Förbered val2026-switchen som en färdig PR/branch** (byt `RESULT_BASE_DEFAULT` →
  `https://resultat.val.se/resultatfiler/val2026` i BÅDA filerna). Merga den INTE än — ha den
  redo för ett klick på natten (CI + deploy tar några minuter, undvik att skriva kod live).
- [ ] **(Valfritt) Förbered cron-tightening-migration** (30–60 s i stället för 2 min):
  `select cron.alter_job((select jobid from cron.job where jobname='ingest-result-genrep'), schedule => '30 seconds');`
  — eller en ny `cron.schedule(...,'30 seconds',...)`. Ha den redo som PR.
- [ ] **Verifiera att val2026 gått live** (byt INTE förrän den svarar 200):
  `curl -s -o /dev/null -w "%{http_code}" https://resultat.val.se/resultatfiler/val2026/index.md5`
  (404 tills ~13 sep, sen 200).
- [ ] **`.env.local` klar** med service-role (`SUPABASE_SERVICE_ROLE_KEY`) för det lokala skriptet.
- [ ] **Infra:** Supabase-compute uppskalad (small/Pro), `Max rows = 10000` (Settings → API).
  Vercel-env (`VITE_SUPABASE_URL/ANON_KEY/GEOMETRY_URL`) korrekta (appen är live).
- [ ] **Låt genrep-demon stå** tills nära natten — den visar att allt fungerar.

---

## På valnatten (sön 13 sep, strax innan resultaten öppnar ~20:00)

**N1. Rensa genrep-datan (KRITISKT — se fallgropen ovan):**
```bash
npm run results:reset -- --ingest-state
```
Rensar `result` + `uppsamling_result` (+ `ingest_state` för en helt ren omingest). Appen visar
nu "inga 2026-röster än" (bara 2022-kolumner) tills skarpt flödar — korrekt startläge.

**N2. Byt datakälla → `val2026` (merga den förberedda PR:en):** deployar edge-funktionen. På
första skarpa filen försvinner `test`-attributet → `dataset_meta` skrivs om till
`source='val2026', test=false` → **testdata-bannern släcks automatiskt**.

**N3. (Valfritt) Merga cron-tightening-migrationen** (30–60 s).

**N4. Övervaka** (inget manuellt behövs sen — edge sköter preliminärt automatiskt):
- Testdata-bannern släcks.
- Kartan börjar fyllas, rapporteringsgrad-HUD:en tickar, statustaggen = **Preliminärt**.
- Avgångstavlorna visar inrapporterade distrikt med val.se:s klockslag.

> På SJÄLVA natten finns bara **preliminära** filer (+ efterhand små slutliga RF/KF). Riks-RD
> är ~2 MB preliminär → ryms i edge. **De stora slutliga filerna finns INTE än** — de kommer
> onsdag. Ingen körning av det lokala skriptet på natten.

---

## Efter valnatten — sluträkningen (onsdag och framåt)

Länsstyrelsen räknar om (uppsamlingsröster onsdag; personröster + slutliga tal över flera dagar).
Statustaggen vandrar **Preliminärt → Sluträknas · X % → Slutgiltigt** per valtyp.

**Automatiskt (edge):** slutliga RF/KF (små) + uppsamling ingestas löpande av cron:en. Inget att göra.

**Manuellt (du) — de 4 giganterna:**
```bash
npm run ingest:slutlig-rd            # tar bara det som ändrats sedan sist
npm run ingest:slutlig-rd -- --force # kör om alla stora slutliga filer
```
- **När:** kör det när de definitiva filerna dyker upp/uppdateras — **onsdag och framåt, några
  gånger om dagen** medan sluträkningen pågår (md5 ändras vid varje omräkning; skriptet hoppar
  oförändrade filer).
- **Vad:** riks-RD (260 MB) + Stockholm/VGR/Skåne slutlig RF. `⚠️` skriptet måste peka på
  `val2026` (samma lockstep-switch som edge — se att den förberedda PR:en bytte BÅDA filerna).
- Kör tills statustaggen når **Slutgiltigt** för alla tre valen och siffrorna slutat ändras.

---

## Verifiering & felsökning

**Är ingesten frisk?** En manuell körning ska svara `200` (inte `546`):
```bash
curl -s -XPOST "$VITE_SUPABASE_URL/functions/v1/ingest-result" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{}'
# → {"ok":true,"changed":N,...}  (546/WORKER_RESOURCE_LIMIT = en gigant slank förbi vakten)
```

**Provenance/banner:** `dataset_meta` (rad `id=1`) → `source='val2026', test=false` när skarpt flödar.

**Vanliga fel:**
- **Kartan fryst på gammal data / uppdateras inte** → genrep-datan rensades inte (N1). Kör
  `npm run results:reset -- --ingest-state`, låt cron:en ominge­sta.
- **`WORKER_RESOURCE_LIMIT` i loggen** → en stor slutlig fil kom förbi 4 MB-vakten. Den markeras
  ändå done (ingen krasch-loop); ta den med det lokala skriptet.
- **Giganterna kommer inte in** → glömt köra `npm run ingest:slutlig-rd`, eller skriptet pekar
  fortfarande på `genrep` (lockstep-switchen bytte bara edge-filen).
- **Bannern släcks inte** → ingen skarp fil har flödat än (val2026 fortfarande 404/tom) eller
  `dataset_meta` inte uppdaterats — kolla att cron:en hittar ändrade filer.
