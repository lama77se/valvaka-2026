// Fas 7 — RESULTAT-ingestion (valnatt + definitivt). Den skarpa vägen "2026-resultat
// flödar in": pollar Valmyndighetens resultatfiler, packar upp röstfördelnings-JSON och
// upsertar `result` (→ klientens delta-poll → kart-paint) + `uppsamling_result` + `turnout`.
// Speglar ingest-parti (Deno edge + pg_cron + ingest_state), men för röster.
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
// FULL PARSE (unzipSync + JSON.parse), INTE strömmande SAX (bytt 5 sep, PR F): edge har ett HÅRT
// CPU-tak på 2 000 ms per invokering. Den strömmande vägen (fflate Unzip → @streamparser/json)
// höll minnet på ~18 MB men brände ~2 s CPU på riks-RD:s 38 MB JSON → isolatet dödades i sista
// flushen ("CPU Time exceeded", cpu_time_used 2035) — RD markerades aldrig klar, togs om varje varv
// och blockerade allt efter sig. Bevisat under kallstart-repetitionen mot genrep 5 sep. Full parse
// av samma fil: ~0,3–0,5 s CPU (native JSON.parse), ~150 MB minne (taket är 256 MB). Sedan /s/
// filtreras bort kommer aldrig en fil > 4 MB zip hit, så minnesargumentet för strömning är borta.
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
import { unzipSync } from 'https://esm.sh/fflate@0.8.2'

// Generalrepet nu → byt till 'https://resultat.val.se/resultatfiler/val2026' på valnatten.
const RESULT_BASE_DEFAULT = 'https://resultat.val.se/resultatfiler/genrep2026'
// Övre tak på organ-filer per körning (pg_cron plockar resten nästa varv). CPU-budgeten nedan
// är den EGENTLIGA gränsen; detta hindrar bara att MÅNGA små filer (preliminärt) drar iväg.
const MAX_FILES_DEFAULT = 25
// Väggtidsbudget per invokering. Cronen fyrar var 30 s (net.http_post är async → pg_cron väntar
// INTE på förra körningen), så budgeten måste ligga UNDER kadensen; resten tas nästa varv. Var
// 300 s → körningar stackade under tung DB och strömmade samma filer parallellt (se leasen nedan).
const BUDGET_MS = 25_000
// Ingest-lease (RPC ingest_claim/ingest_release, migration 20260905120000): exakt EN invokering
// åt gången. TTL > budgeten så en död isolat släpper leasen av sig själv (60 s: en CPU-dödad
// körning ska inte blockera mer än ett par varv).
const LEASE_NAME = 'ingest-result'
const LEASE_TTL_S = 60
// CPU-BUDGET per invokering: edge har ~2 s CPU per REQUEST. Sluta lägga till filer när kumulativa
// zip-bytes passerar detta (KF-filer är ~30 KB, RF ~100–300 KB, riks-RD ~2 MB).
const INVOKE_BYTE_BUDGET = 4_000_000
// STOR FIL = EGEN KÖRNING: en fil större än så här (i praktiken bara riks-RD) avslutar körningen
// efter sig, så dess CPU aldrig summeras med 24 KF-parsningar i samma invokering.
const BIG_FILE_BYTES = 1_000_000
// STORLEKSVAKT (SÄKERHETSNÄT): filer med större zip än så här PARSAR edge inte utan markerar done
// (413). Slutliga giganter (RD ~24 MB zip / 260 MB uppackat) filtreras redan bort av manifest-
// filtret (/p/ only), så detta träffar bara en hypotetiskt uppsvälld preliminär fil. ⚠️ En sådan
// fil har då INGEN ingestväg (skriptet tar bara /s/) — loggas därför högt.
const MAX_EDGE_ZIP_BYTES = 4_000_000
// Prioritet mellan valtyper när flera filer väntar (beslut 5 sep): Riksdag → Kommun → Region.
// Utan detta styrde MANIFESTORDNINGEN (p/kf < p/rd < p/rf) → efter switchen/resetten togs 291
// KF-filer före riks-RD, som därmed kom ~5 min sent. Inom en valtyp: osedd/äldst först.
const VALTYP_PRIO: Record<string, number> = { RD: 0, KF: 1, RF: 2 }
const vtOf = (rel: string) => rel.match(/_(RD|RF|KF)\.zip$/i)?.[1].toUpperCase() ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface FileMeta { valtyp?: string; valtillfalle?: string; test?: boolean; rakningstillfalle?: string; senasteUppdateringstid?: string }
interface FileResult {
  // ok → markera done. fetchfail/dberror/incomplete → transient, markera EJ done (försök igen
  // nästa varv → självläker). corrupt → dålig data för denna md5, markera done (annars svält).
  // toobig → för stor för edge, markera done (413) och LOGGA — ingen annan väg tar /p/.
  // nodata → zip:en är komplett men saknar rostfordelning (t.ex. riks-SUMMERINGARNA `_OS_KF/_OS_RF`
  // under /p/) — inget att ingesta för denna md5, markera done (annars evig retry som äter filplatser).
  status: 'ok' | 'fetchfail' | 'dberror' | 'incomplete' | 'corrupt' | 'toobig' | 'nodata'
  meta?: FileMeta
  resultUp?: number
  uppUp?: number
  turnoutUp?: number
  bytes?: number // zip-bytes (CPU-proxy för invokeringens budget); ~0 för toobig
  error?: string
}

// Hämta EN organ-zip → packa upp → JSON.parse → upserta result (status ur rakningstillfalle) +
// uppsamling_result + turnout i stora klungor. Returnerar status som styr om filen markeras done.
async function processFile(url: string, districtSet: Set<string>, partySet: Set<string>, supabase: SupabaseClient, probe: boolean): Promise<FileResult> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  } catch (e) {
    return { status: 'fetchfail', error: (e as Error).message }
  }
  if (!res.ok || !res.body) return { status: 'fetchfail', error: `http ${res.status}` }

  // Storleksvakt FÖRE nedladdning (Content-Length = zip-storleken) → avbryt kroppen.
  if ((Number(res.headers.get('content-length')) || 0) > MAX_EDGE_ZIP_BYTES) {
    await res.body.cancel().catch(() => {})
    return { status: 'toobig' }
  }
  let zip: Uint8Array | null
  try {
    zip = new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    return { status: 'fetchfail', error: (e as Error).message }
  }
  const bytes = zip.length
  if (bytes > MAX_EDGE_ZIP_BYTES) return { status: 'toobig', bytes }
  if (bytes === 0) return { status: 'incomplete', bytes }

  // Packa upp + parsa. Släpp referenserna så fort de inte behövs (peak-minne: zip + uppackat +
  // sträng + objektträd ≈ 150 MB för riks-RD; edge-taket 256 MB).
  // deno-lint-ignore no-explicit-any
  let j: any
  try {
    const unz = unzipSync(zip)
    zip = null
    const names = Object.keys(unz)
    const name = names.find((n) => /rostfordelning.*\.json$/i.test(n))
    // Poster fanns men ingen rostfordelning → 'nodata' (riks-summeringarna). Inga poster alls →
    // trunkerad/tom → transient.
    if (!name) return { status: names.length ? 'nodata' : 'incomplete', bytes }
    const text = new TextDecoder().decode(unz[name])
    j = JSON.parse(text)
  } catch (e) {
    // Korrupt zip/JSON för denna md5 → done (annars svält); en trunkerad nedladdning ger oftast
    // fflate-fel här också — men md5:n byts när val.se publicerar om, så den kommer tillbaka.
    return { status: 'corrupt', error: (e as Error).message, bytes }
  }

  const meta: FileMeta = {
    valtyp: typeof j.valtyp === 'string' ? j.valtyp : undefined,
    valtillfalle: typeof j.valtillfalle === 'string' ? j.valtillfalle : undefined,
    test: typeof j.test === 'boolean' ? j.test : undefined,
    rakningstillfalle: typeof j.rakningstillfalle === 'string' ? j.rakningstillfalle : undefined,
    senasteUppdateringstid: typeof j.senasteUppdateringstid === 'string' ? j.senasteUppdateringstid : undefined,
  }
  const valtyp = String(j.valtyp ?? '')
  const rakning = String(j.rakningstillfalle ?? '')
  if (!/^(prelimin|slutlig)/i.test(rakning)) console.warn('[ingest-result] okänt rakningstillfalle', JSON.stringify({ url, rakning }))
  // Edge tar BARA /p/ (preliminära) → default 'preliminar'. Tidigare var default 'slutlig' och
  // jämförelsen skiftlägeskänslig: hade val2026 skrivit "Preliminär" eller utelämnat fältet hade
  // första ingesten skrivit ALLT som slutlig, varpå no-downgrade-triggrarna tyst kastat varje
  // senare uppdatering hela natten. Nu krävs ett explicit "slutlig…" för att sätta slutlig.
  const status = /^slutlig/i.test(rakning) ? 'slutlig' : 'preliminar'

  const rows: Record<string, unknown>[] = []
  const upp: Record<string, unknown>[] = []
  const turnout: Record<string, unknown>[] = []
  for (const vd of (Array.isArray(j.valdistrikt) ? j.valdistrikt : [])) {
    if (!vd || typeof vd !== 'object' || !('valdistriktskod' in vd)) continue
    const kod = vd.valdistriktskod
    const partier = vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []
    if (vd.valdistriktstyp === 'uppsamlingsdistrikt') {
      const kommunkod = typeof vd.kommunkod === 'string' ? vd.kommunkod : null
      const lankod = typeof vd.lankod === 'string' ? vd.lankod : null
      if (typeof kod !== 'string' || !kommunkod || !lankod) continue
      for (const p of partier) {
        if (!partySet.has(p.partikod)) continue
        upp.push({ valtyp, kod, kommunkod, lankod, partikod: p.partikod, roster: p.antalRoster, status })
      }
      continue
    }
    if (typeof kod !== 'string' || kod.length !== 8 || !districtSet.has(kod)) continue // uppsamling/okänd
    // val.se:s egna rapporteringstid per distrikt (naiv svensk lokaltid) → avgångstavlan.
    const rapporteringstid = typeof vd.rapporteringsTid === 'string' ? vd.rapporteringsTid : null
    // Valdeltagande: bara RAPPORTERADE distrikt (totaltAntalRoster > 0) — val.se:s aggregat använder
    // röstberättigade i RÄKNADE distrikt som nämnare; orapporterade får inte blåsa upp nämnaren.
    if (typeof vd.totaltAntalRoster === 'number' && vd.totaltAntalRoster > 0 && typeof vd.antalRostberattigade === 'number' && vd.antalRostberattigade > 0) {
      turnout.push({ valtyp, valdistriktskod: kod, totalt_antal_roster: vd.totaltAntalRoster, antal_rostberattigade: vd.antalRostberattigade, status })
    }
    for (const p of partier) {
      if (!partySet.has(p.partikod)) continue
      rows.push({ valtyp, valdistriktskod: kod, partikod: p.partikod, roster: p.antalRoster, status, rapporteringstid })
    }
  }
  j = null // objektträdet kan GC:as innan upsertarna

  // Stora klungor → få PostgREST-anrop (riks-RD: 50k rader → 26 anrop à 2000 i stället för 51).
  const upsert = async (table: string, arr: Record<string, unknown>[], size: number, onConflict: string) => {
    for (let i = 0; i < arr.length; i += size) {
      if (probe) continue
      const { error } = await supabase.from(table).upsert(arr.slice(i, i + size), { onConflict })
      if (error) throw new Error(`upsert ${table}: ${error.message}`)
    }
  }
  try {
    await upsert('result', rows, 2000, 'valtyp,valdistriktskod,partikod')
    await upsert('uppsamling_result', upp, 1000, 'valtyp,kod,partikod')
    await upsert('turnout', turnout, 2000, 'valtyp,valdistriktskod')
  } catch (e) {
    return { status: 'dberror', error: (e as Error).message, bytes }
  }
  return { status: 'ok', meta, resultUp: rows.length, uppUp: upp.length, turnoutUp: turnout.length, bytes }
}

// SNAPSHOT-BLOBBAR (CDN-contingencyn, migration 20260905150000): Postgres bygger en kompakt JSON
// per valtyp (RPC snapshot_json → text), vi laddar upp till Storage-bucketen `snapshots` (publik,
// Cloudflare-cachad, cacheControl 30 s). Klienten seedar från bloben vid mount i stället för ~30
// PostgREST-sidor → mount-herden blir CDN-trafik. Best-effort: ett fel påverkar inte ingesten
// (klienten faller tillbaka på keyset-vägen). Anropas (a) efter en ingest-körning för de valtyper
// som ändrades och (b) från refresh-cronen (varje minut) för alla tre — (b) är säkerhetsnätet som
// gör att en blob aldrig blir äldre än ~1 min även om (a) dör på CPU-taket efter en tung fil.
async function refreshSnapshotBlobs(supabase: SupabaseClient, valtyper: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const vt of valtyper) {
    const t0 = Date.now()
    const { data: text, error: rpcErr } = await supabase.rpc('snapshot_json', { p_valtyp: vt })
    if (rpcErr || typeof text !== 'string') {
      out[vt] = `rpc-fel: ${rpcErr?.message ?? 'tomt svar'}`
      console.error('[ingest-result] snapshot_json', vt, out[vt])
      continue
    }
    const { error: upErr } = await supabase.storage
      .from('snapshots')
      .upload(`${vt}.json`, new Blob([text], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '30' })
    out[vt] = upErr ? `upload-fel: ${upErr.message}` : `${(text.length / 1024).toFixed(0)} kB på ${Date.now() - t0} ms`
    if (upErr) console.error('[ingest-result] snapshot-upload', vt, upErr.message)
  }
  return out
}

Deno.serve(async (req) => {
  // refreshSnapshots: regenerera alla snapshot-blobbar oavsett om något ingestades (5-min-cronen).
  const body = await req.json().catch(() => ({})) as { base?: string; max?: number; probe?: boolean; refreshSnapshots?: boolean }
  const base = (body.base ?? RESULT_BASE_DEFAULT).replace(/\/+$/, '')
  // ALLOWLIST: funktionen anropas med anon-JWT (ligger i klient-bundlen) och skriver med
  // service_role. Utan denna spärr kan vem som helst peka `base` mot en egen server med
  // påhittad index.md5 + zip och få fabricerade röstsiffror upsertade på den skarpa kartan.
  if (!base.startsWith('https://resultat.val.se/resultatfiler/')) {
    return json({ ok: false, error: 'base måste ligga under https://resultat.val.se/resultatfiler/' }, 400)
  }
  const max = Number(body.max ?? MAX_FILES_DEFAULT)
  // Diagnostik: probe=true hämtar + parsar + räknar men UPSERTAR inte och markerar inte done.
  const probe = !!body.probe
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // 0. REFRESH-VÄG (cronen varje minut): bara blobbar, ingen ingest, ingen lease → kan aldrig bli
  //    `busy` bakom en krasch-loopande ingest och konkurrerar inte om ingestens CPU-budget.
  if (body.refreshSnapshots) {
    const snapshots = await refreshSnapshotBlobs(supabase, ['RD', 'RF', 'KF'])
    return json({ ok: !Object.values(snapshots).some((s) => s.includes('-fel')), refreshed: true, snapshots })
  }

  // 1. Manifest → organ-zip-poster. Edge tar BARA de PRELIMINÄRA (/p/) — det är allt som finns
  //    på valnatten och de ryms i CPU-taket. ALLA slutliga (/s/) tas av det lokala Node-skriptet
  //    (scripts/ingest-slutlig.mjs): slutliga filer bär personröster och en KLUNGA medelstora
  //    slutliga i EN invokering summerar >2 s CPU → WORKER_RESOURCE_LIMIT. Att helt utesluta /s/
  //    här tar bort hela den krasch-risken; skriptet körs ändå mån–fre under sluträkningen.
  let idxRes: Response
  try {
    idxRes = await fetch(`${base}/index.md5`, { signal: AbortSignal.timeout(15_000) })
  } catch (e) {
    return json({ ok: false, error: `manifest: ${(e as Error).message}`, base }, 502)
  }
  if (!idxRes.ok) return json({ ok: false, error: `manifest ${idxRes.status}`, base }, 502)
  const files = (await idxRes.text())
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
    .filter((e) => /_(RD|RF|KF)\.zip$/i.test(e.rel) && e.rel.includes('/p/'))
    .map((e) => ({ ...e, url: base + e.rel.replace(/^\./, '') }))
  if (files.length === 0) return json({ ok: false, error: 'inga organ-zip i manifestet', base }, 502)

  // 2. Ändrade sedan sist? Manifest-md5 i ingest_state.etag. Prefix-filter på base (ALDRIG
  //    .in() med alla URL:er → överlång URI). Ordning: valtyp-prioritet (RD → KF → RF), sedan
  //    osedd/äldst först inom valtypen så manifestets svans inte svälts. En fil som just FÖRSÖKTS
  //    (försöksmarkören nedan sätter last_ok=nu) hamnar därmed sist — en fil som dödar isolatet
  //    blockerar inte kön.
  const { data: states } = await supabase
    .from('ingest_state')
    .select('file_path,etag,last_ok')
    .like('file_path', `${base}/%`)
  const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag as string | null]))
  const lastOk = new Map((states ?? []).map((s) => [s.file_path, s.last_ok as string | null]))
  const tsOf = (url: string) => Date.parse(lastOk.get(url) ?? '') || 0
  const allChanged = files
    .filter((f) => seen.get(f.url) !== f.md5)
    .sort((a, b) => ((VALTYP_PRIO[vtOf(a.rel)] ?? 9) - (VALTYP_PRIO[vtOf(b.rel)] ?? 9)) || (tsOf(a.url) - tsOf(b.url)))
  const changed = allChanged.slice(0, max)
  if (changed.length === 0) return json({ ok: true, changed: 0, total: files.length })

  // 2b. LEASE: exakt en skrivande invokering åt gången (probe skriver inget → ingen lease). Saknas
  //     RPC:n (migrationen släpar efter deployen några sekunder) → kör utan, men logga.
  let leased = false
  if (!probe) {
    const { data: got, error: leaseErr } = await supabase.rpc('ingest_claim', { p_name: LEASE_NAME, p_ttl_seconds: LEASE_TTL_S })
    if (leaseErr) console.warn('[ingest-result] ingest_claim misslyckades — kör utan lease:', leaseErr.message)
    else if (!got) return json({ ok: true, busy: true, changed: 0, pending: allChanged.length, total: files.length })
    else leased = true
  }
  try {
  // 3. Giltiga koder (FK-krav result→district / result→party). Laddas en gång. Ett FEL här får
  //    INTE passera tyst: tom districtSet ⇒ varje rad "okänd" ⇒ filen markeras klar med 0 rader
  //    och ingestas inte igen förrän md5 ändras. Avbryt hela körningen (503) i stället.
  const districtSet = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('district').select('valdistriktskod').order('valdistriktskod').range(from, from + 999)
    if (error) return json({ ok: false, error: 'district-lookup: ' + error.message }, 503)
    if (!data || data.length === 0) break
    for (const d of data) districtSet.add(d.valdistriktskod)
    if (data.length < 1000) break
  }
  const { data: parties, error: partyErr } = await supabase.from('party').select('partikod')
  if (partyErr) return json({ ok: false, error: 'party-lookup: ' + partyErr.message }, 503)
  const partySet = new Set((parties ?? []).map((p) => p.partikod))
  if (districtSet.size < 5000 || partySet.size === 0) {
    return json({ ok: false, error: `referensdata ofullständig (district=${districtSet.size}, party=${partySet.size})` }, 503)
  }

  // 4. Per ändrad organ-fil: hämta → parsa → upserta. Väggtidsbudget → stanna innan edge-taket,
  //    resten nästa varv. Filen markeras done UTOM vid transient fel.
  let upserted = 0
  let uppUpserted = 0
  let turnoutUpserted = 0
  let skipped = 0
  let failed = 0 // transienta fel (fetchfail/dberror/incomplete) — filen försöks igen nästa varv
  const errors: string[] = [] // de första felen i klartext → syns i net._http_response-kroppen
  const touched = new Set<string>() // valtyper vars data ändrades denna körning → regenerera deras blobbar
  let meta: FileMeta | null = null
  const deadline = Date.now() + BUDGET_MS
  let invokeBytes = 0 // kumulativa zip-bytes denna invokering (CPU-budget, se ovan)
  let processed = 0 // filer vi faktiskt rörde (budget/stor-fil-break lämnar resten till nästa varv)
  for (const f of changed) {
    // Stanna innan CPU-taket: väggtid ELLER kumulativa bytes. Kontrollen är FÖRE filen →
    // föregående fil fick gå klart; resten nästa varv.
    if (Date.now() > deadline || invokeBytes > INVOKE_BYTE_BUDGET) break
    // FÖRSÖKSMARKÖR: skriv last_ok=nu (etag OFÖRÄNDRAD → filen räknas fortfarande som ändrad) INNAN
    // vi rör filen. Dör isolatet mitt i (CPU-taket) ligger markören kvar → filen sorteras sist
    // inom sin valtyp nästa varv och resten av kön får gå före. 102 = "processing".
    if (!probe) {
      await supabase.from('ingest_state').upsert(
        { file_path: f.url, etag: seen.get(f.url) ?? null, last_ok: new Date().toISOString(), last_status: 102 },
        { onConflict: 'file_path' },
      )
    }
    const r = await processFile(f.url, districtSet, partySet, supabase, probe)
    processed++
    invokeBytes += r.bytes ?? 0 // toobig hämtar ~0 (kroppen avbruten) → äter inte budgeten
    if (r.status === 'fetchfail' || r.status === 'dberror' || r.status === 'incomplete') {
      // Transient (nätverk/DB/trunkerad) → markera INTE done, försök igen nästa varv (självläker).
      failed++
      const line = `${r.status} ${f.rel}${r.error ? ': ' + r.error : ''}`
      if (errors.length < 5) errors.push(line)
      console.error('[ingest-result] transient', line)
      continue
    }
    if (r.status === 'ok') {
      if (r.meta && r.meta.valtyp) meta = r.meta
      upserted += r.resultUp ?? 0
      uppUpserted += r.uppUp ?? 0
      turnoutUpserted += r.turnoutUp ?? 0
      const vt = vtOf(f.rel)
      if (vt && !probe) touched.add(vt)
    } else {
      skipped++ // 'toobig', 'corrupt' eller 'nodata' — markeras ändå done
      // toobig/corrupt är ALDRIG tysta: en /p/-fil > 4 MB har ingen annan ingestväg (skriptet tar bara /s/).
      if (r.status !== 'nodata') console.error('[ingest-result] hoppar', `${r.status} ${f.rel}${r.error ? ': ' + r.error : ''}`)
    }
    if (!probe) {
      const lastStatus = r.status === 'ok' ? 200 : r.status === 'toobig' ? 413 : r.status === 'nodata' ? 204 : 422
      const { error: stateErr } = await supabase.from('ingest_state').upsert(
        { file_path: f.url, etag: f.md5, last_ok: new Date().toISOString(), last_status: lastStatus },
        { onConflict: 'file_path' },
      )
      if (stateErr) console.error('[ingest-result] ingest_state-upsert misslyckades', f.rel, stateErr.message)
    }
    // Stor fil (riks-RD) → egen körning: lägg inte 24 KF-parsningar ovanpå i samma CPU-budget.
    if ((r.bytes ?? 0) > BIG_FILE_BYTES) break
  }

  // 5. Provenance för UI-badgen (best-effort). En gång per körning, från senaste filens meta.
  if (meta && !probe) {
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

  // 6. Snapshot-blobbar för de valtyper som ändrades denna körning (refresh-cronen tar resten).
  const toRefresh = [...touched]
  const snapshots = toRefresh.length ? await refreshSnapshotBlobs(supabase, toRefresh) : {}

  // ok = inga transienta fel denna körning. HTTP 200 ändå (delvis framgång är framgång — de
  // misslyckade filerna försöks igen nästa varv), men `ok:false` + `errors` i kroppen gör att
  // `net._http_response` (runbookens N4-SQL) visar problemet i stället för ett grönt "ok".
  return json({
    ok: failed === 0,
    source: base.includes('genrep') ? 'genrep2026' : 'val2026',
    changed: processed, upserted, uppUpserted, turnoutUpserted, skipped, failed,
    remaining: allChanged.length - processed, // inkl. det som budget/stor-fil-break lämnade kvar
    ...(errors.length ? { errors } : {}),
    ...(toRefresh.length ? { snapshots } : {}),
  })
  } finally {
    if (leased) {
      const { error } = await supabase.rpc('ingest_release', { p_name: LEASE_NAME })
      if (error) console.warn('[ingest-result] ingest_release misslyckades (TTL släpper ändå):', error.message)
    }
  }
})
