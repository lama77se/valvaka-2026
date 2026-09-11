// Regressionstest: placeLevelingSeats (RD:s utjämningsmandat-PLACERING per valkrets) mot
// Valmyndighetens riktiga 2022-facit (samma "Valkrets"-blad som verify-mandate.ts läser
// TOTALEN ur — här kontrolleras i stället VILKEN valkrets varje mandat faktiskt landade i).
//
// Detta är den bit computeAssembly medvetet INTE gör (se dess docstring) — fasta mandat +
// nationell utjämning per PARTI var redan verifierat (verify-mandate.ts), men INTE var
// utjämningsmandaten hamnar geografiskt. 12 sep: körd mot alla 29 valkretsar × 8 kvalificerade
// partier (232 par) — matchar Valmyndighetens facit EXAKT (0 avvikelser).
//
//   npx tsx scripts/verify-mandate-leveling.ts
import XLSX from 'xlsx'
import { computeAssembly, placeLevelingSeats, type ConstituencyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const t = (v: unknown) => String(v ?? '').trim()
const EXCLUDE = new Set(['Valdeltagande', 'Summa giltiga röster', 'ej anmält deltagande', 'blanka röster', 'övriga ogiltiga'])

// 1. Röster per valkrets (samma fil/kolumner som verify-mandate.ts).
const wb = XLSX.readFile(`${DIR}/roster-rd-2022.xlsx`)
const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['roster_RD'], { header: 1, raw: false, defval: '' }).slice(1)
const votesByConstituency: ConstituencyVotes = {}
const vkName: Record<string, string> = {}
for (const r of rows) {
  const vk = t(r[7])
  const parti = t(r[9])
  const roster = Number(t(r[10])) || 0
  if (!vk || EXCLUDE.has(parti)) continue
  vkName[vk] = t(r[8])
  ;(votesByConstituency[vk] ??= {})
  votesByConstituency[vk][parti] = (votesByConstituency[vk][parti] ?? 0) + roster
}
const nameToCode = Object.fromEntries(Object.entries(vkName).map(([c, n]) => [n, c]))

// 2. Fasta mandat per valkrets 2022 (fasta-valkretsmandat-val-2022.xlsx, "Flik 1" —
//    samma schema som 2026-filen build-seat-config.mjs läser, bara ett annat år).
const wbF = XLSX.readFile(`${DIR}/fasta-valkretsmandat-2022.xlsx`)
const fRows = XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })
const fixedSeatsByConstituency: Record<string, number> = {}
for (const r of fRows.slice(1)) {
  if (t(r[0]) !== 'Val till Riksdagen') continue
  const code = nameToCode[t(r[4])]
  if (!code) { console.warn('⚠ valkrets utan kod-match (fasta-fil):', t(r[4])); continue }
  fixedSeatsByConstituency[code] = Number(t(r[9])) || 0
}

// 3. Facit: TOTALT mandat (fasta + utjämning) per valkrets per parti, ur
//    rd-jamforande-2018-2022.xlsx "Valkrets"-bladet (samma fil som verify-mandate.ts,
//    som bara kontrollerar STEG B/fasta där — här kontrolleras SUMMAN mot placeringen).
const wbV = XLSX.readFile(`${DIR}/rd-jamforande-2018-2022.xlsx`)
const vRows = XLSX.utils.sheet_to_json<string[]>(wbV.Sheets['Valkrets'], { header: 1, raw: false, defval: '' })
const facitByCode: Record<string, Record<string, number>> = {}
for (const r of vRows) {
  const name = t(r[1])
  const parti = t(r[11])
  if (!name || !parti) continue
  const code = nameToCode[name]
  if (!code) continue
  ;(facitByCode[code] ??= {})
  facitByCode[code][parti] = Number(t(r[12])) || 0
}

const result = computeAssembly(votesByConstituency, {
  totalSeats: 349,
  firstDivisor: 1.2,
  nationalThreshold: 0.04,
  constituencyThreshold: 0.12,
  fixedSeatsByConstituency,
})
console.log('levelingByParty:', JSON.stringify(result.levelingByParty))
const sumLeveling = Object.values(result.levelingByParty).reduce((a, b) => a + b, 0)

const placed = placeLevelingSeats(votesByConstituency, result.fixedByConstituencyParty, result.levelingByParty)
const sumPlaced = Object.values(placed).reduce((a, vk) => a + Object.values(vk).reduce((x, y) => x + y, 0), 0)

let ok = true
const check = (label: string, got: unknown, exp: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(exp)
  if (!pass) ok = false
  console.log(`${pass ? 'OK ' : 'FEL'} ${label}: ${got}${pass ? '' : ` (facit ${exp})`}`)
}

console.log('\n--- Stage 1: utjämning summerar korrekt ---')
check('summa utjämningsmandat (result.levelingByParty)', sumLeveling, 39)
check('summa placerade utjämningsmandat (placeLevelingSeats)', sumPlaced, 39)

console.log('\n--- Stage 2: PER VALKRETS PER PARTI mot Valmyndighetens facit (diskriminerande) ---')
let checked = 0
let mismatches = 0
const bad: string[] = []
for (const [code, facitByP] of Object.entries(facitByCode)) {
  for (const [parti, facitTotal] of Object.entries(facitByP)) {
    if (!result.qualified.includes(parti)) continue
    checked++
    const ours = (result.fixedByConstituencyParty[code]?.[parti] ?? 0) + (placed[code]?.[parti] ?? 0)
    if (ours !== facitTotal) { mismatches++; bad.push(`${vkName[code]}/${parti}: ${ours} (facit ${facitTotal})`) }
  }
}
check('kontrollerade (valkrets,parti)-par', checked, 232)
check('avvikelser', mismatches, 0)
if (bad.length) console.log('   ' + bad.join('\n   '))

console.log(ok ? '\n✅ MATCHAR FACIT EXAKT — fasta+placerad utjämning == Valmyndighetens 2022-mandat per valkrets' : '\n❌ se FEL ovan')
process.exit(ok ? 0 : 1)
