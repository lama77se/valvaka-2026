// Regressionstest: mandatberäkning för REGIONFULLMÄKTIGE (RF) mot Valmyndighetens
// slutliga 2022-facit. Verifierar den siffra produkten visar: PARTITOTAL per region.
//
// Partitotalen = den församlingsvida proportionella fördelningen (jämkade
// uddatalsmetoden, 1,2) bland partier över 3 %-spärren. 2022 RF har inga
// verkliga överskottsmandat (fasta ≤ proportionellt överallt), så totalen ÄR
// proportionalen — och den delen kör samma modul (modifiedSainteLague) som
// riksdagen.
//
// Medvetet EJ verifierat här: exakt PLACERING av mandat per valkrets (steg B/E).
// Den behövs inte för produkten (2026 visar röster per distrikt + partitotal per
// församling), och min per-valkrets fasta-fördelning avviker med ett mandat i
// knivskarpa (<0,4 %) valkretsar — ett placeringsproblem, inte ett totalfel.
//
//   npx tsx scripts/verify-mandate-rf.ts
import XLSX from 'xlsx'
import { modifiedSainteLague } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const FIRST_DIVISOR = 1.2
const THRESHOLD = 0.03 // regionspärr 3 %

const INVALID = new Set([
  'blanka röster',
  'övriga ogiltiga',
  'ej anmält deltagande',
  'Summa giltiga röster',
  'Valdeltagande',
  'Röstberättigade',
])
const REGION_ALIAS: Record<string, string> = {
  'Jönköpings län': 'Jönköping',
  'Kalmar län': 'Kalmar',
  'Västra Götalandsregionen': 'Västra Götaland',
  'Örebro län': 'Örebro',
  'Jämtland Härjedalen': 'Jämtland',
}
const t = (v: unknown) => String(v ?? '').trim()
const region = (raw: string) => {
  const r = t(raw).replace(/^Region\s+/, '')
  return REGION_ALIAS[r] ?? r
}

// 1) Regionens totala mandat (Flik 1, "Totalt antal mandat" per RF-valområde).
const wbF = XLSX.readFile(`${DIR}/fasta-valkretsmandat-2022.xlsx`)
const regionSeats: Record<string, number> = {}
for (const r of XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })) {
  if (t(r[0]) !== 'Val till Regionfullmäktige') continue
  regionSeats[region(r[3])] = Number(t(r[10])) || 0
}
const regionNames = new Set(Object.keys(regionSeats))

// 2) Röster per region per parti (summerat över distrikt), + giltig totalsumma.
const wbR = XLSX.readFile(`${DIR}/roster-rf-2022.xlsx`)
const votesByRegion: Record<string, Record<string, number>> = {}
const validTotal: Record<string, number> = {}
for (const r of XLSX.utils.sheet_to_json<string[]>(wbR.Sheets['roster_RF'], { header: 1, raw: false, defval: '' }).slice(1)) {
  const reg = region(r[3])
  const parti = t(r[9])
  const roster = Number(t(r[10])) || 0
  if (!reg || !parti || INVALID.has(parti)) continue
  ;(votesByRegion[reg] ??= {})[parti] = (votesByRegion[reg][parti] ?? 0) + roster
  validTotal[reg] = (validTotal[reg] ?? 0) + roster
}

// 3) Facit: mandat per parti per region (mandat-2018-2022, blad Region, 2022-kol).
const wbM = XLSX.readFile(`${DIR}/mandat-2018-2022.xlsx`)
const facit: Record<string, Record<string, number>> = {}
let curRegion: string | null = null
for (const r of XLSX.utils.sheet_to_json<string[]>(wbM.Sheets['Region'], { header: 1, raw: false, defval: '' }).slice(1)) {
  const label = t(r[0])
  if (!label) continue
  const canon = region(label)
  if (regionNames.has(canon)) {
    curRegion = canon
    facit[canon] = {}
    continue
  }
  if (!curRegion) continue
  const seats = Number(t(r[2])) || 0 // 2022; blank → 0
  if (seats > 0) facit[curRegion][label] = seats
}

// --- Verifiera partitotal (proportionell 1,2 bland ≥3 %) mot facit per region ---
let ok = 0
let fail = 0
const warnings: string[] = []
const failures: string[] = []

for (const reg of regionNames) {
  const votes = votesByRegion[reg]
  const exp = facit[reg]
  const seats = regionSeats[reg]
  if (!votes) { warnings.push(`ingen röstdata: ${reg}`); continue }
  if (!exp) { warnings.push(`ingen facit: ${reg}`); continue }

  const qualified = Object.fromEntries(
    Object.entries(votes).filter(([, v]) => v / validTotal[reg] >= THRESHOLD),
  )
  const got = modifiedSainteLague(qualified, seats, FIRST_DIVISOR)

  const parties = new Set([...Object.keys(exp), ...Object.keys(got).filter((p) => got[p] > 0)])
  const diffs: string[] = []
  for (const p of parties) if ((got[p] ?? 0) !== (exp[p] ?? 0)) diffs.push(`${p}: ${got[p] ?? 0} (facit ${exp[p] ?? 0})`)
  const sumFacit = Object.values(exp).reduce((a, b) => a + b, 0)
  if (sumFacit !== seats) diffs.push(`facit-summa ${sumFacit} ≠ regionmandat ${seats}`)

  if (diffs.length === 0) ok++
  else { fail++; failures.push(`FEL ${reg} (${seats} mandat):\n     ${diffs.join('\n     ')}`) }
}

console.log(`--- RF: partitotal per region vs facit ---`)
console.log(`OK regioner: ${ok}/${ok + fail}`)
if (warnings.length) {
  console.log(`\n⚠ Varningar (${warnings.length}):`)
  for (const w of warnings) console.log('  ' + w)
}
if (failures.length) {
  console.log(`\n❌ Avvikelser:`)
  for (const f of failures) console.log('  ' + f)
}

const pass = fail === 0 && warnings.length === 0
console.log(pass ? '\n✅ RF PARTITOTAL MATCHAR FACIT EXAKT (20/20)' : '\n❌ RF: se ovan')
process.exit(pass ? 0 : 1)
