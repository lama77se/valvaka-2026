// Validerar område-aggregatet + radmodellen (src/lib/aggregate.ts) mot 2022:
//   1. Nationellt RD-aggregat → giltiga totalsumma + andelar + spärr-set mot facit.
//   2. Övriga-kollaps (1 %-regeln) grupperar rätt.
//   3. districtsInArea (vd-prefix + valkrets) väljer rätt distrikt (syntetiskt).
//   npx tsx scripts/verify-aggregate.ts
import XLSX from 'xlsx'
import { buildRows, collapseForDisplay, districtsInArea, proportionalSeats, type DistrictMeta, type PartyMeta } from '../src/lib/aggregate.ts'
import { SEAT_CONFIG_2026 } from '../src/lib/seatConfig2026.ts'

const t = (v: unknown) => String(v ?? '').trim()
const INVALID = new Set(['Valdeltagande', 'Summa giltiga röster', 'ej anmält deltagande', 'blanka röster', 'övriga ogiltiga', 'Röstberättigade'])
const RIKSDAG8 = new Set([
  'Arbetarepartiet-Socialdemokraterna', 'Sverigedemokraterna', 'Moderaterna', 'Centerpartiet',
  'Vänsterpartiet', 'Kristdemokraterna', 'Miljöpartiet de gröna', 'Liberalerna (tidigare Folkpartiet)',
])
const emptyParty = new Map<string, PartyMeta>()

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

// 1) Nationellt RD-aggregat ur rostern.
const wb = XLSX.readFile('data/raw/mandat2022/roster-rd-2022.xlsx')
const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['roster_RD'], { header: 1, raw: false, defval: '' }).slice(1)
const national: Record<string, number> = {}
for (const r of rows) {
  const parti = t(r[9]); const v = Number(t(r[10])) || 0
  if (!parti || INVALID.has(parti)) continue
  national[parti] = (national[parti] ?? 0) + v
}
const area = buildRows(national, emptyParty, 0.04)

console.log('--- 1. Nationellt RD-aggregat ---')
check(area.giltiga === 6477970, 'giltiga röster = 6 477 970', String(area.giltiga))
check(Math.abs(area.rows.reduce((a, r) => a + r.andel, 0) - 1) < 1e-9, 'andelar summerar till 1')
check(area.rows[0].partikod === 'Arbetarepartiet-Socialdemokraterna', 'största parti = S', area.rows[0].partikod)
check(area.rows.every((r, i) => i === 0 || area.rows[i - 1].roster >= r.roster), 'sorterad på röster fallande')
const over = new Set(area.rows.filter((r) => r.overSparr).map((r) => r.partikod))
check(over.size === 8 && [...RIKSDAG8].every((p) => over.has(p)), 'exakt de 8 riksdagspartierna över 4 %-spärren', `${over.size} st`)
const sShare = area.rows.find((r) => r.partikod === 'Arbetarepartiet-Socialdemokraterna')!.andel
check(Math.abs(sShare - 0.303) < 0.002, 'S-andel ≈ 30,3 %', `${(sShare * 100).toFixed(1)} %`)

// 2) Övriga-kollaps.
console.log('\n--- 2. Övriga-kollaps (1 %) ---')
const disp = collapseForDisplay(area)
check(disp.shown.every((r) => r.andel >= 0.01), 'alla visade rader ≥ 1 %')
check(disp.ovriga != null && disp.ovriga.count > 0, 'Övriga-rad finns', `${disp.ovriga?.count} partier`)
const recomposed = disp.shown.reduce((a, r) => a + r.roster, 0) + (disp.ovriga?.roster ?? 0)
check(recomposed === area.giltiga, 'visade + Övriga = giltiga (inget tappas)')
check(disp.sparrIndex === 8, 'spärr-linjen ligger efter de 8 riksdagspartierna', `index ${disp.sparrIndex}`)

// 3) districtsInArea (syntetiskt, 8-siffriga koder + valkrets-metadata).
console.log('\n--- 3. districtsInArea ---')
const codes = ['0180C001', '0180C002', '0114C001', '1280C001', '1280C099']
const meta = new Map<string, DistrictMeta>([
  ['0180C001', { vk_rd: '01', vk_rf: 'A', vk_kf: 'X' }],
  ['0180C002', { vk_rd: '01', vk_rf: 'A', vk_kf: 'Y' }],
  ['0114C001', { vk_rd: '02', vk_rf: 'B', vk_kf: 'Z' }],
  ['1280C001', { vk_rd: '12', vk_rf: 'C', vk_kf: 'M' }],
  ['1280C099', { vk_rd: '12', vk_rf: 'C', vk_kf: 'M' }],
])
check(districtsInArea(codes, 'riket', null, 'RD', meta).length === 5, 'riket = alla 5')
check(districtsInArea(codes, 'region', '01', 'RD', meta).length === 3, 'region/län 01 = 3 distrikt (kommun 80 + 14)')
check(districtsInArea(codes, 'region', '12', 'RD', meta).length === 2, 'region/län 12 = 2 distrikt')
check(districtsInArea(codes, 'kommun', '1280', 'RD', meta).length === 2, 'kommun 1280 (Malmö) = 2 distrikt')
check(districtsInArea(codes, 'valkrets', '01', 'RD', meta).length === 2, 'RD-valkrets 01 = 2 distrikt')
check(districtsInArea(codes, 'valkrets', 'M', 'KF', meta).length === 2, 'KF-valkrets M = 2 distrikt')

// 4) Mandat-wiring: RD nationell proportionell fördelning == 349-facit (2022).
console.log('\n--- 4. Mandat-wiring (RD proportionell) ---')
const FACIT: Record<string, number> = {
  'Arbetarepartiet-Socialdemokraterna': 107, Sverigedemokraterna: 73, Moderaterna: 68, Centerpartiet: 24,
  Vänsterpartiet: 24, Kristdemokraterna: 19, 'Miljöpartiet de gröna': 18, 'Liberalerna (tidigare Folkpartiet)': 16,
}
const seats = proportionalSeats(national, 349, 0.04)
let mandOk = true
for (const [p, exp] of Object.entries(FACIT)) if ((seats[p] ?? 0) !== exp) mandOk = false
check(mandOk, 'RD-proportionell 349 = facit (S 107, SD 73, M 68, …)')
check(Object.values(seats).reduce((a, b) => a + b, 0) === 349, 'summa mandat = 349')

// 5) Seat-config 2026 sanity.
console.log('\n--- 5. seatConfig2026 ---')
check(SEAT_CONFIG_2026.RD.totalSeats === 349, 'RD 349 platser')
check(Object.keys(SEAT_CONFIG_2026.RF).length === 20, 'RF 20 regioner', `${Object.keys(SEAT_CONFIG_2026.RF).length}`)
check(SEAT_CONFIG_2026.RF['01'] === 149, 'RF Stockholm (01) = 149', `${SEAT_CONFIG_2026.RF['01']}`)
check(Object.keys(SEAT_CONFIG_2026.KF).length === 290, 'KF 290 kommuner')
check(SEAT_CONFIG_2026.KF['0180']?.seats === 101 && SEAT_CONFIG_2026.KF['0180']?.threshold === 0.03, 'KF Stockholm (0180) = 101 platser, 3 %-spärr (delad)')
check(SEAT_CONFIG_2026.KF['0114']?.threshold === 0.02, 'KF Upplands Väsby (0114) 2 %-spärr (odelad)')

console.log(ok ? '\n✅ AGGREGAT + MANDAT-WIRING MATCHAR FACIT / FÖRVÄNTAT' : '\n❌ se FEL ovan')
process.exit(ok ? 0 : 1)
