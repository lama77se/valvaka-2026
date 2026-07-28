// Regressionstest: mandatmodulen mot Valmyndighetens slutliga 2022-facit (RD).
// Steg-för-steg-checkar (advisor): röstaggregat → spärrset → fasta mandat → 349.
//   npx tsx scripts/verify-mandate.ts
import XLSX from 'xlsx'
import { computeRiksdag, type ConstituencyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'

// Pseudo-rader i Parti-kolumnen som INTE är partier (summa/ogiltiga/turnout).
// Kvar efter exkludering = "Summa giltiga röster" = 6 477 970.
const EXCLUDE = new Set([
  'Valdeltagande',
  'Summa giltiga röster',
  'ej anmält deltagande',
  'blanka röster',
  'övriga ogiltiga',
])

// Slutlig 2022-mandatfördelning (Riket-bladet i jämförande-statistiken).
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

// 1. roster_RD → röster per valkretskod per parti (+ valkretsnamn↔kod).
const wb = XLSX.readFile(`${DIR}/roster-rd-2022.xlsx`)
const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['roster_RD'], {
  header: 1,
  raw: false,
  defval: '',
}).slice(1)
const votesByConstituency: ConstituencyVotes = {}
const vkName: Record<string, string> = {}
for (const r of rows) {
  const vk = String(r[7]).trim()
  const parti = String(r[9]).trim()
  const roster = Number(String(r[10]).trim()) || 0
  if (!vk || EXCLUDE.has(parti)) continue
  vkName[vk] = String(r[8]).trim()
  ;(votesByConstituency[vk] ??= {})
  votesByConstituency[vk][parti] = (votesByConstituency[vk][parti] ?? 0) + roster
}

// 2. Fasta mandat per valkrets (2022) från fordelning-filen, namn → kod.
const wbF = XLSX.readFile(`${DIR}/fordelning-mandat-2022-2026.xlsx`)
const fRows = XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Mandat 2022 och 2026'], {
  header: 1,
  raw: false,
  defval: '',
})
const fH = fRows[0]
const iValkretsN = fH.indexOf('Valkrets')
const iFasta = fH.indexOf('Fasta mandat 2022')
const nameToCode = Object.fromEntries(Object.entries(vkName).map(([c, n]) => [n, c]))
const fixedSeatsByConstituency: Record<string, number> = {}
for (const r of fRows.slice(1)) {
  if (!/[Rr]iksdag/.test(String(r[0]))) continue
  const name = String(r[iValkretsN]).trim()
  const code = nameToCode[name]
  if (!code) {
    console.warn('⚠ valkrets utan kod-match:', name)
    continue
  }
  fixedSeatsByConstituency[code] = Number(r[iFasta]) || 0
}

// 3. Facit per valkrets per parti (TOTALT = fasta + utjämning) ur Valkrets-bladet
//    (höger inbäddad tabell: kol 10 = Parti, 11 = Mandat 2022). Diskriminerar
//    steg B: på "rena" valkretsar (dit inget utjämningsmandat föll) är totalt ==
//    fasta, så fixedByConstituencyParty MÅSTE matcha facit exakt där — det är
//    inte tautologin som stage 3 (summan 310) är.
const partySet = new Set(Object.keys(FACIT))
const wbV = XLSX.readFile(`${DIR}/rd-jamforande-2018-2022.xlsx`)
const vRows = XLSX.utils.sheet_to_json<string[]>(wbV.Sheets['Valkrets'], {
  header: 1,
  raw: false,
  defval: '',
})
const facitTotalByCode: Record<string, Record<string, number>> = {}
for (const r of vRows) {
  const name = String(r[1]).trim()
  const parti = String(r[11]).trim() // höger-blockets partikolumn (kol 11)
  if (!name || !partySet.has(parti)) continue
  const code = nameToCode[name]
  if (!code) {
    console.warn('⚠ Valkrets-facit utan kod-match:', name)
    continue
  }
  ;(facitTotalByCode[code] ??= {})
  facitTotalByCode[code][parti] = Number(String(r[12]).trim()) || 0 // Mandat (kol 12)
}

const res = computeRiksdag(votesByConstituency, {
  totalSeats: 349,
  firstDivisor: 1.2,
  nationalThreshold: 0.04,
  constituencyThreshold: 0.12,
  fixedSeatsByConstituency,
})

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
let ok = true
const check = (label: string, got: unknown, exp: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(exp)
  if (!pass) ok = false
  console.log(`${pass ? 'OK ' : 'FEL'} ${label}: ${got}${pass ? '' : ` (facit ${exp})`}`)
}

console.log('--- Stage 1: röstaggregat ---')
check('nationella giltiga röster', sum(res.nationalVotes), 6477970)
check('antal valkretsar', Object.keys(votesByConstituency).length, 29)
check('valkretsar med fasta mandat', Object.keys(fixedSeatsByConstituency).length, 29)

console.log('--- Stage 2: spärr (4%) ---')
check('antal kvalificerade partier', res.qualified.length, 8)

console.log('--- Stage 3: fasta mandat (summa) ---')
check('summa fasta mandat', sum(res.fixedByParty), 310)

// Diskriminerande per-valkrets-kontroll av steg B (ren S-L per valkrets):
//  a) rena valkretsar (facit-summa == fasta mandat i valkretsen) → exakt match.
//  b) alla valkretsar → fasta ≤ totalt (utjämning kan bara addera, aldrig ta bort).
console.log('--- Stage 3b: fasta mandat per valkrets (diskriminerande) ---')
let cleanCount = 0
let cleanMismatch = 0
let invariantViol = 0
for (const [code, facitByP] of Object.entries(facitTotalByCode)) {
  const fixedHere = res.fixedByConstituencyParty[code] ?? {}
  const facitSum = Object.values(facitByP).reduce((a, b) => a + b, 0)
  const isClean = facitSum === (fixedSeatsByConstituency[code] ?? -1)
  if (isClean) cleanCount++
  for (const p of partySet) {
    const got = fixedHere[p] ?? 0
    const facitTot = facitByP[p] ?? 0
    if (got > facitTot) invariantViol++
    if (isClean && got !== facitTot) cleanMismatch++
  }
}
check('valkretsar med facit-mandat', Object.keys(facitTotalByCode).length, 29)
console.log(`   (${cleanCount} rena valkretsar utan utjämningsmandat verifierade exakt)`)
check('rena valkretsar: fasta == facit exakt', cleanMismatch, 0)
check('invariant fasta ≤ totalt (alla valkretsar)', invariantViol, 0)

console.log('--- Stage 4: slutliga mandat vs facit ---')
for (const [p, exp] of Object.entries(FACIT)) check(p, res.seatsByParty[p] ?? 0, exp)
check('summa mandat', sum(res.seatsByParty), 349)
if (res.overhangParties.length) console.log('överhäng:', res.overhangParties)

// Steg D:s överhängsgren (set-aside + omräkning) triggas ALDRIG av RD 2022
// (inget parti har fler fasta än sin proportionella andel). Syntetiskt fall med
// handräknat facit så grenen inte är overifierad tills RF/KF exercerar den:
//   vk1 (3 fasta): A=100,B=1 → A tar alla 3 fasta.  vk2 (0 fasta): B=1000.
//   Riks-349→5: B=5, A=0.  A:s 3 fasta > 0 mål ⇒ A överhäng, sätts åt sidan med
//   3; resterande 2 räknas om bland {B} ⇒ B=2.  Facit: A=3, B=2.
console.log('--- Stage 5: syntetiskt överhäng (steg D set-aside-gren) ---')
const oh = computeRiksdag(
  { vk1: { A: 100, B: 1 }, vk2: { B: 1000 } },
  {
    totalSeats: 5,
    firstDivisor: 1.2,
    nationalThreshold: 0,
    constituencyThreshold: 1,
    fixedSeatsByConstituency: { vk1: 3, vk2: 0 },
  },
)
check('överhängsparti', oh.overhangParties, ['A'])
check('mandat med överhäng', oh.seatsByParty, { A: 3, B: 2 })
check('summa mandat (överhäng)', sum(oh.seatsByParty), 5)

console.log(ok ? '\n✅ MATCHAR FACIT EXAKT' : '\n❌ MATCHAR EJ — se FEL ovan')
process.exit(ok ? 0 : 1)
