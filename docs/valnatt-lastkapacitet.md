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

## CDN-cache-contingency (spec — bygg bara om triggern slår)

**Trigger att bygga:** (a) nästa genrep-sim visar att **snapshot-läslasten** (inte Realtime-fan-out)
är CPU-flaskhals under mount-herd, ELLER (b) förväntad topp-samtidighet revideras upp till tusental.

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
