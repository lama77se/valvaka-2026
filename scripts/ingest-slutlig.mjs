// LOKALT skript — ALLA SLUTLIGA resultatfiler (/s/), som edge-funktionen med flit INTE tar.
//
// Rollfördelning (sedan PR #37): edge tar bara de PRELIMINÄRA filerna (/p/) — det är allt som
// finns på valnatten och de ryms i edge:ns CPU-tak. Slutliga filer (/s/) bär personröster och är
// tunga att parsa; en KLUNGA medelstora slutliga i EN edge-invokering summerar >2 s CPU →
// WORKER_RESOURCE_LIMIT (546), och den odelade riks-RD:n (~260 MB uppackad) spränger taket ensam.
// Därför tar detta skript HELA den slutliga räkningen: riks-RD + alla 17 RF + alla ~290 KF.
// Node har inget CPU-/minnestak likt edge (uppmätt ~1,1 GB RSS på 260 MB-filen) → load-all funkar.
//
// KÖR under SLUTRÄKNINGEN (ons–fre efter valet), när de definitiva filerna dyker upp/uppdateras:
//   npm run ingest:slutlig            # tar bara filer som ändrats sedan sist (md5)
//   npm run ingest:slutlig -- --force # kör om alla slutliga filer
//
// Kräver service-role i .env.local (kringgår RLS, skriver result). Egna ingest_state-nycklar
// (STATE_PREFIX) → krockar aldrig med edge:ns state för samma fil.
import { createClient } from '@supabase/supabase-js'
import { unzipSync } from 'fflate'

// ⚠️ VALNATTEN/DEFINITIVT: byt till '…/val2026' SAMTIDIGT som ingest-result RESULT_BASE_DEFAULT.
// Om edge står på val2026 men detta skript på genrep laddas de slutliga filerna från TESTDATA.
const RESULT_BASE_DEFAULT = 'https://resultat.val.se/resultatfiler/genrep2026'

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
  const buf = new Uint8Array(await (await fetch(f.url)).arrayBuffer())
  log(`hämtar ${f.rel} (${(buf.length / 1048576).toFixed(1)} MB zip)`)
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

// 1. Manifest → ALLA slutliga (/s/) RD/RF/KF-filer.
const idx = await fetch(`${BASE}/index.md5`)
if (!idx.ok) { log(`manifest ${idx.status} @ ${BASE} — inga slutliga filer att hämta, avslutar.`); process.exit(0) }
const all = (await idx.text())
  .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
  .filter((e) => /\/s\/.*_(RD|RF|KF)\.zip$/i.test(e.rel))
  .map((e) => ({ ...e, url: BASE + e.rel.replace(/^\./, '') }))
if (all.length === 0) { log('inga slutliga filer i manifestet än — avslutar.'); process.exit(0) }

// 2. Vilka har ändrats sedan sist? (eget state-prefix). --force kör om alla.
const { data: states } = await db.from('ingest_state').select('file_path,etag').like('file_path', `${STATE_PREFIX}%`)
const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag]))
const changed = FORCE ? all : all.filter((e) => seen.get(STATE_PREFIX + e.url) !== e.md5)
if (changed.length === 0) { log(`alla ${all.length} slutliga filer oförändrade sedan sist — inget att göra.`); process.exit(0) }
// RD (den tunga 260 MB-filen) sist → minnestoppen kommer en gång, efter att småfilerna GC:ats.
changed.sort((a, b) => (/_RD\.zip$/i.test(a.rel) ? 1 : 0) - (/_RD\.zip$/i.test(b.rel) ? 1 : 0))
log(`att behandla: ${changed.length}/${all.length} slutliga filer${FORCE ? ' (--force)' : ''}`)

// 3. FK-set en gång, behandla filerna (frigör minne mellan varje).
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
log(`KLART — ${done}/${changed.length} slutliga filer behandlade.`)
process.exit(0)
