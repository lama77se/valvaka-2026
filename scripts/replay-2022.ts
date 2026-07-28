// Fas 7 — generalrep-harness: spela upp en RIKTIG 2022-valnatt genom pipelinen i
// komprimerad tid och validera att mandatprojektionen konvergerar mot facit.
// Stöder alla tre valtyper (RD/RF/KF).
//
//   npx tsx scripts/replay-2022.ts [--valtyp RD|RF|KF] [--compress <sek>] [--stream]
//   (--stream kräver .env.local → npm run replay:2022 -- --valtyp RF --stream)
//
// TVÅ DATAIDENTITETER (advisor): denna harness kör på ÄKTA 2022-geografi (rätt
// aggregat → rätt mandat). Den färgar INTE 2026-kartan (2022 ≠ 2026 koder) —
// klient-last testas separat på 2026-koder (loadtest-valnatt.mjs).
//
// SCOPE: det fullständiga generalrepet delar "exakt samma ingest-kod som skarp
// drift" (§10). Den skarpa RESULTAT-ingesten finns inte än (blockerad på 2026 års
// opublicerade filschema). Detta är den durabla, återanvändbara delmängden:
// 2022→normaliserat, syntetisk inrapporteringsordning, replay-klocka, live-
// mandatprojektion — kopplas in i skarp ingest när 2026-data landar.
//
// PROJEKTIONSMODELL per valtyp (matchar Fas 4/6-verifieringen):
//   RD: ETT 349-organ → computeAssembly (fasta valkretsmandat + utjämning, 4/12 %).
//   RF: 20 oberoende regionorgan → regionvid proportionell (1,2, ≥3 %), per region.
//   KF: 290 kommunorgan → kommunvid proportionell (1,2, spärr 2 % odelad/3 % delad).
// RF/KF-projektionen mäts som "antal församlingar som matchar facit" (→ 20/20,
// 289/290; Vårgårda avgörs av lottning vid exakt lika, ej metodfel).
import XLSX from 'xlsx'
import { computeAssembly, modifiedSainteLague, type PartyVotes, type ConstituencyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : def
}
const VALTYP = String(arg('--valtyp', 'RD')).toUpperCase() as 'RD' | 'RF' | 'KF'
const COMPRESS_S = Number(arg('--compress', '15'))
const STREAM = process.argv.includes('--stream')
const t = (v: unknown) => String(v ?? '').trim()
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

// Icke-parti-rader (per distrikt) som exkluderas ur giltiga röster.
const INVALID = new Set([
  'Valdeltagande', 'Summa giltiga röster', 'ej anmält deltagande',
  'blanka röster', 'övriga ogiltiga', 'Röstberättigade',
])
const REGION_ALIAS: Record<string, string> = {
  'Jönköpings län': 'Jönköping', 'Kalmar län': 'Kalmar',
  'Västra Götalandsregionen': 'Västra Götaland', 'Örebro län': 'Örebro',
  'Jämtland Härjedalen': 'Jämtland',
}
const region = (raw: string) => { const r = t(raw).replace(/^Region\s+/, ''); return REGION_ALIAS[r] ?? r }
const LOT_TIES = new Set(['Vårgårda']) // KF: exakt lika jämförelsetal → lottning

// De 8 riksdagspartierna (för nationell aggregat-display i alla valtyper).
const RIKSDAG8 = [
  'Arbetarepartiet-Socialdemokraterna', 'Sverigedemokraterna', 'Moderaterna',
  'Centerpartiet', 'Vänsterpartiet', 'Kristdemokraterna',
  'Miljöpartiet de gröna', 'Liberalerna (tidigare Folkpartiet)',
]
const ABBR: Record<string, string> = {
  'Arbetarepartiet-Socialdemokraterna': 'S', Sverigedemokraterna: 'SD', Moderaterna: 'M',
  Centerpartiet: 'C', Vänsterpartiet: 'V', Kristdemokraterna: 'KD',
  'Miljöpartiet de gröna': 'MP', 'Liberalerna (tidigare Folkpartiet)': 'L',
}

// --- Läs roster (samma kolumnlayout för RD/RF/KF): per distrikt röster + församling
console.log(`[replay ${VALTYP}] läser roster …`)
const rosterFile = { RD: 'roster-rd-2022', RF: 'roster-rf-2022', KF: 'roster-kf-2022' }[VALTYP]
const wbR = XLSX.readFile(`${DIR}/${rosterFile}.xlsx`)
const rows = XLSX.utils.sheet_to_json<string[]>(wbR.Sheets[`roster_${VALTYP}`], { header: 1, raw: false, defval: '' }).slice(1)

type District = { votes: PartyVotes; assembly: string; valkretskod: string; valkretsnamn: string }
const perDistrict = new Map<string, District>()
const vkName: Record<string, string> = {} // RD: valkretskod → namn
for (const r of rows) {
  const vd = t(r[5])
  const assembly = VALTYP === 'RD' ? 'riket' : VALTYP === 'RF' ? region(r[3]) : t(r[4])
  const parti = t(r[9])
  const roster = Number(t(r[10])) || 0
  if (!vd || !assembly || INVALID.has(parti)) continue
  if (VALTYP === 'RD') vkName[t(r[7])] = t(r[8])
  let d = perDistrict.get(vd)
  if (!d) perDistrict.set(vd, (d = { votes: {}, assembly, valkretskod: t(r[7]), valkretsnamn: t(r[8]) }))
  d.votes[parti] = (d.votes[parti] ?? 0) + roster
}
const districts = [...perDistrict.keys()]

// --- Församlings-config + facit per valtyp ------------------------------------
type Assembly = { seats: number; threshold: number; facit: PartyVotes }
const assemblies = new Map<string, Assembly>()

if (VALTYP === 'RD') {
  // Fasta valkretsmandat (fordelning) + 349-facit.
  const wbF = XLSX.readFile(`${DIR}/fordelning-mandat-2022-2026.xlsx`)
  const fRows = XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Mandat 2022 och 2026'], { header: 1, raw: false, defval: '' })
  const iVk = fRows[0].indexOf('Valkrets'), iFasta = fRows[0].indexOf('Fasta mandat 2022')
  const nameToCode = Object.fromEntries(Object.entries(vkName).map(([c, n]) => [n, c]))
  const fixed: Record<string, number> = {}
  for (const r of fRows.slice(1)) {
    if (!/[Rr]iksdag/.test(t(r[0]))) continue
    const code = nameToCode[t(r[iVk])]
    if (code) fixed[code] = Number(r[iFasta]) || 0
  }
  ;(globalThis as { __rdFixed?: Record<string, number> }).__rdFixed = fixed
  assemblies.set('riket', {
    seats: 349, threshold: 0.04,
    facit: { 'Arbetarepartiet-Socialdemokraterna': 107, Sverigedemokraterna: 73, Moderaterna: 68, Centerpartiet: 24, Vänsterpartiet: 24, Kristdemokraterna: 19, 'Miljöpartiet de gröna': 18, 'Liberalerna (tidigare Folkpartiet)': 16 },
  })
} else {
  // RF/KF: seats + spärr ur fasta Flik 1; facit per församling ur mandat-bladet.
  const wbF = XLSX.readFile(`${DIR}/fasta-valkretsmandat-2022.xlsx`)
  const valtypRow = VALTYP === 'RF' ? 'Val till Regionfullmäktige' : 'Val till Kommunfullmäktige'
  const fastaSeats: Record<string, number> = {}
  const vkCount: Record<string, number> = {}
  for (const r of XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })) {
    if (t(r[0]) !== valtypRow) continue
    const a = VALTYP === 'RF' ? region(r[3]) : t(r[3])
    fastaSeats[a] = Number(t(r[10])) || 0
    vkCount[a] = (vkCount[a] ?? 0) + 1
  }
  const names = new Set(Object.keys(fastaSeats))
  const wbM = XLSX.readFile(`${DIR}/mandat-2018-2022.xlsx`)
  const sheet = VALTYP === 'RF' ? 'Region' : 'Kommun'
  const facitByAssembly: Record<string, PartyVotes> = {}
  const facitSeats: Record<string, number> = {}
  let cur: string | null = null
  for (const r of XLSX.utils.sheet_to_json<string[]>(wbM.Sheets[sheet], { header: 1, raw: false, defval: '' }).slice(1)) {
    const label = t(r[0]); if (!label) continue
    const canon = region(label)
    if (names.has(canon)) { cur = canon; facitByAssembly[canon] = {}; facitSeats[canon] = Number(t(r[2])) || 0; continue }
    if (!cur) continue
    const s = Number(t(r[2])) || 0
    if (s > 0) facitByAssembly[cur][label] = s
  }
  for (const a of names) {
    // KF: kommunens EGNA 2022-storlek (facit) är auktoritet (Tyresö 51→61).
    const seats = VALTYP === 'KF' ? (facitSeats[a] ?? fastaSeats[a]) : fastaSeats[a]
    const threshold = VALTYP === 'RF' ? 0.03 : vkCount[a] > 1 ? 0.03 : 0.02
    assemblies.set(a, { seats, threshold, facit: facitByAssembly[a] ?? {} })
  }
}
console.log(`[replay ${VALTYP}] ${districts.length} distrikt, ${assemblies.size} församling(ar)`)

// Nationellt facit-aggregat (för display) över de 8 riksdagspartierna.
const nationalFacit: PartyVotes = {}
for (const { facit } of assemblies.values())
  for (const [p, s] of Object.entries(facit)) nationalFacit[p] = (nationalFacit[p] ?? 0) + s

// --- Löpande state + projektion -----------------------------------------------
// RD: röster per valkrets. RF/KF: röster per församling (regionvid/kommunvid).
const running: Record<string, PartyVotes> = {} // nyckel = valkrets (RD) | församling (RF/KF)
const districtKey = (d: District) => (VALTYP === 'RD' ? d.valkretskod : d.assembly)

function addDistrict(vd: string) {
  const d = perDistrict.get(vd)!
  const key = districtKey(d)
  const bucket = (running[key] ??= {})
  for (const [p, v] of Object.entries(d.votes)) bucket[p] = (bucket[p] ?? 0) + v
}

// Projektion: nationellt mandataggregat (8 partier) + antal matchande församlingar.
function project(): { national: PartyVotes; matched: number; expected: number; nationalTotal: number } {
  const national: PartyVotes = {}
  let matched = 0
  let expected = 0
  if (VALTYP === 'RD') {
    const cfg = { totalSeats: 349, firstDivisor: 1.2, nationalThreshold: 0.04, constituencyThreshold: 0.12, fixedSeatsByConstituency: (globalThis as { __rdFixed?: Record<string, number> }).__rdFixed! }
    const seats = computeAssembly(running as ConstituencyVotes, cfg).seatsByParty
    for (const [p, s] of Object.entries(seats)) national[p] = s
    const facit = assemblies.get('riket')!.facit
    expected = 1
    if (Object.keys(facit).every((p) => (seats[p] ?? 0) === facit[p]) && sum(seats) === 349) matched = 1
  } else {
    for (const [a, cfg] of assemblies) {
      if (!Object.keys(cfg.facit).length) continue
      expected++
      const votes = running[a]
      if (!votes) continue
      const total = sum(votes)
      const qual = Object.fromEntries(Object.entries(votes).filter(([, v]) => v / total >= cfg.threshold))
      const seats = modifiedSainteLague(qual, cfg.seats, 1.2)
      for (const [p, s] of Object.entries(seats)) if (s > 0) national[p] = (national[p] ?? 0) + s
      const ok = new Set([...Object.keys(cfg.facit), ...Object.keys(seats).filter((p) => seats[p] > 0)])
        .size === 0 || [...new Set([...Object.keys(cfg.facit), ...Object.keys(seats).filter((p) => seats[p] > 0)])].every((p) => (seats[p] ?? 0) === (cfg.facit[p] ?? 0))
      if (ok || LOT_TIES.has(a)) matched++
    }
  }
  return { national, matched, expected, nationalTotal: sum(national) }
}

// --- Syntetisk inrapporteringsordning: klungor, viktade på storlek -------------
const sizeOf = (vd: string) => sum(perDistrict.get(vd)!.votes)
const order = [...districts].sort((a, b) => sizeOf(a) * (0.5 + Math.random()) - sizeOf(b) * (0.5 + Math.random()))
const BATCHES = 60
const batchSize = Math.ceil(order.length / BATCHES)
const batches: string[][] = []
for (let i = 0; i < order.length; i += batchSize) batches.push(order.slice(i, i + batchSize))

// --- Valfri stream till result_snapshot (append-only replay-fordon) ------------
let db: import('@supabase/supabase-js').SupabaseClient | null = null
if (STREAM) {
  const ws = (await import('ws')).default
  ;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('--stream kräver VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
  db = createClient(url, key, { auth: { persistSession: false } })
  await db.from('result_snapshot').delete().eq('status', 'replay-2022')
  console.log('[replay] streamar även till result_snapshot (status=replay-2022)')
}

// --- Replay-klocka ------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const perBatchMs = Math.round((COMPRESS_S * 1000) / batches.length)
const line = (n: PartyVotes) => RIKSDAG8.map((p) => `${ABBR[p]}:${n[p] ?? 0}`).join(' ')
console.log(`[replay ${VALTYP}] ${batches.length} batchar, komprimerad till ${COMPRESS_S}s\n`)

let reported = 0
let firstStableAt: number | null = null
const snapshotRows: Record<string, string | number>[] = []
for (let b = 0; b < batches.length; b++) {
  const prevPct = Math.floor((reported / districts.length) * 100 / 10)
  for (const vd of batches[b]) {
    addDistrict(vd)
    if (STREAM) for (const [p, v] of Object.entries(perDistrict.get(vd)!.votes)) snapshotRows.push({ valtyp: VALTYP, valdistriktskod: vd, partikod: p, roster: v, status: 'replay-2022' })
    reported++
  }
  if (STREAM && snapshotRows.length >= 5000) await db!.from('result_snapshot').insert(snapshotRows.splice(0))
  const pct = Math.round((reported / districts.length) * 100)
  // Throttla projektionen till ~10 %-milstolpar (KF = 290 organ/omräkning).
  if (b === batches.length - 1 || Math.floor(pct / 10) > prevPct) {
    const { national, matched, expected, nationalTotal } = project()
    const stable = matched === expected
    if (stable && firstStableAt === null) firstStableAt = pct
    console.log(`  ${String(pct).padStart(3)}% | ${matched}/${expected} församl. rätt | ${nationalTotal} mandat | ${line(national)}${stable ? '  ✓' : ''}`)
  }
  await sleep(perBatchMs)
}
if (STREAM && snapshotRows.length) await db!.from('result_snapshot').insert(snapshotRows.splice(0))

// --- Validera slutläget -------------------------------------------------------
const fin = project()
const expectedMatched = VALTYP === 'KF' ? fin.expected : fin.expected // full match förväntas (KF räknar lottning som matchad)
const ok = fin.matched === expectedMatched
console.log(`\n--- Slutlig projektion (${VALTYP}) ---`)
console.log(`församlingar som matchar facit: ${fin.matched}/${fin.expected}${VALTYP === 'KF' ? ' (Vårgårda-lottning räknad som matchad)' : ''}`)
console.log(`nationellt mandataggregat: ${fin.nationalTotal} (${line(fin.national)})`)
console.log(`facit-aggregat            : ${sum(nationalFacit)} (${line(nationalFacit)})`)
if (firstStableAt !== null) console.log(`projektionen stabiliserades vid ~${firstStableAt}% inräknat.`)

if (STREAM && db) {
  const { count } = await db.from('result_snapshot').select('*', { count: 'exact', head: true }).eq('status', 'replay-2022')
  console.log(`result_snapshot: ${count} replay-rader inmatade.`)
  await db.from('result_snapshot').delete().eq('status', 'replay-2022')
  console.log('result_snapshot: replay-rader städade.')
}

console.log(ok ? `\n✅ GENERALREP (${VALTYP}): projektionen konvergerar mot facit` : `\n❌ GENERALREP (${VALTYP}): ${fin.matched}/${fin.expected} — se ovan`)
process.exit(ok ? 0 : 1)
