// LOKALT skript — de SLUTLIGA resultatfiler som är för stora för edge-funktionen.
//
// Slutliga filer bär personröster: RD publiceras odelat nationellt (~260 MB uppackad) och de
// största regionerna (Stockholm/VGR/Skåne) blir ~50–95 MB. Edge kan INTE parsa dem: Supabase-
// edge har ~2 s CPU/request och att tokenisera 260 MB spränger det på ~4 s (WORKER_RESOURCE_
// LIMIT), och den monolitiska JSON:en går inte att chunka/resume:a. ingest-result:s storleks-
// vakt (MAX_EDGE_ZIP_BYTES) HOPPAR därför dessa filer och delegerar dem hit. Node har inget
// sådant tak (uppmätt ~1,1 GB RSS på 260 MB-filen, väl inom 7 GB) → load-all funkar fint.
//
// KÖR under SLUTRÄKNINGEN (ons–fre efter valet), när de definitiva filerna dyker upp/uppdateras:
//   npm run ingest:slutlig-rd            # tar bara filer som ändrats sedan sist (md5)
//   npm run ingest:slutlig-rd -- --force # kör om alla stora slutliga filer
//
// Kräver service-role i .env.local (kringgår RLS, skriver result). Egna ingest_state-nycklar
// (STATE_PREFIX) → krockar aldrig med edge:ns state för samma fil.
import { createClient } from '@supabase/supabase-js'
import { unzipSync } from 'fflate'

// ⚠️ VALNATTEN/DEFINITIVT: byt till '…/val2026' SAMTIDIGT som ingest-result RESULT_BASE_DEFAULT.
// Om edge står på val2026 men detta skript på genrep laddas giganterna från TESTDATA.
const RESULT_BASE_DEFAULT = 'https://resultat.val.se/resultatfiler/genrep2026'

// Ta slutliga filer större än så här — SAMMA gräns som edge:ns MAX_EDGE_ZIP_BYTES (edge tar
// allt ≤ 4 MB zip, vi tar resten). Storleksfördelningen har ett tydligt glapp (2,7 → 5,4 MB).
const WORKER_MIN_BYTES = 3_900_000
const STATE_PREFIX = 'slutlig-local:' // eget nyckelrum (ingen krock med edge:ns url-nycklar)

const hasFlag = (n) => process.argv.includes(n)
const flagVal = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const FORCE = hasFlag('--force')
const BASE = String(flagVal('--base', process.env.RESULT_BASE ?? RESULT_BASE_DEFAULT)).replace(/\/+$/, '')

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const keyKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !keyKey) {
  console.error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — kör med --env-file=.env.local.')
  process.exit(1)
}
const db = createClient(url, keyKey, { auth: { persistSession: false } })
const log = (m) => console.log(`[slutlig-lokalt] ${m}`)

// FK-set (result→district / →party). En gång, delas av alla filer.
async function loadFkSets() {
  const districtSet = new Set()
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('district').select('valdistriktskod').range(from, from + 999)
    if (!data || data.length === 0) break
    for (const d of data) districtSet.add(d.valdistriktskod)
    if (data.length < 1000) break
  }
  const { data: parties } = await db.from('party').select('partikod')
  return { districtSet, partySet: new Set((parties ?? []).map((p) => p.partikod)) }
}

// Bygg + skriv EN organfil (load-all). Parsning/routing EXAKT som ingest-result.
async function processFile(f, sets) {
  log(`hämtar ${f.rel} (${(f.bytes / 1048576).toFixed(1)} MB zip)`)
  const buf = new Uint8Array(await (await fetch(f.url)).arrayBuffer())
  const unz = unzipSync(buf)
  const name = Object.keys(unz).find((n) => /rostfordelning.*\.json$/i.test(n))
  if (!name) { console.error(`  ingen rostfordelning i ${f.rel} — hoppar (markerar EJ done).`); return false }
  const j = JSON.parse(new TextDecoder().decode(unz[name]))
  const rakstatus = String(j.rakningstillfalle ?? '').startsWith('prelimin') ? 'preliminar' : 'slutlig'
  log(`  ${j.valtyp} · räkning "${j.rakningstillfalle}" → status ${rakstatus} · uppackad ${(unz[name].byteLength / 1048576).toFixed(0)} MB · ${j.valdistrikt?.length} distrikt`)

  const rows = []
  const uppRows = []
  for (const vd of j.valdistrikt ?? []) {
    const kod = vd.valdistriktskod
    if (vd.valdistriktstyp === 'uppsamlingsdistrikt') {
      const kommunkod = typeof vd.kommunkod === 'string' ? vd.kommunkod : null
      const lankod = typeof vd.lankod === 'string' ? vd.lankod : null
      if (typeof kod !== 'string' || !kommunkod || !lankod) continue
      for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
        if (!sets.partySet.has(p.partikod)) continue
        uppRows.push({ valtyp: j.valtyp, kod, kommunkod, lankod, partikod: p.partikod, roster: p.antalRoster, status: rakstatus })
      }
      continue
    }
    if (typeof kod !== 'string' || kod.length !== 8 || !sets.districtSet.has(kod)) continue
    const rapporteringstid = typeof vd.rapporteringsTid === 'string' ? vd.rapporteringsTid : null
    for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
      if (!sets.partySet.has(p.partikod)) continue
      rows.push({ valtyp: j.valtyp, valdistriktskod: kod, partikod: p.partikod, roster: p.antalRoster, status: rakstatus, rapporteringstid })
    }
  }
  const geoDistricts = new Set(rows.map((r) => r.valdistriktskod)).size
  log(`  byggt: ${rows.length} result-rader (${geoDistricts} distrikt) · ${uppRows.length} uppsamling-rader — upsertar…`)

  // Slutligt → 1000 rader/upsert (Realtime behövs ej ons–fre; klienten läser via snapshot).
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from('result').upsert(rows.slice(i, i + 1000), { onConflict: 'valtyp,valdistriktskod,partikod' })
    if (error) { console.error(`  result upsert: ${error.message}`); return false }
  }
  for (let i = 0; i < uppRows.length; i += 1000) {
    const { error } = await db.from('uppsamling_result').upsert(uppRows.slice(i, i + 1000), { onConflict: 'valtyp,kod,partikod' })
    if (error) { console.error(`  uppsamling_result upsert: ${error.message}`); return false }
  }
  log(`  klart: ${rows.length} result · ${uppRows.length} uppsamling`)
  return true
}

// 1. Manifest → slutliga RD/RF/KF-filer.
const idx = await fetch(`${BASE}/index.md5`)
if (!idx.ok) { log(`manifest ${idx.status} @ ${BASE} — inga slutliga filer att hämta, avslutar.`); process.exit(0) }
const all = (await idx.text())
  .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
  .filter((e) => /\/s\/.*_(RD|RF|KF)\.zip$/i.test(e.rel))
  .map((e) => ({ ...e, url: BASE + e.rel.replace(/^\./, '') }))
if (all.length === 0) { log('inga slutliga filer i manifestet än — avslutar.'); process.exit(0) }

// 2. HEAD-storlek → behåll bara de som är för stora för edge (> WORKER_MIN_BYTES).
log(`${all.length} slutliga filer, mäter storlek…`)
const sized = []
for (let i = 0; i < all.length; i += 20) {
  const rs = await Promise.all(all.slice(i, i + 20).map(async (e) => {
    const h = await fetch(e.url, { method: 'HEAD' })
    return { ...e, bytes: Number(h.headers.get('content-length')) || 0 }
  }))
  sized.push(...rs)
}
const big = sized.filter((e) => e.bytes > WORKER_MIN_BYTES).sort((a, b) => a.bytes - b.bytes)
log(`stora slutliga filer (> ${(WORKER_MIN_BYTES / 1048576).toFixed(1)} MB): ${big.length} — ${big.map((b) => b.rel.replace(/.*_(\d+|00)_(RD|RF|KF)\.zip$/, '$1 $2')).join(', ')}`)
if (big.length === 0) { log('inga stora slutliga filer (edge tar de små) — avslutar.'); process.exit(0) }

// 3. Vilka har ändrats sedan sist? (eget state-prefix). --force kör om alla.
const { data: states } = await db.from('ingest_state').select('file_path,etag').like('file_path', `${STATE_PREFIX}%`)
const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag]))
const changed = FORCE ? big : big.filter((e) => seen.get(STATE_PREFIX + e.url) !== e.md5)
if (changed.length === 0) { log('alla stora slutliga filer oförändrade sedan sist — inget att göra.'); process.exit(0) }
log(`att behandla: ${changed.length}/${big.length}${FORCE ? ' (--force)' : ''}`)

// 4. FK-set en gång, behandla filerna (minsta först → RD sist; frigör minne mellan).
const sets = await loadFkSets()
let done = 0
for (const f of changed) {
  const ok = await processFile(f, sets)
  if (ok) {
    await db.from('ingest_state').upsert(
      { file_path: STATE_PREFIX + f.url, etag: f.md5, last_ok: new Date().toISOString(), last_status: 200 },
      { onConflict: 'file_path' },
    )
    done++
  }
}
log(`KLART — ${done}/${changed.length} stora slutliga filer behandlade.`)
process.exit(0)
