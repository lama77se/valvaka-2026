// Regressionstest: mandatberäkning för KOMMUNFULLMÄKTIGE (KF) mot Valmyndighetens
// slutliga 2022-facit. Som RF verifieras den siffra produkten visar: PARTITOTAL
// per kommun = kommunvid proportionell fördelning (jämkade uddatalsmetoden, 1,2)
// bland partier över spärren.
//
// KF-spärren SKILJER: 2 % i odelade kommuner, 3 % i kommuner indelade i valkretsar
// (17 st 2022). Delning avläses ur fasta-filen (antal valkretsar per kommun).
//
// Medvetet EJ verifierat: exakt placering per valkrets (samma knivseggs-avvikelse
// som RF; behövs ej för produkten).
//
//   npx tsx scripts/verify-mandate-kf.ts
import XLSX from 'xlsx'
import { modifiedSainteLague } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const FIRST_DIVISOR = 1.2

const INVALID = new Set([
  'blanka röster',
  'övriga ogiltiga',
  'ej anmält deltagande',
  'Summa giltiga röster',
  'Valdeltagande',
  'Röstberättigade',
])
const t = (v: unknown) => String(v ?? '').trim()

// Kommuner där facit avviker med ett mandat p.g.a. LOTTNING vid exakt lika
// jämförelsetal — kan inte reproduceras deterministiskt (räknas ej som fel):
//   Vårgårda: L:s 2:a mandat 279/3 = 93,0 = KD:s 6:e mandat 1023/11 — exakt lika;
//             lotten gav L, min deterministiska brytning ger KD.
const LOT_TIES = new Set(['Vårgårda'])

// 1) Fasta Flik 1 → KF: antal valkretsar per kommun (→ spärr) + pre-val-storlek.
const wbF = XLSX.readFile(`${DIR}/fasta-valkretsmandat-2022.xlsx`)
const fastaSeats: Record<string, number> = {}
const valkretsCount: Record<string, number> = {}
for (const r of XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })) {
  if (t(r[0]) !== 'Val till Kommunfullmäktige') continue
  const kommun = t(r[3]) // Valområde = kommunnamn
  fastaSeats[kommun] = Number(t(r[10])) || 0
  valkretsCount[kommun] = (valkretsCount[kommun] ?? 0) + 1
}
const kommunNames = new Set(Object.keys(fastaSeats))
const threshold = (kommun: string) => (valkretsCount[kommun] > 1 ? 0.03 : 0.02)
const dividedCount = Object.values(valkretsCount).filter((n) => n > 1).length
console.log(`Fasta: ${kommunNames.size} kommuner (${dividedCount} delade → 3 %, övriga → 2 %)`)

// 2) Röster per kommun per parti (summerat över distrikt), + giltig totalsumma.
const wbR = XLSX.readFile(`${DIR}/roster-kf-2022.xlsx`)
const votesByKommun: Record<string, Record<string, number>> = {}
const validTotal: Record<string, number> = {}
for (const r of XLSX.utils.sheet_to_json<string[]>(wbR.Sheets['roster_KF'], { header: 1, raw: false, defval: '' }).slice(1)) {
  const kommun = t(r[4])
  const parti = t(r[9])
  const roster = Number(t(r[10])) || 0
  if (!kommun || !parti || INVALID.has(parti)) continue
  ;(votesByKommun[kommun] ??= {})[parti] = (votesByKommun[kommun][parti] ?? 0) + roster
  validTotal[kommun] = (validTotal[kommun] ?? 0) + roster
}

// 3) Facit: mandat per parti per kommun + faktisk 2022-fullmäktigestorlek
//    (mandat-2018-2022, blad Kommun, 2022-kol). Storleken är kommunens EGET beslut
//    (inte något modulen räknar) → den faktiska 2022-storleken är auktoritet.
const wbM = XLSX.readFile(`${DIR}/mandat-2018-2022.xlsx`)
const facit: Record<string, Record<string, number>> = {}
const kommunSeats: Record<string, number> = {}
let cur: string | null = null
for (const r of XLSX.utils.sheet_to_json<string[]>(wbM.Sheets['Kommun'], { header: 1, raw: false, defval: '' }).slice(1)) {
  const label = t(r[0])
  if (!label) continue
  if (kommunNames.has(label)) {
    cur = label
    facit[label] = {}
    kommunSeats[label] = Number(t(r[2])) || 0 // 2022-total = fullmäktigestorlek
    continue
  }
  if (!cur) continue
  const seats = Number(t(r[2])) || 0
  if (seats > 0) facit[cur][label] = seats
}

// Datanotis: fasta-filen (2022-04-08) och faktisk 2022-storlek kan skilja om en
// kommun ändrat fullmäktigestorlek. 2022 gäller det bara Tyresö (51 → 61).
const seatMismatch = [...kommunNames].filter((k) => fastaSeats[k] !== kommunSeats[k])
if (seatMismatch.length)
  console.log(`Notis: fasta-storlek ≠ faktisk 2022-storlek för ${seatMismatch.map((k) => `${k} (${fastaSeats[k]}→${kommunSeats[k]})`).join(', ')} — använder faktisk.`)

// --- Verifiera partitotal per kommun mot facit --------------------------------
let ok = 0
let fail = 0
let lot = 0
const warnings: string[] = []
const failures: string[] = []

for (const kommun of kommunNames) {
  const votes = votesByKommun[kommun]
  const exp = facit[kommun]
  const seats = kommunSeats[kommun]
  if (!votes) { warnings.push(`ingen röstdata: ${kommun}`); continue }
  if (!exp) { warnings.push(`ingen facit: ${kommun}`); continue }

  const thr = threshold(kommun)
  const qualified = Object.fromEntries(
    Object.entries(votes).filter(([, v]) => v / validTotal[kommun] >= thr),
  )
  const got = modifiedSainteLague(qualified, seats, FIRST_DIVISOR)

  const parties = new Set([...Object.keys(exp), ...Object.keys(got).filter((p) => got[p] > 0)])
  const diffs: string[] = []
  for (const p of parties) if ((got[p] ?? 0) !== (exp[p] ?? 0)) diffs.push(`${p}: ${got[p] ?? 0} (facit ${exp[p] ?? 0})`)
  const sumFacit = Object.values(exp).reduce((a, b) => a + b, 0)
  if (sumFacit !== seats) diffs.push(`facit-summa ${sumFacit} ≠ kommunmandat ${seats}`)

  if (diffs.length === 0) ok++
  else if (LOT_TIES.has(kommun)) lot++ // känd lottning vid exakt lika, ej metodfel
  else { fail++; failures.push(`FEL ${kommun} (${seats} mandat, spärr ${thr * 100}%):\n     ${diffs.join('\n     ')}`) }
}

console.log(`\n--- KF: partitotal per kommun vs facit ---`)
console.log(`OK kommuner: ${ok}/${ok + fail + lot} (+ ${lot} känd lottning)`)
if (warnings.length) {
  console.log(`\n⚠ Varningar (${warnings.length}):`)
  for (const w of warnings.slice(0, 40)) console.log('  ' + w)
}
if (failures.length) {
  console.log(`\n❌ Avvikelser (${failures.length}):`)
  for (const f of failures.slice(0, 40)) console.log('  ' + f)
}

const pass = fail === 0 && warnings.length === 0
console.log(
  pass
    ? `\n✅ KF PARTITOTAL MATCHAR FACIT (${ok}/${ok + lot} exakt, ${lot} lottning-tie dokumenterad)`
    : '\n❌ KF: se ovan',
)
process.exit(pass ? 0 : 1)
