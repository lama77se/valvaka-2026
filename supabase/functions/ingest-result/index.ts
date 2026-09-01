// Fas 7 — RESULTAT-ingestion (valnatt + definitivt). Den skarpa vägen "2026-resultat
// flödar in": pollar Valmyndighetens resultatfiler, packar upp röstfördelnings-JSON och
// upsertar `result` (→ Realtime → kart-paint) + `uppsamling_result`. Speglar ingest-parti
// (Deno edge + pg_cron + ingest_state), men för röster.
//
// KÄLLA — just nu GENERALREPET (`genrep2026`): Valmyndighetens generalrepetition är en LIVE,
// kontinuerligt uppdaterad test-feed (`test: true`) med exakt samma format som skarpa
// valnatten. På valnatten 13 sep 2026: byt RESULT_BASE_DEFAULT till `.../val2026` och deploya om.
//
// ROLLFÖRDELNING (PR #37): edge tar BARA de PRELIMINÄRA filerna (/p/) — det är allt som finns på
// valnatten och de ryms i CPU-taket. Alla SLUTLIGA filer (/s/) tas av det lokala Node-skriptet
// (scripts/ingest-slutlig.mjs): de bär personröster (tunga att parsa) och en klunga medelstora
// slutliga i EN invokering summerar >2 s CPU → WORKER_RESOURCE_LIMIT. Att helt utesluta /s/ här
// tar bort hela den krasch-risken. Se manifest-filtret nedan.
//
// STREAMANDE PARSNING (bounded minne oavsett filstorlek): fflate streaming-unzip →
// @streamparser/json (SAX) → batch-upsert (~110 MB peak; edge-taket 256 MB). Ersätter den gamla
// unzipSync + JSON.parse-vägen. Storleksvakt + CPU-budget nedan finns kvar som SÄKERHETSNÄT ifall
// en oväntat stor preliminär fil dyker upp (i praktiken små), men slutliga giganter kommer ändå
// aldrig hit efter manifest-filtret.
//
// FORMAT (verifierat mot genrep 2026-08):
//   resultat.val.se/resultatfiler/<base>/index.md5  = manifest: "<md5>␠␠./p/<vt>/<fil>.zip"
//   En zip per organ (RD riket=00, RF per region, KF per kommun; /p/ preliminärt, /s/ slutligt)
//   → innehåller ..._rostfordelning_<kod>_<VT>.json. Röster = rosterPaverkaMandat.partiRoster[].
//
// FALLGROPAR: (a) uppsamlingsdistrikt (valdistriktstyp==='uppsamlingsdistrikt') har KORT kod
// (len 6) utan geometri → INGEN FK mot district; routas till uppsamling_result per explicit
// kommunkod/lankod (koden återanvänds mellan RD/RF-filer → parsa den aldrig). (b) partikod har
// inledande nollor ("0001"). (c) result_snapshot skrivs INTE här (genrep-churn).
//
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY auto-injiceras i edge-runtime.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Unzip, UnzipInflate } from 'https://esm.sh/fflate@0.8.2'
import { JSONParser } from 'https://esm.sh/@streamparser/json@0.0.21'

// Generalrepet nu → byt till 'https://resultat.val.se/resultatfiler/val2026' på valnatten.
const RESULT_BASE_DEFAULT = 'https://resultat.val.se/resultatfiler/genrep2026'
// Övre tak på organ-filer per körning (pg_cron plockar resten nästa varv). CPU-budgeten nedan
// är den EGENTLIGA gränsen; detta hindrar bara att MÅNGA små filer (preliminärt) drar iväg.
const MAX_FILES_DEFAULT = 25
const BUDGET_MS = 300_000
// CPU-BUDGET per invokering (SÄKERHETSNÄT sedan edge är preliminär-only): edge har ~2 s CPU/
// REQUEST (inte kumulativt över varv). Att parsa flera MEDELSTORA filer (~15–40 MB uppackat) i EN
// invokering kan summera >2 s CPU → WORKER_RESOURCE_LIMIT. Sluta lägga till filer när kumulativa
// STRÖMMADE zip-bytes passerar detta. Preliminära filer är små så detta bör sällan lösa ut; kvar
// ifall en fil oväntat växer eller en FULL BACKLOG (alla filer ändrade, t.ex. N2-switchen på
// valnatten) processas i en invokering. SÄNKT 6 → 4 MB efter att turnout-fångsten (PR #69) la till
// per-distrikt-arbete/upsertar → tunnare marginal; en manuell max=25-POST slog i taket vid full
// genrep-backlog. 4 MB ger headroom under 2s även vid full backlog; cron:en (30 s) dränerar ändå.
const INVOKE_BYTE_BUDGET = 4_000_000
// STORLEKSVAKT (SÄKERHETSNÄT): filer med större zip än så här PARSAR edge inte utan markerar done
// (413) och delegerar till det lokala skriptet. Slutliga giganter (RD ~24 MB zip / 260 MB uppackat
// dödar isolatet på ~4 s, WORKER_RESOURCE_LIMIT) filtreras redan bort av manifest-filtret (/p/
// only), så detta träffar bara en hypotetiskt uppsvälld preliminär fil. ~4 MB zip är den bevisat
// säkra gränsen. De slutliga tas av `npm run ingest:slutlig` (scripts/ingest-slutlig.mjs).
const MAX_EDGE_ZIP_BYTES = 4_000_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface FileMeta { valtyp?: string; valtillfalle?: string; test?: boolean; rakningstillfalle?: string; senasteUppdateringstid?: string }
interface StreamResult {
  // ok → markera done. fetchfail/dberror/incomplete → transient, markera EJ done (försök igen
  // nästa varv → självläker). corrupt → dålig data för denna md5, markera done (annars svält).
  // toobig → för stor för edge (delegeras till lokala Node-skriptet), markera done så den
  // inte väljs varje varv.
  status: 'ok' | 'fetchfail' | 'dberror' | 'incomplete' | 'corrupt' | 'toobig'
  meta?: FileMeta
  resultUp?: number
  uppUp?: number
  turnoutUp?: number
  bytes?: number // strömmade zip-bytes (CPU-proxy för invokeringens budget); ~0 för toobig
  error?: string
}

// Streama EN organ-zip → upserta result (status ur rakningstillfalle) + uppsamling_result i
// klungor. Returnerar status-kod som styr om filen markeras done (transienta fel → försök igen).
async function streamFile(url: string, districtSet: Set<string>, partySet: Set<string>, supabase: SupabaseClient, probe: boolean): Promise<StreamResult> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return { status: 'fetchfail' }
  }
  if (!res.ok || !res.body) return { status: 'fetchfail' }

  // Storleksvakt FÖRE nedladdning: Content-Length (GET-header = zip-storleken) → avbryt kroppen
  // och delegera till lokala skriptet om den är för stor för edge. Ingen extra HEAD, ingen 24 MB
  // hämtad i onödan, ingen krasch-loop på giganterna.
  if ((Number(res.headers.get('content-length')) || 0) > MAX_EDGE_ZIP_BYTES) {
    await res.body.cancel().catch(() => {})
    return { status: 'toobig' }
  }

  const meta: FileMeta = {}
  let valtyp = ''
  let rakning = ''
  let sawFinal = false
  let resultUp = 0
  let uppUp = 0
  let turnoutUp = 0
  const pendingResult: Record<string, unknown>[] = []
  const pendingUpp: Record<string, unknown>[] = []
  const pendingTurnout: Record<string, unknown>[] = []

  // PRELIMINÄRT → 100 rader/upsert: Realtime tappar HELT stora txns (>~100 rader) → live-kartan
  // skulle inte målas om på valnatten. SLUTLIGT → 1000 rader/upsert: Realtime behövs inte (sen-
  // räkningen ons–fre, klienten läser via snapshot), och 10× färre upserts håller edge-resurserna
  // (den slutliga RD-filen slog i WORKER_RESOURCE_LIMIT vid ~1070 upserts). Sätts när rakning läses.
  let resultBatch = 100
  const flush = async (force: boolean) => {
    while (pendingResult.length >= resultBatch || (force && pendingResult.length > 0)) {
      const batch = pendingResult.splice(0, resultBatch)
      if (!probe) {
        const { error } = await supabase.from('result').upsert(batch, { onConflict: 'valtyp,valdistriktskod,partikod' })
        if (error) throw new Error('upsert result: ' + error.message)
      }
      resultUp += batch.length
    }
    while (pendingUpp.length >= 500 || (force && pendingUpp.length > 0)) {
      const batch = pendingUpp.splice(0, 500)
      if (!probe) {
        const { error } = await supabase.from('uppsamling_result').upsert(batch, { onConflict: 'valtyp,kod,partikod' })
        if (error) throw new Error('upsert uppsamling: ' + error.message)
      }
      uppUp += batch.length
    }
    // turnout (valdeltagande): 1 rad/distrikt, EJ på Realtime → stor batch (1000) minimerar
    // edge-round-trips (~7 anrop för RD prel i st f 63 vid 100/batch).
    while (pendingTurnout.length >= 1000 || (force && pendingTurnout.length > 0)) {
      const batch = pendingTurnout.splice(0, 1000)
      if (!probe) {
        const { error } = await supabase.from('turnout').upsert(batch, { onConflict: 'valtyp,valdistriktskod' })
        if (error) throw new Error('upsert turnout: ' + error.message)
      }
      turnoutUp += batch.length
    }
  }

  // SAX: emittera bara toppnivå-metafälten + varje valdistrikt-element. valdistrikt ligger SIST
  // i JSON:en → meta/valtyp/rakning är satta innan första distriktet kommer.
  const parser = new JSONParser({
    paths: ['$.valtyp', '$.valtillfalle', '$.test', '$.rakningstillfalle', '$.senasteUppdateringstid', '$.valdistrikt.*'],
    keepStack: false,
  })
  // deno-lint-ignore no-explicit-any
  parser.onValue = (info: any) => {
    const { value, key } = info
    if (key === 'valtyp') { valtyp = value as string; meta.valtyp = valtyp; return }
    if (key === 'valtillfalle') { meta.valtillfalle = value as string; return }
    if (key === 'test') { meta.test = value as boolean; return }
    if (key === 'rakningstillfalle') { rakning = value as string; meta.rakningstillfalle = rakning; resultBatch = rakning.startsWith('prelimin') ? 100 : 1000; return }
    if (key === 'senasteUppdateringstid') { meta.senasteUppdateringstid = value as string; return }
    // deno-lint-ignore no-explicit-any
    const vd = value as any
    if (!vd || typeof vd !== 'object' || !('valdistriktskod' in vd)) return
    const kod = vd.valdistriktskod
    const status = String(rakning).startsWith('prelimin') ? 'preliminar' : 'slutlig'
    if (vd.valdistriktstyp === 'uppsamlingsdistrikt') {
      const kommunkod = typeof vd.kommunkod === 'string' ? vd.kommunkod : null
      const lankod = typeof vd.lankod === 'string' ? vd.lankod : null
      if (typeof kod !== 'string' || !kommunkod || !lankod) return
      for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
        if (!partySet.has(p.partikod)) continue
        pendingUpp.push({ valtyp, kod, kommunkod, lankod, partikod: p.partikod, roster: p.antalRoster, status })
      }
      return
    }
    if (typeof kod !== 'string' || kod.length !== 8 || !districtSet.has(kod)) return // uppsamling/okänd
    // val.se:s egna rapporteringstid per distrikt (naiv svensk lokaltid) → avgångstavlan.
    const rapporteringstid = typeof vd.rapporteringsTid === 'string' ? vd.rapporteringsTid : null
    // Valdeltagande: totaltAntalRoster (alla avgivna röster) + antalRostberattigade per distrikt.
    // Bara RAPPORTERADE distrikt (totaltAntalRoster > 0): val.se:s aggregat-valdeltagande använder
    // röstberättigade i RÄKNADE distrikt som nämnare, så orapporterade distrikt (total = 0/null)
    // får INTE ligga i store:n → annars blåses nämnaren upp och valdeltagandet understryks live.
    if (typeof vd.totaltAntalRoster === 'number' && vd.totaltAntalRoster > 0 && typeof vd.antalRostberattigade === 'number' && vd.antalRostberattigade > 0) {
      pendingTurnout.push({ valtyp, valdistriktskod: kod, totalt_antal_roster: vd.totaltAntalRoster, antal_rostberattigade: vd.antalRostberattigade, status })
    }
    for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
      if (!partySet.has(p.partikod)) continue
      pendingResult.push({ valtyp, valdistriktskod: kod, partikod: p.partikod, roster: p.antalRoster, status, rapporteringstid })
    }
  }
  parser.onError = (e: Error) => { throw e }

  // Streaming-unzip: fflate Unzip (sync UnzipInflate) → mata rostfordelnings-filens bytes
  // direkt till SAX-parsern. `final` = fflate har levererat hela filen (integritetssignal).
  const uz = new Unzip()
  uz.register(UnzipInflate)
  uz.onfile = (file) => {
    if (/rostfordelning.*\.json$/i.test(file.name)) {
      file.ondata = (err, data, final) => {
        if (err) throw err
        parser.write(data)
        if (final) sawFinal = true
      }
      file.start()
    }
  }

  // Mata fflate i SMÅ bitar (64 KB komprimerat → ~0,6 MB uppackat per push) och töm klungor
  // EFTER varje bit. Kritiskt i edge: en enda push av en stor käll-chunk skulle sync-inflate
  // en MB-burst och spika minnet över 256 MB-taket (edge levererar färre/större chunkar än
  // lokalt). Med små bitar + tät flush stannar peak-minnet på några MB oavsett filstorlek.
  const SUBCHUNK = 65536
  const reader = res.body.getReader()
  let bytesRead = 0
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>
      try {
        step = await reader.read()
      } catch (netErr) {
        // Nätverksavbrott MITT i strömmen (260 MB-fönstret gör detta troligare) → transient,
        // markera EJ done → nästa cron-varv laddar om från början och självläker.
        return { status: 'fetchfail', error: (netErr as Error).message }
      }
      if (step.done) break
      const buf = step.value
      bytesRead += buf.length // CPU-proxy för invokeringens budget
      for (let off = 0; off < buf.length; off += SUBCHUNK) {
        uz.push(buf.subarray(off, Math.min(off + SUBCHUNK, buf.length)), false)
        await flush(false)
      }
    }
    uz.push(new Uint8Array(0), true)
    await flush(true)
  } catch (e) {
    const msg = (e as Error).message
    // upsert-fel = transient DB → försök igen; annars korrupt zip/JSON för denna md5 → done.
    return msg.startsWith('upsert') ? { status: 'dberror', error: msg } : { status: 'corrupt', error: msg }
  }
  // Strömmen tog slut men rostfordelnings-filen blev aldrig komplett (fflate nådde ej `final`)
  // → trunkerad nedladdning som ändå avslutades "rent". Våra RD/RF/KF-zip HAR alltid en
  // rostfordelning → !final = ofullständig (aldrig "saknar den") → transient, försök igen.
  if (!sawFinal) return { status: 'incomplete', bytes: bytesRead }
  return { status: 'ok', meta, resultUp, uppUp, turnoutUp, bytes: bytesRead }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({})) as { base?: string; max?: number; probe?: boolean }
  const base = (body.base ?? RESULT_BASE_DEFAULT).replace(/\/+$/, '')
  const max = Number(body.max ?? MAX_FILES_DEFAULT)
  // Diagnostik: probe=true streamar + parsar + räknar men UPSERTAR inte och markerar inte done.
  // Låter oss mäta om parse/ström ALLENA ryms i edge (då är upserts flaskhalsen) utan sidoeffekt.
  const probe = !!body.probe
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 1. Manifest → organ-zip-poster. Edge tar BARA de PRELIMINÄRA (/p/) — det är allt som finns
  //    på valnatten och de ryms i CPU-taket. ALLA slutliga (/s/) tas av det lokala Node-skriptet
  //    (scripts/ingest-slutlig.mjs): slutliga filer bär personröster och en KLUNGA medelstora
  //    slutliga i EN invokering summerar >2 s CPU → WORKER_RESOURCE_LIMIT. Att helt utesluta /s/
  //    här tar bort hela den krasch-risken; skriptet körs ändå ons–fre under sluträkningen.
  const idxRes = await fetch(`${base}/index.md5`)
  if (!idxRes.ok) return json({ error: `manifest ${idxRes.status}`, base }, 502)
  const files = (await idxRes.text())
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
    .filter((e) => /_(RD|RF|KF)\.zip$/i.test(e.rel) && e.rel.includes('/p/'))
    .map((e) => ({ ...e, url: base + e.rel.replace(/^\./, '') }))
  if (files.length === 0) return json({ error: 'inga organ-zip i manifestet', base }, 502)

  // 2. Ändrade sedan sist? Manifest-md5 i ingest_state.etag. Prefix-filter på base (ALDRIG
  //    .in() med alla URL:er → överlång URI). Äldst/osedd först så manifestets svans inte svälts.
  const { data: states } = await supabase
    .from('ingest_state')
    .select('file_path,etag,last_ok')
    .like('file_path', `${base}/%`)
  const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag]))
  const lastOk = new Map((states ?? []).map((s) => [s.file_path, s.last_ok as string | null]))
  const allChanged = files
    .filter((f) => seen.get(f.url) !== f.md5)
    .sort((a, b) => (Date.parse(lastOk.get(a.url) ?? '') || 0) - (Date.parse(lastOk.get(b.url) ?? '') || 0))
  const changed = allChanged.slice(0, max)
  if (changed.length === 0) return json({ ok: true, changed: 0, total: files.length })

  // 3. Giltiga koder (FK-krav result→district / result→party). Laddas en gång.
  const districtSet = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('district').select('valdistriktskod').range(from, from + 999)
    if (!data || data.length === 0) break
    for (const d of data) districtSet.add(d.valdistriktskod)
    if (data.length < 1000) break
  }
  const { data: parties } = await supabase.from('party').select('partikod')
  const partySet = new Set((parties ?? []).map((p) => p.partikod))

  // 4. Per ändrad organ-fil: streama → upserta. Väggtidsbudget (preliminär RD ~2 MB ryms lätt) →
  //    stanna innan edge-taket, resten nästa varv. Filen markeras done UTOM vid transient fel.
  let upserted = 0
  let uppUpserted = 0
  let turnoutUpserted = 0
  let skipped = 0
  let meta: FileMeta | null = null
  const deadline = Date.now() + BUDGET_MS
  let invokeBytes = 0 // kumulativa strömmade zip-bytes denna invokering (CPU-budget, se ovan)
  for (const f of changed) {
    // Stanna innan CPU-taket: väggtid ELLER kumulativa bytes (flera medelstora filer summerar
    // >2 s CPU). Kontrollen är FÖRE filen → föregående fil fick gå klart; resten nästa varv.
    if (Date.now() > deadline || invokeBytes > INVOKE_BYTE_BUDGET) break
    const r = await streamFile(f.url, districtSet, partySet, supabase, probe)
    invokeBytes += r.bytes ?? 0 // toobig strömmar ~0 (kroppen avbruten) → äter inte budgeten
    if (r.status === 'fetchfail' || r.status === 'dberror' || r.status === 'incomplete') {
      // Transient (nätverk/DB/trunkerad) → markera INTE done, försök igen nästa varv (självläker).
      continue
    }
    if (r.status === 'ok') {
      if (r.meta && r.meta.valtyp) meta = r.meta
      upserted += r.resultUp ?? 0
      uppUpserted += r.uppUp ?? 0
      turnoutUpserted += r.turnoutUp ?? 0
    } else {
      skipped++ // 'toobig' (delegeras till lokala skriptet) eller 'corrupt' — markeras ändå done
    }
    if (probe) continue // diagnostik → rör inte ingest_state
    const lastStatus = r.status === 'ok' ? 200 : r.status === 'toobig' ? 413 : 422
    await supabase.from('ingest_state').upsert(
      { file_path: f.url, etag: f.md5, last_ok: new Date().toISOString(), last_status: lastStatus },
      { onConflict: 'file_path' },
    )
  }

  // 5. Provenance för UI-badgen (best-effort). En gång per körning, från senaste filens meta.
  if (meta) {
    await supabase.from('dataset_meta').upsert({
      id: 1,
      source: base.includes('genrep') ? 'genrep2026' : 'val2026',
      valtillfalle: meta.valtillfalle ?? null,
      test: !!meta.test,
      rakningstillfalle: meta.rakningstillfalle ?? null,
      kalla_uppdaterad: meta.senasteUppdateringstid ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  }

  return json({ ok: true, source: base.includes('genrep') ? 'genrep2026' : 'val2026', changed: changed.length, upserted, uppUpserted, turnoutUpserted, skipped, remaining: allChanged.length - changed.length })
})
