# Valnatt — lastkapacitet & CDN-cache-contingency

Beslutsunderlag för CPU-/läslast-oron inför valnatten. Vad vi mätte, vad vi valde,
och exakt vad som triggar att vi bygger CDN-cachen som vi medvetet **inte** byggde.

## Slutsats (31 aug 2026)

**Vi kör Large-instansen för kvällen + keyset-paginering ([#66](https://github.com/lama77se/valvaka-2026/pull/66)) och bygger INTE CDN-cachen nu.** Förväntad topp-samtidighet vid
poll-close är hundratals besökare (≤ ~500); vid den nivån räcker Large + keyset med marginal.
CDN-cachen hålls som **spec:ad contingency** (nedan) — byggs bara om triggern nedan slår.

## Vad CPU-spiken under genrepet var (och varför den inte återkommer)

Genrep-spiken (~90 % CPU, låg kvar ~2 h efter skriv-stopp) var **Realtime/WAL logisk
decoding-backlog**, inte klient-läsningar — se [[genrep-cpu-realtime-backlog]] /
`resultat-ingest-genrep.md`. Genrepet skrev om HELA datasetet repetitivt i 3 h → enorm WAL →
wal-sendern avkodade backloggen i timmar. **Skarpa natten skriver monotont en gång per distrikt**
→ mycket mildare Realtime-last. Den spiken är alltså genrep-specifik och inte natt-representativ.

## Vad vi faktiskt mätte (lasttest 31 aug, kväll)

| Scenario | Instans | CPU-topp | Utfall |
|---|---|---|---|
| ~1000 Realtime-anslutningar + tung skrivburst (~330 rader/s) | Small | 53–64 % | återhämtade sig |
| 50 samtidiga fulla snapshots (mount-herd) + tung Realtime | Small | 64 % | återhämtade sig |

- På **Large** (dubbel kapacitet) → grovt **~30 %** för samma last.
- Snapshot-läsningar var i genrep-`pg_stat_statements` bara ~36 % av en pytteliten total
  (~5 s absolut över 2 h) → läslast är sekundär mot Realtime-fan-out.

> ⚠️ **Klient-väggtid är INTE ett mått på server-CPU.** Herd-lasttest från en maskin flaskhalsar
> på den lokala upplänken (alla samtidiga nedladdningar delar ett nät) → t.ex. "15,5 s median" och
> "keyset 1,1× snabbare" säger **inget** om Supabase-CPU. Det enda dugliga måttet är CPU-grafen i
> Supabase-dashboarden under last. Mät server-CPU där, inte klientlatens.

## Keyset-paginering (byggt, #66)

Snapshoten (`ensureValtypLoaded` i `ResultsProvider.tsx`) paginerar på **sista sedda nyckeln**
`(valdistriktskod, partikod)` i stället för OFFSET. OFFSET N skannar + slänger N rader/sida →
O(n²) i radantal (~162k rader); keyset → index-range-scan → O(n). Sänker server-CPU för
snapshot-läsningarna och är dessutom skip-/dubblettsäker under samtidiga upsertar. Verifierat
headless: **exakt samma 50 496 nycklar** som gamla offset-vägen (0 saknas, 0 extra).

## Lasttest 5 sep (polling-format, `scripts/loadtest-poll.mjs`) — triggern slog

Första lasttestet som speglar dagens klient exakt (keyset-snapshot per valtyp + turnout + uppsamling
+ dataset_meta vid mount, delta-poll var 45–90 s). **50 desktop-flikar som monterar inom 10 s på
Small:**

| | |
|---|---|
| Herd klar | 58 s väggtid |
| Snapshot per valtyp | p50 **51 s**, p95 54 s (n = 150) |
| Volym | **11,8 M rader / 1 700 requests = 236 000 rader / 34 requests per flik** |
| Fel | inga (10 s `statement_timeout` höll; ~6 s per 10k-sida) |
| Supabase CPU | **få % → 100 %** |

Per flik: 3 valtyper × (~69k `result` + ~6k `turnout`) + 9k `uppsamling` ≈ 20 MB JSON. 31 aug-testet
(64 % vid 50) mätte *en* snapshot per flik; desktop laddar tre (tavlorna). Slutsats: **Large (2×) räcker
inte för 300–500 flikar via PostgREST** — mount-herden måste bort från Postgres. Delta-pollningen efter
mount är däremot billig (p50 140 ms efter att överlappsfönstret gatats, PR #80).

→ CDN-contingencyn nedan **byggdes samma dag** (PR #81 + #82): RPC `snapshot_json` + Storage-
bucket `snapshots` + klient-seed från blob med keyset-fallback.

### Efter blobbarna — samma test, samma Small (5 sep 07:27–07:32)

| Steg | Herd (mount) | Postgres-CPU | Poll-fas (90 s) |
|---|---|---|---|
| **50** flikar | klar på **10 s** (var 58 s) · blob p50 322 ms · 0 keyset-miss · 250 requests (var 1 700) | topp **~20 %** (var 100 %) | 150 deltan p50 **123 ms** · 65k rader |
| **150** flikar | +100 på 12 s · blob p50 976 ms · 0 miss · 1,25 GB från Cloudflare | **~5 %** | 504 deltan p50 125 ms · p95 151 ms · 0 fel |
| **300** flikar | +150 på 40 s · blob p50 6,8 s · **12 miss → keyset-fallback tog över** (p50 2,4 s) | inget över 20 % | **1 089 deltan p50 127 ms · p95 158 ms · 0 fel** (≈ 12 frågor/s) |

- Blob-tiderna vid 150/300 och de 12 missarna (7 lokala 30 s-timeouts, 5 `fetch failed`) är **testriggens
  länk** (1,8 GB på 40 s från en maskin), inte servern — riktiga besökare har varsin länk. Att
  fallbacken slog in tyst och korrekt är verifierat på köpet.
- Kvarvarande Postgres-last är **delta-poll + uppsamlingens första laddning per flik**: ~12 småfrågor/s
  vid 300 flikar, p95 < 160 ms. Extrapolerat 500 flikar ≈ 20/s — Large har bred marginal.
- **Prod verifierad i riktig Chromium** (bundle `index-D197b_rc.js`): mount = `RD.json`+`RF.json`+`KF.json`
  från CDN, **0 keyset-sidor** mot `result`.
- **Exakt CPU-topp under hela 50/150/300-körningen: 19,45 %** (Small, avläst i dashboarden).

### Edge-CPU (kallstart-repetition 5 sep) — den andra flaskhalsen

Edge har ett **hårt tak på 2 000 ms CPU per invokering**. Under kallstarten (313 filer från tom DB)
mättes: ett KF-varv med 25 filer = **439 ms** CPU (`reason: EarlyDrop` = normal), men **riks-RD ensam
= 2 035 ms → `CPU Time exceeded`** i sista flushen (50 000 av 50 496 rader inne, `ingest_state`
aldrig skriven, minne bara 18 MB). Rotorsak: strömmande SAX-parse (`@streamparser/json`) av RD:s
38 MB JSON. Full `unzipSync + JSON.parse` av samma fil: ~0,3–0,5 s CPU, ~150 MB minne (tak 256 MB).
Bytt i PR F; RD får dessutom en egen körning (`BIG_FILE_BYTES`) och en försöksmarkör gör att en
fil som ändå dödar isolatet hamnar sist i kön i stället för att blockera den.

**Beslut står: Large för natten** (marginal för delta-poll, edge-upsertar och sluträkning), men mount-
herden är inte längre dimensionerande. Acceptanstest på Large: `npm run loadtest:poll -- --steps 100,300
--hold 120` från en maskin med ordentlig länk; godkänt = CPU-topp under herd < 40 % och delta p95 < 300 ms.

## CDN-cache-contingency (BYGGD 5 sep — specen nedan är den ursprungliga)

**Trigger att bygga:** (a) nästa genrep-sim visar att **snapshot-läslasten** (inte Realtime-fan-out)
är CPU-flaskhals under mount-herd, ELLER (b) förväntad topp-samtidighet revideras upp till tusental.
**→ (a) slog 5 sep, se ovan.**

**Vad den löser (och inte):** kollapsar mount-herden — många *nya* besökare som var och en snapshotar
~6 Postgres-sidor vid poll-close → **en** CDN-hämtning. Offloadar snapshot-läsningen från Postgres
till Storage/CDN helt. **Rör INTE Realtime-fan-out** — ingen universallösning.

**Design:**
1. **Generator** — edge-funktion + `pg_cron` (~30 s): läser `result` → skriver en komprimerad
   JSON-blob per valtyp till Supabase Storage (CDN-backed bucket, jfr `geometry`-bucketen).
2. **Klient** — vid mount: hämta EN blob från CDN i stället för ~6 Postgres-sidor → seeda store,
   sätt `cursor` = blobens max `updated_at`, låt resync + Realtime fylla gapet sedan bloben.
3. **Fallback** — vid blob-miss/fel: nuvarande Postgres-paginering (nu keyset). Klienten degraderar
   mjukt, aldrig tom karta.

**Validering:** headless mot en genrep-sim (blob-innehåll = Postgres-innehåll; fallback-vägen
träffar vid framtvingat blob-fel; CDN-cache-träff mätbar i nätverksfliken). ~2 v runway till 13 sep.
