// Fas 7 — generalrep-harness: spela upp en RIKTIG 2022-valnatt genom pipelinen i
// komprimerad tid och validera att mandatprojektionen konvergerar mot facit.
//
//   npx tsx scripts/replay-2022.ts [--compress <sek>] [--stream]
//   (--stream kräver .env.local: node --env-file=.env.local ... / npm run replay:2022)
//
// TVÅ DATAIDENTITETER (advisor): denna harness kör på ÄKTA 2022-geografi (rätt
// valkretsaggregat → rätt mandat). Den färgar INTE 2026-kartan (2022 ≠ 2026
// distriktskoder) — klient-last/throughput testas separat på 2026-koder.
//
// SCOPE: det fullständiga generalrepet delar "exakt samma ingest-kod som skarp
// drift" (arkitektur §10). Den skarpa RESULTAT-ingesten finns inte än (blockerad
// på 2026 års opublicerade filschema; Fas 3 byggde parti-CSV-ingest, ej roster).
// Denna harness bygger den DURABLA, återanvändbara delmängden: 2022→normaliserade
// rader, syntetisk inrapporteringsordning, replay-klocka, och live-mandatprojektion
// — allt kopplas in i den skarpa ingesten när 2026-data landar.
//
// Det append-only `result_snapshot` (utan FK) är replay-fordonet (arkitektur §8/§10).
import XLSX from 'xlsx'
import { computeAssembly, type ConstituencyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : def
}
const COMPRESS_S = Number(arg('--compress', '15')) // hela valnatten komprimerad till N sek
const STREAM = process.argv.includes('--stream')
const t = (v: unknown) => String(v ?? '').trim()

const EXCLUDE = new Set([
  'Valdeltagande',
  'Summa giltiga röster',
  'ej anmält deltagande',
  'blanka röster',
  'övriga ogiltiga',
])

// Slutlig 2022-mandatfördelning (facit) — samma som verify-mandate.ts.
const FACIT: Record<string, number> = {
  'Arbetarepartiet-Socialdemokraterna': 107,
  Sverigedemokraterna: 73,
  Moderaterna: 68,
  Centerpartiet: 24,
  Vänsterpartiet: 24,
  Kristdemokraterna: 19,
  'Miljöpartiet de gröna': 18,
  'Liberalerna (tidigare Folkpartiet)': 16,
}

// --- 1. Parsa 2022 RD-roster → röster per DISTRIKT (+ distriktets valkrets) -----
console.log('[replay] läser roster-rd-2022.xlsx …')
const wb = XLSX.readFile(`${DIR}/roster-rd-2022.xlsx`)
const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['roster_RD'], { header: 1, raw: false, defval: '' }).slice(1)
const votesByDistrict = new Map<string, Record<string, number>>() // vd -> parti -> röster
const districtValkrets = new Map<string, string>() // vd -> valkretskod
const vkName: Record<string, string> = {}
for (const r of rows) {
  const vd = t(r[5])
  const vk = t(r[7])
  const namn = t(r[8])
  const parti = t(r[9])
  const roster = Number(t(r[10])) || 0
  if (!vd || !vk || EXCLUDE.has(parti)) continue
  vkName[vk] = namn
  districtValkrets.set(vd, vk)
  let m = votesByDistrict.get(vd)
  if (!m) votesByDistrict.set(vd, (m = {}))
  m[parti] = (m[parti] ?? 0) + roster
}
const districts = [...votesByDistrict.keys()]
console.log(`[replay] ${districts.length} distrikt, ${Object.keys(vkName).length} valkretsar`)

// --- 2. Fasta valkretsmandat per RD-valkrets (config för mandatberäkning) -------
const wbF = XLSX.readFile(`${DIR}/fordelning-mandat-2022-2026.xlsx`)
const fRows = XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Mandat 2022 och 2026'], { header: 1, raw: false, defval: '' })
const iVk = fRows[0].indexOf('Valkrets')
const iFasta = fRows[0].indexOf('Fasta mandat 2022')
const nameToCode = Object.fromEntries(Object.entries(vkName).map(([c, n]) => [n, c]))
const fixedSeatsByConstituency: Record<string, number> = {}
for (const r of fRows.slice(1)) {
  if (!/[Rr]iksdag/.test(t(r[0]))) continue
  const code = nameToCode[t(r[iVk])]
  if (code) fixedSeatsByConstituency[code] = Number(r[iFasta]) || 0
}
const RD_CONFIG = {
  totalSeats: 349,
  firstDivisor: 1.2,
  nationalThreshold: 0.04,
  constituencyThreshold: 0.12,
  fixedSeatsByConstituency,
}

// --- 3. Syntetisk inrapporteringsordning: klungor, viktade på storlek ----------
// Små/tätorts-distrikt räknas typiskt tidigare. Vikta sorteringsnyckeln på
// distriktsstorlek (färre röster → tidigare) + brus, dela i batchar.
const sizeOf = (vd: string) => Object.values(votesByDistrict.get(vd)!).reduce((a, b) => a + b, 0)
const order = [...districts].sort((a, b) => {
  const ka = sizeOf(a) * (0.5 + Math.random())
  const kb = sizeOf(b) * (0.5 + Math.random())
  return ka - kb
})
const BATCHES = 60 // ~antal "klungor" under natten
const batchSize = Math.ceil(order.length / BATCHES)
const batches: string[][] = []
for (let i = 0; i < order.length; i += batchSize) batches.push(order.slice(i, i + batchSize))

// --- 4. Replay-klocka: mata in batchar, projicera mandat löpande ----------------
const running: ConstituencyVotes = {} // valkretskod -> parti -> röster (ackumulerat)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const perBatchMs = Math.round((COMPRESS_S * 1000) / batches.length)
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

// Valfritt: streama till result_snapshot (append-only replay-fordon).
let db: import('@supabase/supabase-js').SupabaseClient | null = null
if (STREAM) {
  const ws = (await import('ws')).default
  ;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('--stream kräver VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
  db = createClient(url, key, { auth: { persistSession: false } })
  await db.from('result_snapshot').delete().eq('status', 'replay-2022') // städa ev. rester
  console.log('[replay] streamar även till result_snapshot (status=replay-2022)')
}

const project = () => computeAssembly(running, RD_CONFIG).seatsByParty
const seatLine = (seats: Record<string, number>) =>
  Object.keys(FACIT).map((p) => `${p.split('-')[0].slice(0, 3) || p.slice(0, 3)}:${seats[p] ?? 0}`).join(' ')
const matchesFacit = (seats: Record<string, number>) =>
  Object.entries(FACIT).every(([p, n]) => (seats[p] ?? 0) === n) && sum(seats) === 349

console.log(`[replay] ${batches.length} batchar, valnatt komprimerad till ${COMPRESS_S}s (${perBatchMs}ms/batch)\n`)
let reported = 0
let firstStableAt: number | null = null
const snapshotRows: Record<string, string | number>[] = []
for (let b = 0; b < batches.length; b++) {
  for (const vd of batches[b]) {
    const vk = districtValkrets.get(vd)!
    const pv = votesByDistrict.get(vd)!
    ;(running[vk] ??= {})
    for (const [p, v] of Object.entries(pv)) {
      running[vk][p] = (running[vk][p] ?? 0) + v
      if (STREAM) snapshotRows.push({ valtyp: 'RD', valdistriktskod: vd, partikod: p, roster: v, status: 'replay-2022' })
    }
    reported++
  }
  if (STREAM && snapshotRows.length >= 5000) {
    await db!.from('result_snapshot').insert(snapshotRows.splice(0))
  }
  const pct = Math.round((reported / districts.length) * 100)
  // Projektion vid var ~10 %-milstolpe + sista batchen.
  if (b === batches.length - 1 || Math.floor((pct) / 10) > Math.floor(((reported - batches[b].length) / districts.length * 100) / 10)) {
    const seats = project()
    const stable = matchesFacit(seats)
    if (stable && firstStableAt === null) firstStableAt = pct
    console.log(`  ${String(pct).padStart(3)}% räknat | mandat ${sum(seats)} | ${seatLine(seats)}${stable ? '  ✓ = facit' : ''}`)
  }
  await sleep(perBatchMs)
}
if (STREAM && snapshotRows.length) await db!.from('result_snapshot').insert(snapshotRows.splice(0))

// --- 5. Validera slutläget mot facit -------------------------------------------
const final = project()
let ok = true
console.log('\n--- Slutlig mandatprojektion vs facit ---')
for (const [p, exp] of Object.entries(FACIT)) {
  const got = final[p] ?? 0
  if (got !== exp) ok = false
  console.log(`${got === exp ? 'OK ' : 'FEL'} ${p}: ${got}${got === exp ? '' : ` (facit ${exp})`}`)
}
if (sum(final) !== 349) { ok = false; console.log(`FEL summa mandat: ${sum(final)}`) }
if (firstStableAt !== null) console.log(`\nMandatprojektionen stabiliserades på facit vid ~${firstStableAt}% inräknat.`)

if (STREAM && db) {
  const { count } = await db.from('result_snapshot').select('*', { count: 'exact', head: true }).eq('status', 'replay-2022')
  console.log(`result_snapshot: ${count} replay-rader inmatade.`)
  await db.from('result_snapshot').delete().eq('status', 'replay-2022')
  console.log('result_snapshot: replay-rader städade.')
}

console.log(ok ? '\n✅ GENERALREP (RD): projektionen konvergerar mot facit exakt' : '\n❌ GENERALREP: se FEL ovan')
process.exit(ok ? 0 : 1)
