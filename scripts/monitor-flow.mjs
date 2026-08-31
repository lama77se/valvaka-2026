// Fast-track FLÖDESAVSTÄMNING under genrep/valnatt — "shadow" av kedjan utan rendering.
// Läser samma källor som produktionsflödet och stämmer av dem mot varandra:
//
//   val.se-filer  ──edge(ingest-result)──►  DB (result/uppsamling)  ──Realtime──►  front
//   └── manifest + zip                      └── skriptets DB-läsning              └── (jämför i browsern)
//
// TVÅ BEN:
//   1. DB↔front (default): läser `result`/`uppsamling_result`/`dataset_meta` DIREKT och skriver
//      vad sidans HUD BORDE visa (inrapporterade distrikt/valtyp, ledande parti, status, banner,
//      färskhet). Fångar "sidan visar inte det DB:n har" (Realtime/klientbugg).
//   2. val.se↔edge (default, fil-nivå): hämtar manifestet (index.md5), räknar de preliminära
//      organ-filerna (/p/, RD/RF/KF) och jämför md5 mot `ingest_state.etag` — dvs hur många av
//      källans filer edge faktiskt ingest:at. Fångar "edge har inte fått med allt från val.se".
//   3. --deep (på begäran, TUNGT): packar upp + parsar varje käll-zip och räknar distrikt/röster
//      OBEROENDE ur källan, jämför mot DB. Äkta shadow-processning. Kör inte var 2:e min (~314
//      filer/varv) — kör manuellt då och då för en full audit.
//
//   node --env-file=.env.local scripts/monitor-flow.mjs              # loop var 30s (ben 1+2)
//   node --env-file=.env.local scripts/monitor-flow.mjs --once
//   node --env-file=.env.local scripts/monitor-flow.mjs --once --deep
//   node --env-file=.env.local scripts/monitor-flow.mjs --base https://resultat.val.se/resultatfiler/val2026
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
import { unzipSync } from 'fflate'
globalThis.WebSocket ??= ws

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local).'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const ONCE = process.argv.includes('--once')
const DEEP = process.argv.includes('--deep')
const INTERVAL = Math.max(5, Number(arg('--interval', '30'))) * 1000
const BASE = arg('--base', 'https://resultat.val.se/resultatfiler/genrep2026')
const VALTYPER = ['RD', 'RF', 'KF']
const VK = { RD: 'vk_rd', RF: 'vk_rf', KF: 'vk_kf' }
const fmt = new Intl.NumberFormat('sv-SE')
const vtOf = (rel) => rel.match(/_(RD|RF|KF)\.zip$/i)?.[1].toUpperCase()

// Nämnare: antal distrikt per valtyp — SAMMA villkor som klienten (vk satt & ej tom).
async function totalDistricts() {
  const out = {}
  for (const vt of VALTYPER) {
    const { count } = await db.from('district').select('*', { count: 'exact', head: true }).not(VK[vt], 'is', null).neq(VK[vt], '')
    out[vt] = count ?? 0
  }
  return out
}

async function partyMap() {
  const { data } = await db.from('party').select('partikod,forkortning')
  return new Map((data ?? []).map((p) => [p.partikod, p.forkortning ?? p.partikod]))
}

// Hela result-snapshoten (samma paginering/kolumner som klientens mount-läsning).
async function readResult() {
  const rows = []
  const PAGE = 10000
  for (let from = 0; ; from += PAGE) {
    // Stabil nyckelordning (valdistriktskod, partikod) → offseten kan inte glida/hoppa över rader
    // när tabellen skrivs mitt i den flersidiga läsningen (gav tidigare fantom-dippar i distriktsantalet).
    const { data, error } = await db.from('result').select('valtyp,valdistriktskod,partikod,roster,status,updated_at').order('valdistriktskod', { ascending: true }).order('partikod', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

// val.se-manifest → preliminära organ-filer (SAMMA filter som edge: /p/ + _RD|RF|KF.zip).
async function readManifest() {
  const res = await fetch(`${BASE}/index.md5`)
  if (!res.ok) return { ok: false, status: res.status }
  const files = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
    .filter((e) => /_(RD|RF|KF)\.zip$/i.test(e.rel) && e.rel.includes('/p/'))
    .map((e) => ({ md5: e.md5, url: BASE + e.rel.replace(/^\./, ''), vt: vtOf(e.rel) }))
  return { ok: true, files }
}

// --deep: packa upp + parsa varje käll-zip och räkna distrikt/röster OBEROENDE (som edge).
async function deepShadow(files, districtSet, partySet) {
  const per = {}; for (const vt of VALTYPER) per[vt] = { distr: new Set(), votes: 0, skipped: 0 }
  const dec = new TextDecoder()
  for (const f of files) {
    try {
      const res = await fetch(f.url); if (!res.ok) { per[f.vt] && per[f.vt].skipped++; continue }
      const files0 = unzipSync(new Uint8Array(await res.arrayBuffer()))
      const name = Object.keys(files0).find((n) => /rostfordelning.*\.json$/i.test(n)); if (!name) continue
      const obj = JSON.parse(dec.decode(files0[name]))
      const vt = obj.valtyp || f.vt
      for (const vd of obj.valdistrikt ?? []) {
        const kod = vd.valdistriktskod
        if (vd.valdistriktstyp === 'uppsamlingsdistrikt') continue // ryms i uppsamling_result, hoppas i distriktsräkningen
        if (typeof kod !== 'string' || kod.length !== 8 || !districtSet.has(kod)) continue
        per[vt].distr.add(kod)
        for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) if (partySet.has(p.partikod)) per[vt].votes += p.antalRoster
      }
    } catch { per[f.vt] && per[f.vt].skipped++ }
  }
  return per
}

async function cycle(total, parties, sets) {
  const rows = await readResult()
  const { data: meta } = await db.from('dataset_meta').select('source,test,rakningstillfalle,kalla_uppdaterad').eq('id', 1).maybeSingle()
  const { count: upp } = await db.from('uppsamling_result').select('*', { count: 'exact', head: true })
  const manifest = await readManifest()
  const { data: states } = await db.from('ingest_state').select('file_path,etag').like('file_path', `${BASE}/%`)
  const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag]))

  // DB-aggregat per valtyp.
  const per = {}; for (const vt of VALTYPER) per[vt] = { distr: new Set(), slutlig: new Set(), votes: 0, byParty: {} }
  let maxUpd = null
  for (const r of rows) {
    const p = per[r.valtyp]; if (!p) continue
    p.distr.add(r.valdistriktskod); p.votes += r.roster
    p.byParty[r.partikod] = (p.byParty[r.partikod] ?? 0) + r.roster
    if (r.status === 'slutlig') p.slutlig.add(r.valdistriktskod)
    if (!maxUpd || r.updated_at > maxUpd) maxUpd = r.updated_at
  }

  // val.se↔edge per valtyp (fil-nivå): antal manifest-filer + hur många edge är ikapp på.
  const vsrc = {}; for (const vt of VALTYPER) vsrc[vt] = { files: 0, caught: 0 }
  if (manifest.ok) for (const f of manifest.files) { const v = vsrc[f.vt]; if (!v) continue; v.files++; if (seen.get(f.url) === f.md5) v.caught++ }

  const deep = DEEP && manifest.ok ? await deepShadow(manifest.files, sets.districts, sets.parties) : null

  const now = new Date()
  console.log(`\n── ${now.toLocaleTimeString('sv-SE')} ── flödesavstämning ── källa: ${BASE.split('/').pop()} ──`)
  for (const vt of VALTYPER) {
    const p = per[vt], tot = total[vt] || 0, rep = p.distr.size, pct = tot ? Math.round((rep / tot) * 100) : 0
    let lead = null, leadV = -1
    for (const [pk, v] of Object.entries(p.byParty)) if (v > leadV) { leadV = v; lead = pk }
    const leadTxt = lead && p.votes ? `${parties.get(lead) ?? lead} ${((leadV / p.votes) * 100).toFixed(1)}%` : '—'
    const status = rep === 0 ? 'inga röster' : p.slutlig.size >= rep ? 'slutgiltigt' : p.slutlig.size > 0 ? `sluträknas ${Math.round((p.slutlig.size / rep) * 100)}%` : 'preliminärt'
    const s = vsrc[vt]
    const srcTxt = manifest.ok ? `källfiler ${s.caught}/${s.files} ingest:ade` : `manifest ${manifest.status}`
    const deepTxt = deep ? ` · shadow ${deep[vt].distr.size} distr/${fmt.format(deep[vt].votes)} röster${deep[vt].distr.size === rep && deep[vt].votes === p.votes ? ' ✓' : ' ⚠ SKILJER'}` : ''
    console.log(`  ${vt}: ${fmt.format(rep)}/${fmt.format(tot)} distr (${String(pct).padStart(3)}%) · ${fmt.format(p.votes).padStart(9)} röster · led ${leadTxt.padEnd(9)} · ${status} · ${srcTxt}${deepTxt}`)
  }
  const age = maxUpd ? Math.round((now.getTime() - new Date(maxUpd).getTime()) / 1000) : null
  const totFiles = manifest.ok ? manifest.files.length : 0, totCaught = manifest.ok ? Object.values(vsrc).reduce((a, v) => a + v.caught, 0) : 0
  const srcSummary = !manifest.ok ? `manifest ${manifest.status} (ingen fil)` : totFiles === 0 ? 'manifest 200 men TOMT — inga organ-filer publicerade än (väntar på sim)' : `${totFiles} preliminära organ-filer · edge ikapp på ${totCaught}${totCaught < totFiles ? ` — ${totFiles - totCaught} VÄNTAR/ändrade` : ' ✓ allt ingest:at'}`
  console.log(`  källa: ${srcSummary}`)
  console.log(`  banner: source=${meta?.source} test=${meta?.test} (${meta?.rakningstillfalle ?? '—'}) · källa uppd. ${meta?.kalla_uppdaterad ?? '—'}`)
  console.log(`  färskhet: senaste result-skrivning ${age != null ? age + 's sedan' : '—'} · uppsamling_result: ${fmt.format(upp ?? 0)} rader`)
}

const total = await totalDistricts()
const parties = await partyMap()
let sets = { districts: new Set(), parties: new Set() }
if (DEEP) { // hämta kända distrikt/partier så shadow filtrerar exakt som edge
  const { data: d } = await db.from('district').select('valdistriktskod')
  const { data: p } = await db.from('party').select('partikod')
  sets = { districts: new Set((d ?? []).map((x) => x.valdistriktskod)), parties: new Set((p ?? []).map((x) => x.partikod)) }
}
console.log(`Nämnare (deltagande distrikt): RD ${fmt.format(total.RD)} · RF ${fmt.format(total.RF)} · KF ${fmt.format(total.KF)}${DEEP ? ' · --deep PÅ (tung: parsar alla käll-zip)' : ''}`)
if (ONCE) { await cycle(total, parties, sets); process.exit(0) }
console.log(`Loop var ${INTERVAL / 1000}s — Ctrl+C för att avsluta.`)
for (;;) { await cycle(total, parties, sets); await new Promise((r) => setTimeout(r, INTERVAL)) }
