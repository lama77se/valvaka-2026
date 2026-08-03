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
  // RD-nedbrytning: FAKTISKA 2022-mandat per VALKRETS (facit) + andel per kommun.
  const rdVk = Object.keys(cmp.RD_byValkrets ?? {}).length
  const rdKommun = Object.keys(cmp.RD_byKommun ?? {}).length
  check(rdVk === 29 && rdKommun >= 290, 'RD: 29 valkretsar + kommuner finns', `${rdVk} valkretsar / ${rdKommun} kommuner`)
  check(cmp.RD_byValkrets?.['29']?.mandat[S] === 4, 'RD valkrets Norrbotten(29): S-mandat 2022 = 4 (facit, = val.se)')
  const vkTotal = Object.values(cmp.RD_byValkrets ?? {}).reduce((a: number, o: any) => a + Object.values(o.mandat as Record<string, number>).reduce((x, y) => x + y, 0), 0)
  check(vkTotal === 349, 'RD valkretsmandat summerar till 349 (alla 29)', String(vkTotal))
  check(cmp.RD_valkretsNamn?.['29'] === 'Norrbottens län', 'RD valkretsnamn wirat (29 → Norrbottens län)')
  const sthlmRD = cmp.RD_byKommun?.['0180']?.andel[S]
  check(sthlmRD > 0 && sthlmRD < 1 && Math.abs(sthlmRD - cmp.RD.andel[S]) > 0.001, 'RD 0180 S-andel 2022 är kommun-specifik (≠ riks)', `${(sthlmRD * 100).toFixed(1)} %`)
  const rfVkN = Object.keys(cmp.RF_byValkrets ?? {}).length
  check(rfVkN === 62, 'RF-andel per valkrets finns (drilldown RF region→valkrets)', `${rfVkN} valkretsar`)
  const sthlmRF = cmp.RF_byValkrets?.['0112']?.andel[S]
  check(sthlmRF > 0 && sthlmRF < 1, 'RF valkrets 0112 (Nordväst) S-andel 2022 finns', `${(sthlmRF * 100).toFixed(1)} %`)
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
  // RD på VALKRETS: nu wiras BÅDE 2022-andel OCH faktiska 2022-mandat (facit).
  const rdVkA = applyComparison(buildRows({}, emptyParty, 0.04), 'RD', 'valkrets', '29', cmp, emptyParty)
  check(rdVkA.rows.length >= 1 && rdVkA.rows.every((r) => r.andel2022 != null), 'RD valkrets 29: 2022-andel wirad')
  check(rdVkA.totalMandat2022 === 8, 'RD valkrets Norrbotten(29): 2022-MANDAT wirat (totalt 8)', String(rdVkA.totalMandat2022))
  // 7d: RF drillat till VALKRETS jämförbart mot 2022 (andel; regionmandat per region → "–").
  const rfVk = applyComparison(buildRows({}, emptyParty, 0.03), 'RF', 'valkrets', '0112', cmp, emptyParty)
  check(rfVk.rows.length >= 1 && rfVk.rows.every((r) => r.andel2022 != null), 'RF valkrets 0112: 2022-andel wirad (ej "–")', `${rfVk.rows.length} rader`)
  check(rfVk.rows.every((r) => r.mandat2022 == null), 'RF valkrets 0112: 2022-mandat = "–" (regionmandat per region)')
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

// 10) Drill-down-hierarki: valkrets är metadata (index), inte prefix.
// RD: riket → valkrets → kommun → distrikt. Kritiskt (advisor): Stockholm-splitten —
// kommun 0180 och 0114 ligger i SAMMA län (01) men OLIKA valkretsar; prefix skulle slå ihop.
console.log('\n--- 10a. Drill-down-hierarki RD (hierarchy.ts) ---')
// Stockholm-split: kommun 0180 (valkrets 01) och 0114 (valkrets 02) i SAMMA län men
// olika valkretsar. Dessutom: valkrets 01 = EN kommun (Sthlm kommun) → kommun-nivån
// kollapsar till distrikt; valkrets 29 = FLERA kommuner (län) → kommun-nivån behålls.
const hcodes = ['01800142', '01800256', '01140099', '25600011', '25800011']
const hIndex = {
  districtToVk: new Map([['01800142', '01'], ['01800256', '01'], ['01140099', '02'], ['25600011', '29'], ['25800011', '29']]),
  kommunToVk: new Map([['0180', '01'], ['0114', '02'], ['2560', '29'], ['2580', '29']]),
  vkToDistricts: new Map([['01', ['01800142', '01800256']], ['02', ['01140099']], ['29', ['25600011', '25800011']]]),
}
const vks = childGroupsOf('RD', { level: 'riket', code: null }, hcodes, hIndex) // → valkretsar 01,02,29
const vk01 = childGroupsOf('RD', { level: 'valkrets', code: '01' }, hcodes, hIndex) // enkommun → DISTRIKT (kollapsad)
const vk29 = childGroupsOf('RD', { level: 'valkrets', code: '29' }, hcodes, hIndex) // läns-vk → KOMMUN (2560,2580)
const kdist = childGroupsOf('RD', { level: 'kommun', code: '2560' }, hcodes, hIndex) // → distrikt (prefix)
const ancDs = ancestorsOf('RD', { level: 'distrikt', code: '01800256' }, hIndex) // enkommuns-vk → kommun SLOPPAD
const ancDm = ancestorsOf('RD', { level: 'distrikt', code: '25600011' }, hIndex) // läns-vk → kommun KVAR
const ancK = ancestorsOf('RD', { level: 'kommun', code: '2560' }, hIndex) // → riket › valkrets 29 › kommun 2560
const hRdOk =
  vks.length === 3 && vks.every((g) => g.level === 'valkrets') &&
  vk01.length === 2 && vk01.every((g) => g.level === 'distrikt') && // enkommuns-valkrets → distrikt direkt
  vk29.length === 2 && vk29.every((g) => g.level === 'kommun') && vk29.map((g) => g.code).sort().join() === '2560,2580' &&
  kdist.length === 1 && kdist[0].level === 'distrikt' &&
  ancDs.length === 3 && ancDs[1].level === 'valkrets' && ancDs[1].code === '01' && ancDs[2].level === 'distrikt' && // kommun slopad
  ancDm.length === 4 && ancDm[1].code === '29' && ancDm[2].level === 'kommun' && ancDm[2].code === '2560' && ancDm[3].code === '25600011' &&
  ancK.length === 3 && ancK[1].level === 'valkrets' && ancK[1].code === '29' && ancK[2].code === '2560' &&
  childLevelOf('RD', 'riket') === 'valkrets' && childLevelOf('KF', 'kommun') === 'valkrets' && childLevelOf('KF', 'distrikt') === null
check(hRdOk, 'hierarchy RD: enkommuns-valkrets (Sthlm) kollapsar kommun→distrikt; läns-valkrets (Norrbotten) behåller kommun; breadcrumb följer')

// RF: region → VALKRETS → distrikt (kommun UTGÅR). (1) RF-valkretsen delar en kommun —
// Sthlm kommun 0180 ligger i FLERA valkretsar (0101, 0104). (2) GENERELL kollaps: en
// region med bara EN valkrets (Norrbotten/2500) hoppar över valkretsnivån → distrikt.
console.log('\n--- 10b. Drill-down-hierarki RF (region→valkrets→distrikt + en-vk-kollaps) ---')
const rfCodes = ['01800142', '01800256', '01140099', '25600011']
const rfIndex = {
  districtToVk: new Map([['01800142', '0101'], ['01800256', '0104'], ['01140099', '0112'], ['25600011', '2500']]),
  vkToDistricts: new Map([['0101', ['01800142']], ['0104', ['01800256']], ['0112', ['01140099']], ['2500', ['25600011']]]),
}
const rfVks = childGroupsOf('RF', { level: 'region', code: '01' }, rfCodes, rfIndex) // fler-vk → 0101,0104,0112
const rfSingle = childGroupsOf('RF', { level: 'region', code: '25' }, rfCodes, rfIndex) // en-vk-region → DISTRIKT
const rfVkDist = childGroupsOf('RF', { level: 'valkrets', code: '0101' }, rfCodes, rfIndex) // → distrikt 01800142
const rfAnc = ancestorsOf('RF', { level: 'distrikt', code: '01800256' }, rfIndex) // → region 01 › valkrets 0104 › distrikt
const rfAncSingle = ancestorsOf('RF', { level: 'distrikt', code: '25600011' }, rfIndex) // → region 25 › distrikt (vk slopad)
const splitVk = rfIndex.districtToVk.get('01800142') !== rfIndex.districtToVk.get('01800256') // samma kommun, olika vk
const hRfOk =
  rfVks.length === 3 && rfVks.every((g) => g.level === 'valkrets' && g.code.startsWith('01')) && // 2500 filtreras bort
  rfSingle.length === 1 && rfSingle[0].level === 'distrikt' && rfSingle[0].code === '25600011' && // en-vk-region kollapsad
  rfVkDist.length === 1 && rfVkDist[0].level === 'distrikt' && rfVkDist[0].code === '01800142' &&
  rfAnc.length === 3 && rfAnc[0].code === '01' && rfAnc[1].level === 'valkrets' && rfAnc[1].code === '0104' && rfAnc[2].code === '01800256' &&
  rfAncSingle.length === 2 && rfAncSingle[0].level === 'region' && rfAncSingle[0].code === '25' && rfAncSingle[1].level === 'distrikt' && // vk slopad
  splitVk &&
  childLevelOf('RF', 'region') === 'valkrets' && childLevelOf('RF', 'valkrets') === 'distrikt' && childLevelOf('RF', 'distrikt') === null
check(hRfOk, 'hierarchy RF: fler-vk-region→valkrets (Sthlm 0180 i två vk); en-vk-region (Norrbotten) kollapsar → distrikt')

// KF: kommun → VALKRETS → distrikt, MEN valkretsnivån syns bara där kommunen är indelad.
// Indelad (Stockholm 0180 → flera vk) visar valkretsar; oindelad (Olofström 1060, EN vk
// "…00") kollapsar → distrikt direkt (samma generella regel — "nästa finare indelning").
console.log('\n--- 10c. Drill-down-hierarki KF (indelad → valkrets, oindelad → distrikt) ---')
const kfCodes = ['01800142', '01800256', '10600011']
const kfIndex = {
  districtToVk: new Map([['01800142', '018001'], ['01800256', '018004'], ['10600011', '106000']]),
  vkToDistricts: new Map([['018001', ['01800142']], ['018004', ['01800256']], ['106000', ['10600011']]]),
}
const kfDivided = childGroupsOf('KF', { level: 'kommun', code: '0180' }, kfCodes, kfIndex) // indelad → 2 valkretsar
const kfSingle = childGroupsOf('KF', { level: 'kommun', code: '1060' }, kfCodes, kfIndex) // oindelad → DISTRIKT (kollaps)
const kfVkDist = childGroupsOf('KF', { level: 'valkrets', code: '018001' }, kfCodes, kfIndex) // → distrikt
const kfAncDiv = ancestorsOf('KF', { level: 'distrikt', code: '01800256' }, kfIndex) // → kommun › valkrets › distrikt
const kfAncSingle = ancestorsOf('KF', { level: 'distrikt', code: '10600011' }, kfIndex) // → kommun › distrikt (vk slopad)
const hKfOk =
  kfDivided.length === 2 && kfDivided.every((g) => g.level === 'valkrets' && g.code.startsWith('0180')) &&
  kfSingle.length === 1 && kfSingle[0].level === 'distrikt' && kfSingle[0].code === '10600011' && // oindelad kollapsad
  kfVkDist.length === 1 && kfVkDist[0].level === 'distrikt' && kfVkDist[0].code === '01800142' &&
  kfAncDiv.length === 3 && kfAncDiv[0].code === '0180' && kfAncDiv[1].level === 'valkrets' && kfAncDiv[1].code === '018004' && kfAncDiv[2].code === '01800256' &&
  kfAncSingle.length === 2 && kfAncSingle[0].level === 'kommun' && kfAncSingle[0].code === '1060' && kfAncSingle[1].level === 'distrikt' && // vk slopad
  childLevelOf('KF', 'kommun') === 'valkrets' && childLevelOf('KF', 'valkrets') === 'distrikt'
check(hKfOk, 'hierarchy KF: indelad kommun (Sthlm) → valkretsar; oindelad (Olofström) kollapsar → distrikt; breadcrumb följer')

// 10d) RF/KF-valkretsjämförelse mot 2022: andel wirad, MANDAT tomt ("–").
console.log('\n--- 10d. RF/KF-valkrets ±2022 (comparison-2022.json) ---')
try {
  const cmpVk = JSON.parse(readFileSync('public/comparison-2022.json', 'utf8')) as Comparison2022
  const nRfVk = Object.keys(cmpVk.RF_byValkrets ?? {}).length
  check(nRfVk === 62, 'RF_byValkrets: 62 valkretsar', String(nRfVk))
  check(Object.keys(cmpVk.RF_valkretsNamn ?? {}).length === 62 && (cmpVk.RF_valkretsNamn?.['0112'] === 'Nordväst'), 'RF_valkretsNamn: 62 namn (0112 = Nordväst)')
  const rfVkA = applyComparison(buildRows({}, emptyParty, 0.03), 'RF', 'valkrets', '0112', cmpVk, emptyParty)
  check(rfVkA.rows.length >= 1 && rfVkA.rows.every((r) => r.andel2022 != null), 'RF valkrets 0112: 2022-andel wirad', `${rfVkA.rows.length} rader`)
  check(rfVkA.rows.every((r) => r.mandat2022 == null) && rfVkA.totalMandat2022 == null, 'RF valkrets 0112: 2022-mandat "–" (organet är regionen)')
  const nKfVk = Object.keys(cmpVk.KF_byValkrets ?? {}).length
  check(nKfVk === 314, 'KF_byValkrets: 314 valkretsar (273 en-per-kommun + 41 i 17 indelade)', String(nKfVk))
  check(cmpVk.KF_valkretsNamn?.['018001'] === '1 Södermalm-Enskede' && cmpVk.KF_valkretsNamn?.['106000'] === 'Olofström', 'KF_valkretsNamn: indelad + oindelad (…00 = kommunnamn)')
  const kfVkA = applyComparison(buildRows({}, emptyParty, 0.03), 'KF', 'valkrets', '018001', cmpVk, emptyParty)
  check(kfVkA.rows.length >= 1 && kfVkA.rows.every((r) => r.andel2022 != null), 'KF valkrets 018001: 2022-andel wirad', `${kfVkA.rows.length} rader`)
  check(kfVkA.rows.every((r) => r.mandat2022 == null) && kfVkA.totalMandat2022 == null, 'KF valkrets 018001: 2022-mandat "–" (organet är kommunen)')
} catch (e) {
  check(false, `RF/KF-valkrets-test kastade (${(e as Error).message})`)
}

console.log(ok ? '\n✅ AGGREGAT + MANDAT + ±2022 MATCHAR FACIT / FÖRVÄNTAT' : '\n❌ se FEL ovan')
process.exit(ok ? 0 : 1)
