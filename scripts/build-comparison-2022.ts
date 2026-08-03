// Genererar public/comparison-2022.json — 2022 års andel + mandat per parti för
// LÖV-församlingarna (RD riket, RF per region, KF per kommun), nycklat på
// områdeskod (län 2 / kommun 4 siffror) + partinamn (beteckning). Klienten joinar
// 1:1 på (områdeskod, beteckning) för ±2022 i tabellen.
//
// Mandat = proportionalSeats (verifierad metod) på 2022 röster + 2022 platsantal
// (fasta-2022). Not: Tyresö ändrade storlek 51→61 efter fasta-filen, och Vårgårda
// avgjordes av lottning — ±mandat kan vara ±1 för dessa (dokumenterat).
//
//   npx tsx scripts/build-comparison-2022.ts
import { writeFileSync } from 'node:fs'
import XLSX from 'xlsx'
import { modifiedSainteLague, type PartyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const t = (v: unknown) => String(v ?? '').trim()
const INVALID = new Set(['Valdeltagande', 'Summa giltiga röster', 'ej anmält deltagande', 'blanka röster', 'övriga ogiltiga', 'Röstberättigade'])

function proportionalSeats(votes: PartyVotes, seats: number, threshold: number): Record<string, number> {
  const total = Object.values(votes).reduce((a, b) => a + b, 0)
  if (total === 0 || seats === 0) return {}
  const qual = Object.fromEntries(Object.entries(votes).filter(([, v]) => v / total >= threshold))
  return modifiedSainteLague(qual, seats, 1.2)
}

// Röster per (områdeskod → parti) ur en roster, med områdeskod = vd-prefix.
function loadVotes(valtyp: 'RD' | 'RF' | 'KF', prefixLen: number): Map<string, PartyVotes> {
  const wb = XLSX.readFile(`${DIR}/roster-${valtyp.toLowerCase()}-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[`roster_${valtyp}`], { header: 1, raw: false, defval: '' }).slice(1)
  const byArea = new Map<string, PartyVotes>()
  for (const r of rows) {
    const vd = t(r[5])
    const parti = t(r[9])
    const roster = Number(t(r[10])) || 0
    if (!vd || !parti || INVALID.has(parti)) continue
    const code = prefixLen === 0 ? 'riket' : vd.slice(0, prefixLen)
    const pv = byArea.get(code) ?? byArea.set(code, {}).get(code)!
    pv[parti] = (pv[parti] ?? 0) + roster
  }
  return byArea
}

// 2022 platsantal + spärr per område ur fasta-2022 (Flik 1).
function loadSeats2022() {
  const wb = XLSX.readFile(`${DIR}/fasta-valkretsmandat-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })
  const RF: Record<string, number> = {}
  const kfSeats: Record<string, number> = {}
  const kfRows: Record<string, number> = {}
  for (const r of rows) {
    const vt = t(r[0])
    if (vt === 'Val till Regionfullmäktige') RF[t(r[1]).padStart(2, '0')] = Number(t(r[10])) || 0
    else if (vt === 'Val till Kommunfullmäktige') {
      const k = t(r[2]).padStart(4, '0')
      kfSeats[k] = Number(t(r[10])) || 0
      kfRows[k] = (kfRows[k] ?? 0) + 1
    }
  }
  return { RF, kfSeats, kfRows }
}

const round = (n: number) => Math.round(n * 100000) / 100000
function areaEntry(votes: PartyVotes, seats: number, threshold: number) {
  const total = Object.values(votes).reduce((a, b) => a + b, 0)
  const andel: Record<string, number> = {}
  for (const [p, v] of Object.entries(votes)) if (v > 0) andel[p] = round(v / total)
  return { andel, mandat: proportionalSeats(votes, seats, threshold) }
}

const { RF: rfSeats, kfSeats, kfRows } = loadSeats2022()

// RD — riket (ett organ, 349, 4 %).
const rdVotes = loadVotes('RD', 0).get('riket')!
const RD = areaEntry(rdVotes, 349, 0.04)

// RD — geografisk nedbrytning: andel per län + per kommun (gör drilldown RD→län/
// kommun jämförbar mot 2022). Riksdagsmandat finns BARA nationellt, så mandat
// lämnas tomt här → "–" i tabellen; bara röstandelen är meningsfull per område.
const andelOnly = (votes: PartyVotes) => {
  const total = Object.values(votes).reduce((a, b) => a + b, 0)
  const andel: Record<string, number> = {}
  for (const [p, v] of Object.entries(votes)) if (v > 0) andel[p] = round(v / total)
  return { andel, mandat: {} as Record<string, number> }
}
const RD_byKommun: Record<string, ReturnType<typeof andelOnly>> = {}
for (const [code, votes] of loadVotes('RD', 4)) RD_byKommun[code] = andelOnly(votes)

// RD — per VALKRETS (riksdagens riktiga nivå under Riket). Röster + namn ur rostern
// (grupperat på vk-kod r[7], namn r[8]); mandat ur det officiella facit-bladet
// (rd-jamforande 'Valkrets': namn r[1], parti r[11], mandat r[12]). Valkretskoden
// PADDAS till 2 siffror så den matchar `district.vk_rd` (normaliseras likadant i
// klienten) — annars faller Stockholms två ensiffriga valkretsar (01/02) tyst bort.
function loadRdValkrets() {
  const wb = XLSX.readFile(`${DIR}/roster-rd-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['roster_RD'], { header: 1, raw: false, defval: '' }).slice(1)
  const votes = new Map<string, PartyVotes>()
  const namn = new Map<string, string>()
  const nameToCode = new Map<string, string>()
  for (const r of rows) {
    const vk = t(r[7]).padStart(2, '0')
    const parti = t(r[9])
    const roster = Number(t(r[10])) || 0
    if (!vk || vk === '00' || !parti || INVALID.has(parti)) continue
    namn.set(vk, t(r[8]))
    nameToCode.set(t(r[8]), vk)
    const pv = votes.get(vk) ?? votes.set(vk, {}).get(vk)!
    pv[parti] = (pv[parti] ?? 0) + roster
  }
  return { votes, namn, nameToCode }
}
function loadRdValkretsMandat(nameToCode: Map<string, string>, validParties: Set<string>) {
  const wb = XLSX.readFile(`${DIR}/rd-jamforande-2018-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Valkrets'], { header: 1, raw: false, defval: '' })
  const byCode = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const name = t(r[1])
    const parti = t(r[11])
    const mandat = Number(t(r[12])) || 0
    const code = name ? nameToCode.get(name) : undefined
    // Filtrera till RIKTIGA partier — bladet har även en "Summa"-rad som annars
    // dubblar valkretsens total (M1+S4+V1+SD2+Summa8 = 16 i st.f. 8).
    if (!code || !mandat || !validParties.has(parti)) continue
    const m = byCode.get(code) ?? byCode.set(code, {}).get(code)!
    m[parti] = mandat // tilldela (facit-bladet listar varje parti-rad två ggr → summera ej)
  }
  return byCode
}
const { votes: vkVotes, namn: vkNamn, nameToCode: vkNameToCode } = loadRdValkrets()
const vkMandat = loadRdValkretsMandat(vkNameToCode, new Set(Object.keys(RD.andel))) // riktiga partier ur riks-RD
const RD_byValkrets: Record<string, ReturnType<typeof areaEntry>> = {}
const RD_valkretsNamn: Record<string, string> = {}
for (const [code, votes] of vkVotes) {
  const total = Object.values(votes).reduce((a, b) => a + b, 0)
  const andel: Record<string, number> = {}
  for (const [p, v] of Object.entries(votes)) if (v > 0) andel[p] = round(v / total)
  RD_byValkrets[code] = { andel, mandat: vkMandat.get(code) ?? {} }
  RD_valkretsNamn[code] = vkNamn.get(code) ?? code
}

// RF — per region (län-kod), 3 %.
const RF: Record<string, ReturnType<typeof areaEntry>> = {}
for (const [code, votes] of loadVotes('RF', 2)) {
  if (!rfSeats[code]) continue // t.ex. Gotland saknar regionval
  RF[code] = areaEntry(votes, rfSeats[code], 0.03)
}

// RF — per VALKRETS (regionvalets nivå under regionen). Till skillnad mot RD är
// RF-valkretsen INTE hela kommuner — Stockholm delas i 12 valkretsar tvärs över
// kommungränser — så nästa nivå under regionen MÅSTE vara valkrets, inte kommun.
// Röster + namn ur rostern (vk-kod r[7], namn r[8]). Valkretskoden är län-prefixad
// och PADDAS till 4 siffror så den matchar `district.vk_rf` (normaliseras likadant
// i klienten). MANDAT lämnas tomt: regionfullmäktige är organet, inte valkretsen —
// precis som RD-mandat inte fördelas per kommun. → "–" i tabellen, ungefärlig
// procent-soffa i UI:t. Gotland (09) saknar RF och har tom vk_rf → faller bort.
function loadRfValkrets() {
  const wb = XLSX.readFile(`${DIR}/roster-rf-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['roster_RF'], { header: 1, raw: false, defval: '' }).slice(1)
  const votes = new Map<string, PartyVotes>()
  const namn = new Map<string, string>()
  for (const r of rows) {
    const raw = t(r[7])
    if (!raw) continue // tom valkretskod (Gotland) → ingen RF-valkrets
    const vk = raw.padStart(4, '0')
    const parti = t(r[9])
    const roster = Number(t(r[10])) || 0
    if (!parti || INVALID.has(parti)) continue
    namn.set(vk, t(r[8]))
    const pv = votes.get(vk) ?? votes.set(vk, {}).get(vk)!
    pv[parti] = (pv[parti] ?? 0) + roster
  }
  return { votes, namn }
}
const { votes: rfVkVotes, namn: rfVkNamn } = loadRfValkrets()
const RF_byValkrets: Record<string, ReturnType<typeof andelOnly>> = {}
const RF_valkretsNamn: Record<string, string> = {}
for (const [code, votes] of rfVkVotes) {
  RF_byValkrets[code] = andelOnly(votes) // mandat tomt — organet är regionen
  RF_valkretsNamn[code] = rfVkNamn.get(code) ?? code
}

// KF — per kommun (4-siffrig kod), 2/3 % efter delning.
const KF: Record<string, ReturnType<typeof areaEntry>> = {}
for (const [code, votes] of loadVotes('KF', 4)) {
  if (!kfSeats[code]) continue
  KF[code] = areaEntry(votes, kfSeats[code], kfRows[code] > 1 ? 0.03 : 0.02)
}

const out = { RD, RD_byValkrets, RD_valkretsNamn, RD_byKommun, RF, RF_byValkrets, RF_valkretsNamn, KF }
writeFileSync('public/comparison-2022.json', JSON.stringify(out))
const size = Math.round(JSON.stringify(out).length / 1024)
console.log(
  `[comparison] public/comparison-2022.json — RD (riket + ${Object.keys(RD_byValkrets).length} valkretsar + ${Object.keys(RD_byKommun).length} kommuner), RF (${Object.keys(RF).length} regioner + ${Object.keys(RF_byValkrets).length} valkretsar), KF ${Object.keys(KF).length} kommuner (~${size} kB)`,
)
console.log('Stickprov RD: S andel', RD.andel['Arbetarepartiet-Socialdemokraterna'], 'mandat', RD.mandat['Arbetarepartiet-Socialdemokraterna'])
console.log(
  'Stickprov valkrets: Norrbotten (29)', RD_valkretsNamn['29'], '→ S-mandat', RD_byValkrets['29']?.mandat['Arbetarepartiet-Socialdemokraterna'],
  '| Sthlm kommun (01)', RD_valkretsNamn['01'], '→ S-mandat', RD_byValkrets['01']?.mandat['Arbetarepartiet-Socialdemokraterna'],
)
console.log('Stickprov RF 01 (Sthlm): S mandat', RF['01']?.mandat['Arbetarepartiet-Socialdemokraterna'], '| KF 0180: S mandat', KF['0180']?.mandat['Arbetarepartiet-Socialdemokraterna'])
console.log(
  'Stickprov RF-valkrets:', Object.keys(RF_byValkrets).length, 'valkretsar |',
  '0112', RF_valkretsNamn['0112'], '→ S-andel', RF_byValkrets['0112']?.andel['Arbetarepartiet-Socialdemokraterna'],
  '| 2500', RF_valkretsNamn['2500'],
)
