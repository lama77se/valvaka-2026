# Runbook — valnatt 13 sep 2026

Exakt vad som ska göras: **inför**, **på**, och **efter** valnatten (sluträkningen). Öppna
detta dokument på natten. Bakgrund/detaljer: [resultat-ingest-genrep.md](./resultat-ingest-genrep.md).

## Systemet i ett svep

| Del | Vad | Var |
|---|---|---|
| **Edge `ingest-result`** | pollar val.se, **strömmar** in de **preliminära** filerna (`/p/`) → `result`/`uppsamling_result` → Realtime → karta | Supabase, pg_cron `*/2 min` |
| **Storleksvakt + CPU-budget** | säkerhetsnät i edge (preliminära filer är små; slutliga filtreras redan bort) | i samma funktion |
| **Lokalt skript** | `npm run ingest:slutlig` — **alla slutliga** filer (`/s/`): riks-RD + alla 21 RF + alla ~290 KF | din dator, ons–fre |
| **Frontend** | valvaka.tech, auto-deploy från `main` | Vercel |

**Datakällan byts med EN konstant, `RESULT_BASE_DEFAULT`, på TVÅ ställen (lockstep):**
`supabase/functions/ingest-result/index.ts` **och** `scripts/ingest-slutlig.mjs`.
`genrep2026` (test, nu) → `val2026` (skarpt, ~13 sep).

---

## 🔴 Den enda kritiska fallgropen

Genrep lämnar rader i `result`/`uppsamling_result` med **`status='slutlig'`**. No-downgrade-
triggern (`result_no_status_downgrade`) **blockerar** då de skarpa val2026-**preliminära**
upserterna (samma `(valtyp, valdistriktskod, partikod)`-nyckel) → **kartan skulle frysa på
genrep-testdata hela natten**. Därför MÅSTE DB:n rensas innan skarpt flödar (steg N1 nedan).

---

## Inför valnatten (dagarna innan)

- [x] **val2026-switchen förberedd** som draft-PR `chore/valnatt-switch-val2026` (byter
  `RESULT_BASE_DEFAULT` → `…/val2026` i BÅDA filerna). Merga den INTE än — un-draft:a + merga på
  natten (N2), CI deployar edge automatiskt (undvik att skriva kod live).
- [ ] **(Valfritt) Cron-tightening (30 s i stället för 2 min)** — redan förberedd som **draft-PR**
  (`supabase/migrations/20260913193000_tighten_cron_valnatt.sql`, `cron.alter_job → '30 seconds'`).
  Merga på natten (N3) → `db-migrate.yml` auto-applar. Manuell fallback om migrationen strular:
  `select cron.alter_job((select jobid from cron.job where jobname='ingest-result-genrep'), schedule => '30 seconds');`
- [ ] **Verifiera att val2026 gått live** (byt INTE förrän den svarar 200):
  `curl -s -o /dev/null -w "%{http_code}" https://resultat.val.se/resultatfiler/val2026/index.md5`
  (404 tills ~13 sep, sen 200).
- [ ] **🔴 Verifiera att `/p/`-vägen faktiskt matar in — det är NATTENS ENDA datakälla.** Edge tar
  BARA `/p/`; matchar val2026:s sökväg mot förmodan inte exakt `/p/` blir kartan **tyst tom hela
  natten**. Kolla TVÅ saker:
  1. **Räkna filer** (förväntat: `/p/` > 0, `/s/` = 0 på natten — Länsstyrelsens sluträkning börjar
     först veckan efter):
     `curl -s https://resultat.val.se/resultatfiler/val2026/index.md5 | grep -c '/p/.*_\(RD\|RF\|KF\)\.zip'`
     och samma med `/s/`.
  2. **Live-rök: en riktig fil ska ingesta + måla kartan.** Efter N2-bytet, gör en manuell POST
     (se *Verifiering* nedan) → svaret ska ge `changed>0`/`upserted>0` och ett distrikt tändas.
  - **Om `/p/`-count = 0 men filer finns:** sökvägskonventionen har flyttat. Filnamnen bär `preliminar`
    /`slutlig` explicit (`..._preliminar_0114_KF.zip`) — använd det som oberoende diskriminator och
    hotfix: byt manifest-filtret i `ingest-result` från `.includes('/p/')` till
    `/_preliminar_/i.test(e.rel)` (och skriptets `/s/`→`/_slutlig_/`), deploya om. Ha detta i åtanke.
  - Verifieras skarpt på genrep-sim **mån 31 aug 13–15** (då ska kartan fyllas helt från edge allena
    med Realtime-repaint under burst — den egentliga acceptansen; kör även `npm run verify:realtime`).
    Ser du `/s/` under en valnatts-sim, kör `npm run ingest:slutlig` som backup.
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

**N2. Byt datakälla → `val2026` (un-draft:a + merga den förberedda switch-PR:en,
`chore/valnatt-switch-val2026`):** deployar edge-funktionen (`deploy-functions.yml`). På första
skarpa filen försvinner `test`-attributet → `dataset_meta` skrivs om till `source='val2026',
test=false` → **testdata-bannern släcks automatiskt**.

**N3. (Valfritt) Merga cron-tightening-migrationen** (`chore/valnatt-cron-tighten`, 30 s) →
`db-migrate.yml` auto-applar.

**N4. Övervaka** (inget manuellt behövs sen — edge sköter preliminärt automatiskt):
- Testdata-bannern släcks.
- Kartan börjar fyllas, rapporteringsgrad-HUD:en tickar, statustaggen = **Preliminärt**.
- Avgångstavlorna visar inrapporterade distrikt med val.se:s klockslag.

> På SJÄLVA natten finns bara **preliminära** filer (`/p/`). Riks-RD är ~2 MB preliminär → ryms
> i edge. **Slutliga filer (`/s/`) finns INTE än** — de kommer onsdag när Länsstyrelsen börjar
> sluträkna. Ingen körning av det lokala skriptet på natten.

---

## Efter valnatten — sluträkningen (onsdag och framåt)

Länsstyrelsen räknar om (uppsamlingsröster onsdag; personröster + slutliga tal över flera dagar).
Statustaggen vandrar **Preliminärt → Sluträknas · X % → Slutgiltigt** per valtyp.

**Automatiskt (edge):** endast **preliminära** filer + uppsamling som fortfarande kommer preliminärt.
Edge rör INTE slutliga filer (`/s/`) — de tas helt av det lokala skriptet nedan.

**Manuellt (du) — ALLA slutliga filer:**
```bash
npm run ingest:slutlig            # tar bara det som ändrats sedan sist
npm run ingest:slutlig -- --force # kör om alla slutliga filer
```
- **När:** kör det när de definitiva filerna dyker upp/uppdateras — **onsdag och framåt, några
  gånger om dagen** medan sluträkningen pågår (md5 ändras vid varje omräkning; skriptet hoppar
  oförändrade filer).
- **Vad:** alla slutliga (`/s/`) filer — riks-RD (260 MB) + alla 21 RF + alla ~290 KF. `⚠️` skriptet
  måste peka på `val2026` (samma lockstep-switch som edge — se att den förberedda PR:en bytte BÅDA
  filerna).
- Kör tills statustaggen når **Slutgiltigt** för alla tre valen och siffrorna slutat ändras.

---

## Verifiering & felsökning

**Är ingesten frisk?** En manuell körning ska svara `200` (inte `546`):
```bash
curl -s -XPOST "$VITE_SUPABASE_URL/functions/v1/ingest-result" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{}'
# → {"ok":true,"changed":N,...}  (546/WORKER_RESOURCE_LIMIT bör ej hända — edge tar bara små /p/)
```

**Provenance/banner:** `dataset_meta` (rad `id=1`) → `source='val2026', test=false` när skarpt flödar.

**Vanliga fel:**
- **Kartan fryst på gammal data / uppdateras inte** → genrep-datan rensades inte (N1). Kör
  `npm run results:reset -- --ingest-state`, låt cron:en ominge­sta.
- **`WORKER_RESOURCE_LIMIT` i loggen** → oväntat; edge tar bara preliminära (`/p/`) filer och de är
  små. Kontrollera att manifest-filtret i `ingest-result` fortfarande utesluter `/s/`. Filen
  markeras ändå done (ingen krasch-loop).
- **Slutliga siffror kommer inte in** → glömt köra `npm run ingest:slutlig`, eller skriptet pekar
  fortfarande på `genrep` (lockstep-switchen bytte bara edge-filen).
- **Bannern släcks inte** → ingen skarp fil har flödat än (val2026 fortfarande 404/tom) eller
  `dataset_meta` inte uppdaterats — kolla att cron:en hittar ändrade filer.
