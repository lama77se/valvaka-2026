// Genererar src/lib/seatConfig2026.ts ur fasta-valkretsmandat-2026.xlsx.
// Mandatberäkningen i tabellen använder den VERIFIERADE proportionella metoden per
// församling (RD nationellt 349, RF per region, KF per kommun) — behöver därför bara
// platsantal + spärr per område, nycklat på klientens områdeskoder (län 2-siffrigt,
// kommun 4-siffrigt). Inga fasta valkretsmandat/namn-mappningar behövs.
//
//   node scripts/build-seat-config.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'

const t = (v) => String(v ?? '').trim()
const wb = XLSX.readFile('data/raw/mandat2022/fasta-valkretsmandat-2026.xlsx')
const sheet = wb.Sheets['Antal fasta valkretsmandat']
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })

// RF: platsantal per region (län-kod, 2-siffrig). Dedupe — Totalt upprepas per valkrets.
const RF = {}
// KF: platsantal + spärr per kommun (4-siffrig kod). Spärr 3 % om kommunen är
// indelad i valkretsar (>1 rad), annars 2 %.
const kfSeats = {}
const kfRows = {}
for (const r of rows) {
  const vt = t(r[0])
  if (vt === 'Val till Regionfullmäktige') {
    const lan = t(r[1]).padStart(2, '0')
    RF[lan] = Number(t(r[10])) || 0
  } else if (vt === 'Val till Kommunfullmäktige') {
    const kommun = t(r[2]).padStart(4, '0')
    kfSeats[kommun] = Number(t(r[10])) || 0
    kfRows[kommun] = (kfRows[kommun] ?? 0) + 1
  }
}
const KF = {}
for (const [kommun, seats] of Object.entries(kfSeats)) {
  KF[kommun] = { seats, threshold: kfRows[kommun] > 1 ? 0.03 : 0.02 }
}

const body = `// AUTO-GENERERAD av scripts/build-seat-config.mjs — REDIGERA INTE för hand.
// Källa: fasta-valkretsmandat-2026.xlsx (Valmyndighetens beslut om platsantal 2026).
// Nycklar = klientens områdeskoder: RF på länskod (2 siffror), KF på kommunkod (4).
export interface KommunSeat { seats: number; threshold: number }
export const SEAT_CONFIG_2026 = {
  RD: { totalSeats: 349, threshold: 0.04 },
  RF: ${JSON.stringify(RF)} as Record<string, number>,
  KF: ${JSON.stringify(KF)} as Record<string, KommunSeat>,
} as const
`
writeFileSync('src/lib/seatConfig2026.ts', body)
console.log(`[seat-config] RF: ${Object.keys(RF).length} regioner, KF: ${Object.keys(KF).length} kommuner (${Object.values(KF).filter((k) => k.threshold === 0.03).length} delade)`)
console.log('Stickprov — RF Stockholm(01):', RF['01'], '| KF Upplands Väsby(0114):', KF['0114'], '| KF Stockholm(0180):', KF['0180'])
readFileSync('src/lib/seatConfig2026.ts') // sanity
