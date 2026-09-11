// Genererar src/lib/seatConfig2026.ts ur fasta-valkretsmandat-2026.xlsx.
// Mandatberäkningen i tabellen använder den VERIFIERADE proportionella metoden per
// församling (RD nationellt 349, RF per region, KF per kommun) — behöver därför bara
// platsantal + spärr per område, nycklat på klientens områdeskoder (län 2-siffrigt,
// kommun 4-siffrigt).
//
// RD.valkrets / RF_VALKRETS / KF_VALKRETS (tillagda 11 sep, se ResultPanel.tsx
// computeFixedValkretsMandate): de FASTA valkretsmandaten styckade per valkrets —
// används ENDAST för en preliminär "minst"-fördelning på valkretsnivå, INTE för
// riks-/region-/kommunnivåns egen mandattotal (de är oförändrade — för RF/KF nivelleras
// utjämningen dessutom FULLT ändå, se aggregate.ts computeMandate, så totalen där är
// redan korrekt). RF/KF är bara delade i VISSA (11 av 20 regioner, 17 av 290 kommuner)
// — övriga saknar en egen valkrets-nivå i UI:t (hierarchy.ts hoppar över den) och får
// ingen post här.
//
// Namn→kod slås upp mot public/valdistrikt-2026-wgs84.geojson — SAMMA 2026-fil som
// scripts/ingest-reference.mjs läser vk_rd/vk_rf/vk_kf ur (properties Riksdagsvalkrets/
// -kod, Regionvalkrets/-kod, Kommunvalkrets/-kod) — INTE 2022 års comparison-data, som
// gav falska missar: 3 av 17 delade KF-kommuner (Täby, Trelleborg, Borås) har fått sina
// valkretsnamn omformulerade sen 2022 (dubbla mellanslag, tillagd riktning, siffer-
// ordning) trots oförändrad indelning. Mot den FAKTISKA 2026-källan matchar alla tre
// valtyper 100 % (RD 29/29, RF 53/53, KF 41/41 delade rader) — verifierat 11 sep.
//
//   node scripts/build-seat-config.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import XLSX from 'xlsx'

const t = (v) => String(v ?? '').trim()
const wb = XLSX.readFile('data/raw/mandat2022/fasta-valkretsmandat-2026.xlsx')
const sheet = wb.Sheets['Antal fasta valkretsmandat']
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })

const districts2026 = JSON.parse(readFileSync('public/valdistrikt-2026-wgs84.geojson', 'utf8')).features
const rdNameToCode = new Map(districts2026.map((f) => [f.properties.Riksdagsvalkrets, f.properties.Riksdagsvalkretskod]))
const rfNameToCode = new Map(districts2026.map((f) => [f.properties.Regionvalkrets, f.properties.Regionvalkretskod]))
const kfNameToCode = new Map(districts2026.map((f) => [f.properties.Kommunvalkrets, f.properties.Kommunvalkretskod]))

const rdValkretsSeats = {}
for (const r of rows) {
  if (t(r[0]) !== 'Val till Riksdagen') continue
  const name = t(r[4])
  const code = rdNameToCode.get(name)
  if (!code) throw new Error(`[seat-config] RD-valkrets "${name}" saknar matchande kod i valdistrikt-2026-geojson`)
  rdValkretsSeats[code] = Number(t(r[9])) || 0
}
const rdFixedTotal = Object.values(rdValkretsSeats).reduce((a, b) => a + b, 0)
if (Object.keys(rdValkretsSeats).length !== 29) throw new Error(`[seat-config] Förväntade 29 RD-valkretsar, fick ${Object.keys(rdValkretsSeats).length}`)
if (rdFixedTotal !== 310) throw new Error(`[seat-config] Förväntade 310 fasta RD-mandat totalt, fick ${rdFixedTotal}`)

// RF: bara de valkretsar som hör till en DELAD region (>1 valkrets-rad i xlsx:en) —
// odelade regioners enda "valkrets" saknar egen rad/namn i fasta-filen och (per
// hierarchy.ts) en egen nivå i UI:t, så den hoppas medvetet över här.
const rfRowsByLan = new Map()
for (const r of rows) {
  if (t(r[0]) !== 'Val till Regionfullmäktige') continue
  const lan = t(r[1]).padStart(2, '0')
  ;(rfRowsByLan.get(lan) ?? rfRowsByLan.set(lan, []).get(lan)).push(r)
}
const rfValkretsSeats = {}
for (const [, rs] of rfRowsByLan) {
  if (rs.length <= 1) continue
  for (const r of rs) {
    const name = t(r[4])
    const code = rfNameToCode.get(name)
    if (!code) throw new Error(`[seat-config] RF-valkrets "${name}" saknar matchande kod i valdistrikt-2026-geojson`)
    rfValkretsSeats[code] = Number(t(r[9])) || 0
  }
}
const rfDividedRegions = [...rfRowsByLan.values()].filter((rs) => rs.length > 1).length
if (rfDividedRegions !== 11) throw new Error(`[seat-config] Förväntade 11 delade RF-regioner, fick ${rfDividedRegions}`)
const rfFixedTotal = Object.values(rfValkretsSeats).reduce((a, b) => a + b, 0)
if (rfFixedTotal !== 960) throw new Error(`[seat-config] Förväntade 960 fasta RF-mandat i delade regioner, fick ${rfFixedTotal}`)

// KF: samma mönster, nycklat på kommunkod (6-siffrig KF-valkretskod).
const kfRowsByKommun = new Map()
for (const r of rows) {
  if (t(r[0]) !== 'Val till Kommunfullmäktige') continue
  const kommun = t(r[2]).padStart(4, '0')
  ;(kfRowsByKommun.get(kommun) ?? kfRowsByKommun.set(kommun, []).get(kommun)).push(r)
}
const kfValkretsSeats = {}
for (const [, rs] of kfRowsByKommun) {
  if (rs.length <= 1) continue
  for (const r of rs) {
    const name = t(r[4])
    const code = kfNameToCode.get(name)
    if (!code) throw new Error(`[seat-config] KF-valkrets "${name}" saknar matchande kod i valdistrikt-2026-geojson`)
    kfValkretsSeats[code] = Number(t(r[9])) || 0
  }
}
const kfDividedKommuner = [...kfRowsByKommun.values()].filter((rs) => rs.length > 1).length
if (kfDividedKommuner !== 17) throw new Error(`[seat-config] Förväntade 17 delade KF-kommuner, fick ${kfDividedKommuner}`)
const kfFixedTotal = Object.values(kfValkretsSeats).reduce((a, b) => a + b, 0)
if (kfFixedTotal !== 1016) throw new Error(`[seat-config] Förväntade 1016 fasta KF-mandat i delade kommuner, fick ${kfFixedTotal}`)

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
// Nycklar = klientens områdeskoder: RF på länskod (2 siffror), KF på kommunkod (4),
// RD.valkrets på RD-valkretskod (2 siffror). RF_VALKRETS/KF_VALKRETS: bara de 11 delade
// regionerna (4-siffrig valkretskod) resp. 17 delade kommunerna (6-siffrig) — övriga
// saknar egen valkrets-nivå i UI:t (hierarchy.ts) och får ingen post.
export interface KommunSeat { seats: number; threshold: number }
export const SEAT_CONFIG_2026 = {
  RD: { totalSeats: 349, threshold: 0.04, valkrets: ${JSON.stringify(rdValkretsSeats)} as Record<string, number> },
  RF: ${JSON.stringify(RF)} as Record<string, number>,
  RF_VALKRETS: ${JSON.stringify(rfValkretsSeats)} as Record<string, number>,
  KF: ${JSON.stringify(KF)} as Record<string, KommunSeat>,
  KF_VALKRETS: ${JSON.stringify(kfValkretsSeats)} as Record<string, number>,
} as const
`
writeFileSync('src/lib/seatConfig2026.ts', body)
console.log(`[seat-config] RF: ${Object.keys(RF).length} regioner (${rfDividedRegions} delade, ${Object.keys(rfValkretsSeats).length} valkretsar), KF: ${Object.keys(KF).length} kommuner (${kfDividedKommuner} delade, ${Object.keys(kfValkretsSeats).length} valkretsar), RD-valkretsar: ${Object.keys(rdValkretsSeats).length} (fasta mandat summa ${rdFixedTotal})`)
console.log('Stickprov — RF Stockholm(01):', RF['01'], '| KF Upplands Väsby(0114):', KF['0114'], '| KF Stockholm(0180):', KF['0180'], '| RD Norrbotten(29):', rdValkretsSeats['29'])
console.log('Stickprov valkrets — RF Karlshamnskretsen(1003):', rfValkretsSeats['1003'], '| KF Täby Västra(016001):', kfValkretsSeats['016001'])
readFileSync('src/lib/seatConfig2026.ts') // sanity
