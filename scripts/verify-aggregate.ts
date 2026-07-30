// Validerar område-aggregatet + radmodellen (src/lib/aggregate.ts) mot 2022:
//   1. Nationellt RD-aggregat → giltiga totalsumma + andelar + spärr-set mot facit.
//   2. Övriga-kollaps (1 %-regeln) grupperar rätt.
//   3. districtsInArea (vd-prefix + valkrets) väljer rätt distrikt (syntetiskt).
//   npx tsx scripts/verify-aggregate.ts
import { readFileSync } from 'node:fs'
import XLSX from 'xlsx'
import { applyComparison, buildRows, collapseForDisplay, districtsInArea, proportionalSeats, type Comparison2022, type DistrictMeta, type PartyMeta } from '../src/lib/aggregate.ts'
import { seatPositions, hareSeats } from '../src/lib/soffa.ts'
import { ancestorsOf, childGroupsOf, childLevelOf } from '../src/lib/hierarchy.ts'
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
check(districtsInArea(codes, 'distrikt', '0180C001', 'RD', meta).length === 1, 'distrikt = exakt det ena')
check(districtsInArea(codes, 'distrikt', '9999X999', 'RD', meta).length === 0, 'okänt distrikt = 0')
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

// 6) ±2022-referens (public/comparison-2022.json) sanity + join-logik.
console.log('\n--- 6. comparison-2022 (±2022) ---')
try {
  const cmp = JSON.parse(readFileSync('public/comparison-2022.json', 'utf8'))
  const S = 'Arbetarepartiet-Socialdemokraterna'
  check(Math.abs(cmp.RD.andel[S] - 0.303) < 0.002, 'RD S-andel 2022 ≈ 30,3 %', `${(cmp.RD.andel[S] * 100).toFixed(1)} %`)
  check(cmp.RD.mandat[S] === 107, 'RD S-mandat 2022 = 107')
  check(Object.keys(cmp.RF).length === 20 && cmp.RF['01'].mandat[S] === 50, 'RF 20 regioner, Stockholm(01) S = 50 mandat')
  check(Object.keys(cmp.KF).length === 290 && cmp.KF['0180'].mandat[S] > 0, 'KF 290 kommuner, Stockholm(0180) S-mandat finns')
  // RD geografisk nedbrytning (andel per län/kommun för drilldown-jämförelse).
  const rdLan = Object.keys(cmp.RD_byLan ?? {}).length
  const rdKommun = Object.keys(cmp.RD_byKommun ?? {}).length
  check(rdLan >= 20 && rdKommun >= 290, 'RD-andel per län + kommun finns', `${rdLan} län / ${rdKommun} kommuner`)
  const sthlmRD = cmp.RD_byKommun?.['0180']?.andel[S]
  check(sthlmRD > 0 && sthlmRD < 1 && Math.abs(sthlmRD - cmp.RD.andel[S]) > 0.001, 'RD 0180 S-andel 2022 är kommun-specifik (≠ riks)', `${(sthlmRD * 100).toFixed(1)} %`)
  const rfKommun = Object.keys(cmp.RF_byKommun ?? {}).length
  check(rfKommun >= 280, 'RF-andel per kommun finns (drilldown RF→kommun)', `${rfKommun} kommuner`)
  const sthlmRF = cmp.RF_byKommun?.['0180']?.andel[S]
  check(sthlmRF > 0 && sthlmRF < 1, 'RF 0180 S-andel 2022 finns', `${(sthlmRF * 100).toFixed(1)} %`)
  // join: aktuell andel 32 % mot 2022 30,3 % → +1,7 %-enh
  const deltaA = (0.32 - cmp.RD.andel[S]) * 100
  check(Math.abs(deltaA - 1.7) < 0.2, 'delta-räkning: 32 % nu − 30,3 % 2022 ≈ +1,7 %-enh', `${deltaA.toFixed(1)}`)
} catch {
  check(false, 'public/comparison-2022.json läsbar (kör npm run comparison)')
}

// 7) 2022-basläge (applyComparison): union-sådd när 2026 saknas + live-spärr.
console.log('\n--- 7. 2022-basläge (applyComparison) ---')
try {
  const cmp = JSON.parse(readFileSync('public/comparison-2022.json', 'utf8')) as Comparison2022
  const S = 'Arbetarepartiet-Socialdemokraterna'
  // 7a: tomt 2026 (giltiga 0) i KF Stockholm → rader sås in ur 2022-facit.
  const empty = applyComparison(buildRows({}, emptyParty, 0.02), 'KF', 'kommun', '0180', cmp, emptyParty)
  check(empty.rows.length >= 1, 'KF 0180 utan 2026: partirader sådda ur 2022', `${empty.rows.length} rader`)
  check(empty.rows.every((r) => r.andel2022 != null), 'alla insådda rader har 2022-andel')
  check(empty.totalMandat2022 === 101, 'totalMandat2022 = 101 (Stockholms fullmäktige 2022)', String(empty.totalMandat2022))
  // 7b: spärr-linjen följer LIVE-året — S med 0,1 % 2026 hamnar under spärren
  //     trots stor 2022-andel (annars läser man in fjolårets styrkeförhållande).
  const party = new Map<string, PartyMeta>([['P1', { forkortning: 'S', farg: null, beteckning: S }]])
  const live = applyComparison(buildRows({ P1: 1, P2: 1000 }, party, 0.02), 'KF', 'kommun', '0180', cmp, party)
  const sRow = live.rows.find((r) => r.partikod === 'P1')!
  check(sRow.andel2022 != null && sRow.andel2022 > 0.02, 'S hade stor 2022-andel i 0180 (>2 %)', `${((sRow.andel2022 ?? 0) * 100).toFixed(1)} %`)
  check(sRow.overSparr === false, 'live-spärr: S under 2 % i 2026 → under spärren trots 2022-andel')
  // 7c: RD-drilldown jämförbar mot 2022 — andel wirad på län + kommun, mandat "–".
  const rdK = applyComparison(buildRows({}, emptyParty, 0.04), 'RD', 'kommun', '0180', cmp, emptyParty)
  check(rdK.rows.length >= 1 && rdK.rows.every((r) => r.andel2022 != null), 'RD kommun 0180: 2022-andel wirad (ej "–")', `${rdK.rows.length} rader`)
  check(rdK.rows.every((r) => r.mandat2022 == null), 'RD kommun 0180: 2022-mandat = "–" (riksmandat bara nationellt)')
  const rdL = applyComparison(buildRows({}, emptyParty, 0.04), 'RD', 'region', '01', cmp, emptyParty)
  check(rdL.rows.length >= 1 && rdL.rows.every((r) => r.andel2022 != null), 'RD län 01: 2022-andel wirad')
  // 7d: RF drillat till kommun jämförbart mot 2022 (andel; regionmandat per region → "–").
  const rfK = applyComparison(buildRows({}, emptyParty, 0.03), 'RF', 'kommun', '0180', cmp, emptyParty)
  check(rfK.rows.length >= 1 && rfK.rows.every((r) => r.andel2022 != null), 'RF kommun 0180: 2022-andel wirad (ej "–")', `${rfK.rows.length} rader`)
  check(rfK.rows.every((r) => r.mandat2022 == null), 'RF kommun 0180: 2022-mandat = "–" (regionmandat per region)')
  // 7e: distriktsnivå — 2022-lövet skickas in explicit (i appen DB-hämtat per klick).
  const dLeaf = { andel: { [S]: 0.3, Moderaterna: 0.2 }, mandat: {} }
  const dArea = applyComparison(buildRows({}, emptyParty, 0.04), 'RD', 'distrikt', '10820101', null, emptyParty, dLeaf)
  check(dArea.rows.length === 2 && dArea.rows.every((r) => r.andel2022 != null), 'distrikt: 2022-andel sås in ur inskickat löv', `${dArea.rows.length} rader`)
  check(dArea.rows.every((r) => r.mandat2022 == null) && dArea.totalMandat2022 == null, 'distrikt: 2022-mandat "–" (inget organ per distrikt)')
  const dNull = applyComparison(buildRows({}, emptyParty, 0.04), 'RD', 'distrikt', 'X', null, emptyParty, null)
  check(dNull.rows.length === 0, 'distrikt utan 2022 (NEJ/null löv) → inga insådda rader')
} catch (e) {
  check(false, `2022-basläge-test kastade (${(e as Error).message})`)
}

// 8) Riksdagssoffan (parliament-arc): exakt `total` platser, alla inom halvcirkeln.
console.log('\n--- 8. Riksdagssoffa (seatPositions) ---')
let soffaOk = true
for (const n of [349, 149, 101, 61, 21, 3, 2, 1]) {
  const pos = seatPositions(n)
  const okN = pos.length === n && pos.every((p) => p.y >= -1e-9 && p.x >= -1.0001 && p.x <= 1.0001)
  if (!okN) soffaOk = false
}
check(soffaOk, 'seatPositions ger exakt N platser i övre halvcirkeln (349/149/101/61/21/3/2/1)')

// 9) Ungefärlig procent-soffa (hareSeats): fördelar exakt `total` platser, ren proportion.
console.log('\n--- 9. Ungefärlig procent-soffa (hareSeats) ---')
let hareOk = true
for (const w of [{ A: 303, B: 205, C: 190, D: 100, E: 30, F: 5 }, { A: 50, B: 50 }, { A: 1, B: 1, C: 1 }]) {
  const alloc = hareSeats(w, 100)
  const sum = Object.values(alloc).reduce((a, b) => a + b, 0)
  if (sum !== 100) hareOk = false
}
const single = hareSeats({ X: 42 }, 100) // ett parti tar alla platser
const empty = Object.keys(hareSeats({}, 100)).length // inga röster → tom (ingen soffa)
check(hareOk && single.X === 100 && empty === 0, 'hareSeats fördelar exakt 100 platser proportionellt (ren %, ingen spärr)')

// 10) Drill-down-hierarki (ancestorsOf/childGroupsOf): prefix-slicing ur faktisk data.
console.log('\n--- 10. Drill-down-hierarki (hierarchy.ts) ---')
const hcodes = ['01800142', '01800256', '01140099', '12800011'] // län 01,01,01,12 · kommun 0180,0180,0114,1280
const anc = ancestorsOf('RD', { level: 'distrikt', code: '01800142' })
const lan = childGroupsOf('RD', { level: 'riket', code: null }, hcodes) // → 2 län (01, 12)
const komm = childGroupsOf('RF', { level: 'region', code: '01' }, hcodes) // → 2 kommuner i län 01
const hOk =
  anc.length === 4 &&
  anc[0].level === 'riket' && anc[0].code === null &&
  anc[1].code === '01' && anc[2].code === '0180' && anc[3].code === '01800142' &&
  lan.length === 2 && lan.every((g) => g.level === 'region') &&
  komm.length === 2 && komm.every((g) => g.code.startsWith('01') && g.level === 'kommun') &&
  // kommun 0180 → 2 distriktsbarn, vart och ett med exakt 1 distrikt (lövnivå)
  childGroupsOf('RD', { level: 'kommun', code: '0180' }, hcodes).length === 2 &&
  childGroupsOf('RD', { level: 'kommun', code: '0180' }, hcodes).every((g) => g.level === 'distrikt' && g.districts.length === 1) &&
  childLevelOf('KF', 'kommun') === 'distrikt' && childLevelOf('KF', 'distrikt') === null
check(hOk, 'hierarchy: ancestorsOf ger 4-nivåpath + childGroupsOf enumererar barn ur data (län/kommun-prefix)')

console.log(ok ? '\n✅ AGGREGAT + MANDAT + ±2022 MATCHAR FACIT / FÖRVÄNTAT' : '\n❌ se FEL ovan')
process.exit(ok ? 0 : 1)
