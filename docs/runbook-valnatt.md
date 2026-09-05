# Runbook — valnatt 13 sep 2026

Exakt vad som ska göras: **inför**, **på**, och **efter** valnatten (sluträkningen). Öppna
detta dokument på natten. Bakgrund/detaljer: [resultat-ingest-genrep.md](./resultat-ingest-genrep.md).

## Systemet i ett svep

| Del | Vad | Var |
|---|---|---|
| **Edge `ingest-result`** | pollar val.se, **strömmar** in de **preliminära** filerna (`/p/`) → `result`/`uppsamling_result`; klienten pollar deltan (45–90 s) → karta | Supabase, pg_cron `30 s` |
| **Storleksvakt + CPU-budget** | säkerhetsnät i edge (preliminära filer är små; slutliga filtreras redan bort) | i samma funktion |
| **Lokalt skript** | `npm run ingest:slutlig` — **alla slutliga** filer (`/s/`): riks-RD + alla 21 RF + alla ~290 KF | din dator, **mån–fre** (Länsstyrelsen börjar måndag) |
| **Frontend** | valvaka.tech, auto-deploy från `main` | Vercel |

**Datakällan byts med EN konstant, `RESULT_BASE_DEFAULT`, på TVÅ ställen (lockstep):**
`supabase/functions/ingest-result/index.ts` **och** `scripts/ingest-slutlig.mjs`.
`genrep2026` (test, nu) → `val2026` (skarpt, ~13 sep).

---

## 🔴 Den enda kritiska fallgropen

Genrep lämnar rader i `result`/`uppsamling_result`/`turnout` med **`status='slutlig'`**. No-downgrade-
triggrarna (`result_no_status_downgrade`, `turnout_no_status_downgrade`) **blockerar** då de skarpa
val2026-**preliminära** upserterna (samma PK) → **kartan/valdeltagandet skulle frysa på genrep-
testdata hela natten**. Därför MÅSTE DB:n rensas innan skarpt flödar (steg N1 nedan).

**Och: cronen måste vara PAUSAD när du rensar (N0).** `genrep2026` svarar fortfarande (5 sep: 313
`/p/`-filer + 311 `/s/`). Rensar du med cronen igång och edge fortfarande på genrep, ser edge inom
30 s alla genrep-filer som nya och fyller DB:n med testdata igen — inkl. `slutlig`-rader — *innan*
val2026-deployen hunnit landa via CI. Ordningen är därför **N0 pausa → N1 rensa → N2 byt + verifiera
→ N3 aktivera**.

---

## Inför valnatten (dagarna innan)

- [x] **val2026-switchen förberedd** som draft-PR `chore/valnatt-switch-val2026` (byter
  `RESULT_BASE_DEFAULT` → `…/val2026` i BÅDA filerna). Merga den INTE än — un-draft:a + merga på
  natten (N2), CI deployar edge automatiskt (undvik att skriva kod live).
- [x] **Cron-kadensen är redan 30 s** (migration `20260827120000_tighten_cron.sql`, applicerad i
  förväg via `db-migrate.yml`) — gäller redan genrep-simmarna och carry:ar in i valnatten, inget
  natt-steg. Manuell backning vid behov:
  `select cron.alter_job((select jobid from cron.job where jobname='ingest-result-genrep'), schedule => '*/2 * * * *');`
- [ ] **Verifiera att val2026 gått live** (byt INTE förrän den svarar 200):
  `curl -s -o /dev/null -w "%{http_code}" https://resultat.val.se/resultatfiler/val2026/index.md5`
  (404 tills ~13 sep, sen 200).
- [ ] **🔴 Verifiera att `/p/`-vägen faktiskt matar in — det är NATTENS ENDA datakälla.** Edge tar
  BARA `/p/`; matchar val2026:s sökväg mot förmodan inte exakt `/p/` blir kartan **tyst tom hela
  natten**. Kolla TVÅ saker:
  1. **Räkna filer** (förväntat: `/p/` > 0, `/s/` = 0 på SÖNDAGSNATTEN — Länsstyrelsens sluträkning
     börjar först måndag, se "Efter valnatten" nedan):
     `curl -s https://resultat.val.se/resultatfiler/val2026/index.md5 | grep -c '/p/.*_\(RD\|RF\|KF\)\.zip'`
     och samma med `/s/`.
  2. **Live-rök: en riktig fil ska ingesta + måla kartan.** Efter N2-bytet, gör en manuell POST
     (se *Verifiering* nedan) → svaret ska ge `changed>0`/`upserted>0` och ett distrikt tändas.
  - **Om `/p/`-count = 0 men filer finns:** sökvägskonventionen har flyttat. Filnamnen bär `preliminar`
    /`slutlig` explicit (`..._preliminar_0114_KF.zip`) — använd det som oberoende diskriminator och
    hotfix: byt manifest-filtret i `ingest-result` från `.includes('/p/')` till
    `/_preliminar_/i.test(e.rel)` (och skriptets `/s/`→`/_slutlig_/`), deploya om. Ha detta i åtanke.
  - Verifieras skarpt på en genrep-sim (då ska kartan fyllas helt från edge allena — klienten
    pollar deltan och målar om per distrikt under burst — den egentliga acceptansen). Ser du `/s/`
    under en valnatts-sim, kör `npm run ingest:slutlig` som backup.
- [x] **`.env.local` klar** med service-role (`SUPABASE_SERVICE_ROLE_KEY`) för det lokala skriptet
  (verifierat 5 sep på nya maskinen; Node 20.19 = `.nvmrc`).
- [x] **`Max rows = 10000`** — verifierat live 5 sep (anon-probe bad om 15 000, fick 10 000).
- [x] **Anon-RLS** läser alla klienttabeller (`result`, `turnout`, `uppsamling_result`, `dataset_meta`,
  `district`, `party`, `district_result_2022`); inga anon-skrivrättigheter. Verifierat 5 sep.
- [x] **Geometrin CDN-cachas**: Supabase Storage bakom Cloudflare, `max-age=31536000`, brotli ≈ 1,0 MB,
  `CF-Cache-Status: HIT` → 20:00-herden träffar CDN, inte origin. Verifierat 5 sep.
- [x] **ErrorBoundary** runt appen (`src/main.tsx`) — ett render-undantag ger "Ladda om"-läge, inte vit sida.
- [ ] **Infra:** Supabase-compute uppskalad — **Large för kvällen** (Pro). Vercel-env
  (`VITE_SUPABASE_URL/ANON_KEY/GEOMETRY_URL`) korrekta (appen är live).
  Lastkapacitet, mätvärden och CDN-cache-contingencyn: [valnatt-lastkapacitet.md](./valnatt-lastkapacitet.md).
- [x] **Vercel Firewall — läge kontrollerat 5 sep: Attack Mode AV, System Mitigations PÅ. Behåll så.**
  Bakgrund: 5 sep ~09:47–09:55 fick **en enda IP (testdatorn, Telenor)** `403 Vercel Security
  Checkpoint` (`X-Vercel-Mitigated: challenge`) efter ~70 curl/HeadlessChrome-anrop på kort tid.
  Firewall-fliken visade: Challenged 12 (= den IP:n), Denied 109 (= en WordPress-scanner,
  `/wp-admin/install.php` via Cloudflare/Tencent-AS — korrekt blockerad), Bot Protection inaktiv,
  0 custom rules. Mitigeringen är alltså **per källa/mönster, inte sajtomfattande** — riktiga besökare
  påverkades inte, och läget släppte av sig självt inom ~15 min. En legitim publik från tusentals IP:n
  ser inte ut som en attack.
  Regler för natten: **Attack Mode av. Pausa INTE system mitigations** ("Pause System Mitigations" i
  Danger Zone) annat än om skyddet bevisligen utmanar riktiga besökare under kvällen — då är det ett
  medvetet byte av DDoS-skydd mot friktion. **Ingen headless-trafik mot valvaka.tech från 12 sep**
  (bevakning går mot Supabase; `loadtest:poll` rör inte sajten). Uppe-koll: `curl -sI
  https://valvaka.tech/ | head -1` → `200`. Slå på **Vercel Analytics** i förväg — enda sättet att se
  samtidiga besökare live under natten.
- [ ] **Stäng av Realtime-*tjänsten*** i Supabase-dashboarden (publikationen är redan tom, men
  tjänsten/replikationsslotten går bara att stänga där) → noll WAL-avkodning under natten.
- [ ] **Manuell deploy-fallback klar.** `deploy-functions.yml` har `workflow_dispatch` (Actions →
  *Deploy edge functions* → *Run workflow*). Om GitHub Actions självt ligger nere: `npx supabase@latest
  login` (engångs, interaktivt) och sedan
  `npx supabase@latest functions deploy ingest-result --project-ref emtjnmyberugrkdplnsh`.
  Gör `login` i förväg — inte kl 20:00.
- [x] **🔁 Kallstart-repetition mot genrep — GJORD 5 sep 09:47–10:02.** N0 (SQL-editor) → N1
  `results:reset --ingest-state` (207 907 + 9 103 + 18 896 rader + blobbar bort, verifierat 0) →
  N3 (SQL-editor) → `monitor-flow`. Resultat: **313/313 på 12,8 min**; en riktig Chromium-flik som
  öppnats på TOM DB pollade utan ett enda 400-fel och fyllde på via delta (155k rader) utan omladdning;
  tavlorna gick till 6 312/6 312; blobbarna regenererades. **Två fynd, båda fixade i PR F:**
  (1) riks-RD dödades av edge-CPU-taket ("CPU Time exceeded", 2 035 ms) i sista flushen och togs om
  varje varv (~4 min) — strömmande SAX-parse av 38 MB JSON; nu full `JSON.parse` (~0,4 s CPU);
  (2) ordningen styrdes av manifestet (`p/kf` < `p/rd` < `p/rf`) → Riksdag kom efter 291 KF-filer;
  nu prioritet RD → KF → RF.
  **Repetition nr 2 (10:18–10:27, efter PR F):** N3 10:19 → **Riksdag 6 312/6 312 kl 10:20:25 (< 1 min,
  första varvet)** → Kommun fullt ~10:26 → **313/313 kl 10:26:54 = 7,2 min**; blobbar 15 s gamla och
  = DB; ingen CPU-död (max 694 ms/isolat). **Det här är nattens förväntade tidslinje efter N3:
  riks-RD inom en minut, allt inom ~7 min** (~33 KF-filer per 30 s-varv).
- [ ] **🔺 Skala till Large I GOD TID + lasttesta på Large (inte i sista minuten).** Compute-resize
  ger en kort omstart/nedtid → byt **dagen innan eller tidig eftermiddag 13 sep**, aldrig ~19:55.
  Kör sedan lasttestet på Large och **läs CPU i Supabase-dashboarden** (klient-väggtid mäter INTE
  server-CPU). Sedan **Realtime togs bort (1 sep)** är den kvarvarande lasten **mount-snapshot-herden**
  — många samtidiga fulla snapshot-läsningar vid poll-close (~20:00) + delta-pollning var 45–90 s —
  INTE Realtime-fan-out. **Verktyget är `npm run loadtest:poll`** (speglar dagens klient: blob-mount
  + delta-poll). ⚠️ `loadtest-clients/-heavy/-valnatt` är Realtime-era — `loadtest-valnatt.mjs`
  **raderar RD** ("ren tavla"), kör den inte mot prod.
  **Läge 5 sep:** mount-herden är flyttad till CDN (snapshot-blobbar, PR #81/#82) — 50 flikar gick
  från 100 % CPU till ~20 %, 300 flikar pollar med p95 < 160 ms på Small. Large behålls som marginal.
  Acceptans på Large: `npm run loadtest:poll -- --steps 100,300 --hold 120` från en maskin med bra länk;
  godkänt = CPU-topp under herd < 40 % och delta p95 < 300 ms. Se valnatt-lastkapacitet.md.
- [ ] **Låt genrep-demon stå** tills nära natten — den visar att allt fungerar.

---

## På valnatten (sön 13 sep, strax innan resultaten öppnar ~20:00)

**N0. Pausa cronen (FÖRE resetten — annars fyller edge DB:n med genrep igen inom 30 s):**
```sql
select cron.alter_job((select jobid from cron.job where jobname='ingest-result-genrep'), active => false);
select jobname, active, schedule from cron.job;   -- ingest-result-genrep ska visa active = f
```

**N1. Rensa genrep-datan (KRITISKT — se fallgropen ovan):**
```bash
npm run results:reset -- --ingest-state
node --env-file=.env.local scripts/db-status.mjs   # result/uppsamling/turnout ska visa 0 rader, 0 slutlig
```
Rensar `result` + `uppsamling_result` + `turnout` (+ `ingest_state` för en helt ren omingest), **tar
bort snapshot-blobbarna** (`snapshots/RD|RF|KF.json` — annars seedar nya flikar genrep-data från
CDN:en) och sätter **`dataset_meta.source='reset'`** → flikar som redan är öppna (genrep-demon)
laddar om sig själva inom ~1,5 min (klientens generationsvakt) i stället för att behålla genrep-
färger. Skriptet verifierar 0 rader och exit:ar 1 vid minsta fel. Appen visar nu "inga 2026-röster
än" (bara 2022-kolumner) tills skarpt flödar — korrekt startläge. När första val2026-filen skriver
`source='val2026'` laddar flikarna om en gång till (och bannern släcks).
Kör sedan i SQL-editorn: `vacuum (analyze) result, turnout;` så planeraren har färsk statistik för
tom→full-övergången.

**N2. Byt datakälla → `val2026` (un-draft:a + merga den förberedda switch-PR:en,
`chore/valnatt-switch-val2026`):** deployar edge-funktionen (`deploy-functions.yml`).
**Verifiera deployen innan du går vidare:** `gh run watch` (eller Actions-fliken) tills *Deploy edge
functions* är grön; misslyckas den → *Run workflow*-knappen, eller CLI-fallbacken ovan. Gör sedan
den manuella smoke-POST:en (*Verifiering* nedan) — svaret ska säga `"source":"val2026"`.
⚠️ **Smoke-POST:en från din dator går till ett annat edge-isolat (region) än cronens anrop från
databasen.** Bevisa att *cronens* väg kör nya koden innan N3: refresh-cronen (varje minut) går samma
väg — kör i SQL-editorn tills den senaste `"refreshed":true`-raden är NYARE än deployen
(5 sep tog det ~1 min; gamla isolat syns som `version N-1`-Shutdown i edge-loggen ett par minuter
till, det är normalt):
```sql
select created, left(content::text, 120) from net._http_response order by id desc limit 6;
```
På första skarpa filen försvinner `test`-attributet → `dataset_meta` skrivs om till `source='val2026',
test=false` → **testdata-bannern släcks automatiskt**.

**N3. Aktivera cronen igen** (kadensen är redan 30 s, `20260827120000_tighten_cron.sql`):
```sql
select cron.alter_job((select jobid from cron.job where jobname='ingest-result-genrep'), active => true);
```

**N4. Övervaka** (inget manuellt behövs sen — edge sköter preliminärt automatiskt):
- **Kör vakthunden i en terminal hela natten** — den stämmer av val.se ↔ edge ↔ DB var 30 s:
  `node --env-file=.env.local scripts/monitor-flow.mjs --base https://resultat.val.se/resultatfiler/val2026`
  (⚠️ dess *default* är genrep — glöm inte `--base`; det är ett tredje ställe utöver lockstep-switchen).
- Testdata-bannern släcks.
- Kartan börjar fyllas, rapporteringsgrad-HUD:en tickar, statustaggen = **Preliminärt**.
- Avgångstavlorna visar inrapporterade distrikt med val.se:s klockslag.
- **Snapshot-blobbarna är färska** (nya flikar seedar från dem — mount-herden går mot CDN, inte
  Postgres): smoke-POST-svaret har `"snapshots":{"RD":"… kB på … ms",…}` efter körningar som
  ändrade något, och
  `curl -s https://emtjnmyberugrkdplnsh.supabase.co/storage/v1/object/public/snapshots/RD.json | head -c 200`
  visar `generated_at` inom de senaste minuterna. Äldre än 15 min ⇒ klienten ignorerar bloben och
  går keyset (fungerar, men dyrt under herd) — kolla då `snapshot-refresh`-cronen och edge-loggen.
- **Cron-hälsa i SQL** (cron-kommandot `net.http_post` "lyckas" alltid → `cron.job_run_details` är
  grönt även om varje edge-anrop 5xx:ar; titta här i stället):
  ```sql
  select status_code, error_msg, left(content::text, 200) as body, created
  from net._http_response order by id desc limit 10;
  -- bara problem: status_code <> 200 eller "ok":false i kroppen
  select status_code, left(content::text, 300), created from net._http_response
  where status_code is distinct from 200 or content::text like '%"ok":false%' order by id desc limit 10;
  ```

> På SJÄLVA söndagsnatten finns bara **preliminära** filer (`/p/`). Riks-RD är ~2 MB preliminär →
> ryms i edge. **Slutliga filer (`/s/`) finns INTE än på natten** — men Länsstyrelsen börjar
> sluträkna redan **måndag** (dagen efter), så `/s/` dyker upp från måndag (se "Efter valnatten").
> Ingen körning av det lokala skriptet på söndagsnatten.

---

## Efter valnatten — sluträkningen (måndag och framåt)

Två spår löper **delvis parallellt** efter valdagen (källa: val.se, se slutet av avsnittet):

1. **Länsstyrelsens slutliga rösträkning** — börjar redan **dagen efter valdagen (måndag)** och
   pågår över ~2 veckor (personröster + definitiva tal). → **slutliga filer (`/s/`)**, tas av det
   **lokala skriptet** nedan.
2. **Valnämndens onsdagsräkning (uppsamlingsrösterna)** — **onsdag**: sena förtids-/utlands-/brev-
   röster som inte hann sorteras till rätt distrikt på natten. Räknas **preliminärt** → **`/p/`**,
   tas **automatiskt av edge**. Valnämnden lämnar sen över rösterna till Länsstyrelsen för slutlig
   räkning.

Statustaggen vandrar **Preliminärt → Sluträknas · X % → Slutgiltigt** per valtyp, distrikt för distrikt.

**Automatiskt (edge):** endast **preliminära** filer (`/p/`) — inkl. onsdagsräkningens uppsamling.
Edge rör INTE slutliga filer (`/s/`) — de tas helt av det lokala skriptet nedan.

**Manuellt (du) — ALLA slutliga filer:**
```bash
npm run ingest:slutlig            # tar bara det som ändrats sedan sist
npm run ingest:slutlig -- --force # kör om alla slutliga filer
```
- **När:** kör det när de definitiva filerna dyker upp/uppdateras — **från måndag och framåt, några
  gånger om dagen** medan sluträkningen pågår (Länsstyrelsen börjar måndag, inte onsdag). Skriptet
  hoppar oförändrade filer (md5 ändras vid varje omräkning), så tidiga körningar kostar inget.
- **Vad:** alla slutliga (`/s/`) filer — riks-RD (260 MB) + alla 21 RF + alla ~290 KF. `⚠️` skriptet
  måste peka på `val2026` (samma lockstep-switch som edge — se att den förberedda PR:en bytte BÅDA
  filerna).
- Kör tills statustaggen når **Slutgiltigt** för alla tre valen och siffrorna slutat ändras.

> **Källa (tidsplanen):** Valmyndigheten — Länsstyrelsen börjar den slutliga rösträkningen *dagen
> efter valdagen*; valnämndens preliminära "onsdagsräkning" (uppsamlingsdistrikten) är på *onsdagen*;
> de två sker delvis parallellt. Se val.se: [Slutlig rösträkning](https://valcentralen.val.se/lansstyrelse/slutlig-rostrakning)
> och [Hur går valnämndens onsdagsräkning till?](https://fragor.val.se/org/valmyndigheten/d/hur-gar-valnamndens-onsdagsrakning-till/).

---

## Verifiering & felsökning

**Är ingesten frisk?** En manuell körning ska svara `200` (inte `546`):
```bash
curl -s -XPOST "$VITE_SUPABASE_URL/functions/v1/ingest-result" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{}'
# → {"ok":true,"source":"val2026","changed":N,"upserted":…,"failed":0,"remaining":…}
#   {"ok":true,"busy":true,"pending":N}  = en annan invokering håller leasen just nu (normalt, kör igen)
#   {"ok":false,"failed":N,"errors":[…]} = transienta fel på N filer (försöks igen nästa varv) — läs errors
#   503 {"error":"district-lookup…"}      = referensdata gick inte att läsa → INGET markerades klart, kolla DB
#   (546/WORKER_RESOURCE_LIMIT bör ej hända — edge tar bara små /p/)
```
Leasen (`ingest_lease`, RPC `ingest_claim`/`ingest_release`) gör att exakt en invokering skriver åt
gången; edge-budgeten är 25 s (< 30 s-kadensen). Fastnar leasen (bör inte hända — TTL 90 s):
`update ingest_lease set expires_at = now() where name = 'ingest-result';`

**Provenance/banner:** `dataset_meta` (rad `id=1`) → `source='val2026', test=false` när skarpt flödar.

**Vanliga fel:**
- **Kartan fryst på gammal data / uppdateras inte** → genrep-datan rensades inte (N1). Kör
  `npm run results:reset -- --ingest-state`, låt cron:en ominge­sta.
- **`WORKER_RESOURCE_LIMIT` i loggen** → oväntat; edge tar bara preliminära (`/p/`) filer och de är
  små. Kontrollera att manifest-filtret i `ingest-result` fortfarande utesluter `/s/`. ⚠️ Filen
  markeras **INTE** done (isolatet dör inne i `streamFile`, före `ingest_state`-skrivningen) och
  sorteras först nästa varv (`last_ok` null) → **riktig krasch-loop** som blockerar filplats 1 varje
  körning. Åtgärd: identifiera filen (`monitor-flow.mjs` visar vilka manifest-md5 som saknas i
  `ingest_state`), skriv manuellt en rad i `ingest_state` med dess md5 och `last_status=413`, och ta
  filen med det lokala skriptet.
- **`changed>0` men `upserted=0` varv efter varv** → före PR A var det riks-summeringarna
  (`…_preliminar_OS_KF.zip`/`_OS_RF.zip`, saknar `rostfordelning`) som retry:ades för evigt; nu
  markeras de `nodata` (204). Kvarstår mönstret: kolla `net._http_response` och att `district`/
  `party`-lookupen inte fallerar tyst (tom `districtSet` ⇒ alla rader "okända" ⇒ fil klar med 0 rader).
- **Slutliga siffror kommer inte in** → glömt köra `npm run ingest:slutlig`, eller skriptet pekar
  fortfarande på `genrep` (lockstep-switchen bytte bara edge-filen).
- **Bannern släcks inte** → ingen skarp fil har flödat än (val2026 fortfarande 404/tom) eller
  `dataset_meta` inte uppdaterats — kolla att cron:en hittar ändrade filer.
