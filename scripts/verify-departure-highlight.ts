// Validerar highlight-predikatet i DepartureBoard.tsx (markMatched-villkoret):
//   ancestorsOf(valtyp, {level:'distrikt', code: vd}, index).some(a => a.level===selectedArea.level && a.code===selectedArea.code)
// Samma syntetiska index-mönster som scripts/verify-aggregate.ts §10 (redan verifierat
// mot ancestorsOf/childGroupsOf). Fokus här: att predikatet ger rätt sant/falskt för
// realistiska val (kommun/region/valkrets), inklusive den degenererade "oindelad
// kommun = en valkrets"-fållan (valkretsnivån slopas då ur ancestorsOf — men UI:t
// erbjuder aldrig den nivån som ett val för en sådan kommun, se §10c nedan).
//   npx tsx scripts/verify-departure-highlight.ts
import { ancestorsOf, type AreaIndex, type HArea } from '../src/lib/hierarchy.ts'
import type { Valtyp } from '../src/lib/results.ts'

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

const matches = (valtyp: Valtyp, vd: string, index: AreaIndex, selectedArea: HArea): boolean =>
  ancestorsOf(valtyp, { level: 'distrikt', code: vd }, index).some((a) => a.level === selectedArea.level && a.code === selectedArea.code)

// RD: samma index som verify-aggregate.ts §10a (Stockholm-splitten: kommun 0180/0114 samma
// län, olika valkrets; läns-valkrets 29 = två kommuner).
console.log('--- RD ---')
const rdIndex: AreaIndex = {
  districtToVk: new Map([['01800142', '01'], ['01800256', '01'], ['01140099', '02'], ['25600011', '29'], ['25800011', '29']]),
  kommunToVk: new Map([['0180', '01'], ['0114', '02'], ['2560', '29'], ['2580', '29']]),
  vkToDistricts: new Map([['01', ['01800142', '01800256']], ['02', ['01140099']], ['29', ['25600011', '25800011']]]),
}
check(matches('RD', '25600011', rdIndex, { level: 'kommun', code: '2560' }), 'distrikt i vald kommun (2560, flerkommuns-valkrets 29) matchar')
check(!matches('RD', '25800011', rdIndex, { level: 'kommun', code: '2560' }), 'distrikt i ANNAN kommun (2580) matchar INTE kommun 2560')
check(matches('RD', '25600011', rdIndex, { level: 'valkrets', code: '29' }), 'distrikt i vald läns-valkrets (29) matchar')
check(!matches('RD', '01800142', rdIndex, { level: 'valkrets', code: '29' }), 'distrikt i ANNAN valkrets matchar INTE valkrets 29')
// Enkommuns-valkrets (Stockholm 0180 = HELA valkrets 01, se §10a): ancestorsOf slopar
// kommun-nivån (kollapsar rakt till distrikt) — samma regel som styr breadcrumben (pathOf)
// och drill-down (childGroupsOf ger aldrig ett kommun-steg att klicka här). Alltså ej
// nåbart som selectedArea via normal UI-navigering för DENNA valkrets; bara teoretiskt
// via en handskriven URL (?omrade=kommun:0180 valideras inte mot nåbarhet, se
// parseAreaParam). Låst här som KÄNT, förbefintligt beteende — ingen regression av denna
// feature (ancestorsOf självt, oförändrat).
check(!matches('RD', '01800142', rdIndex, { level: 'kommun', code: '0180' }), 'KÄND FÅLLA (förbefintlig, ej UI-nåbar): enkommuns-valkretsens kommun-nivå slopas i ancestorsOf')

// RF: samma index som §10b (fler-vk-region 01, Stockholm delas i vk 0101/0104).
console.log('--- RF ---')
const rfIndex: AreaIndex = {
  districtToVk: new Map([['01800142', '0101'], ['01800256', '0104'], ['01140099', '0112'], ['25600011', '2500']]),
  vkToDistricts: new Map([['0101', ['01800142']], ['0104', ['01800256']], ['0112', ['01140099']], ['2500', ['25600011']]]),
}
check(matches('RF', '01800142', rfIndex, { level: 'region', code: '01' }), 'distrikt i vald region (01) matchar')
check(!matches('RF', '25600011', rfIndex, { level: 'region', code: '01' }), 'distrikt i ANNAN region (25) matchar INTE region 01')
check(matches('RF', '01800142', rfIndex, { level: 'valkrets', code: '0101' }), 'distrikt i vald valkrets (0101) matchar')
check(!matches('RF', '01800256', rfIndex, { level: 'valkrets', code: '0101' }), 'distrikt i ANNAN valkrets (0104) matchar INTE valkrets 0101')

// KF: samma index som §10c (indelad kommun 0180 → vk 018001/018004; oindelad 1060 → EN vk "106000").
console.log('--- KF ---')
const kfIndex: AreaIndex = {
  districtToVk: new Map([['01800142', '018001'], ['01800256', '018004'], ['10600011', '106000']]),
  vkToDistricts: new Map([['018001', ['01800142']], ['018004', ['01800256']], ['106000', ['10600011']]]),
}
check(matches('KF', '01800142', kfIndex, { level: 'kommun', code: '0180' }), 'distrikt i vald kommun (0180) matchar')
check(!matches('KF', '10600011', kfIndex, { level: 'kommun', code: '0180' }), 'distrikt i ANNAN kommun (1060) matchar INTE kommun 0180')
check(matches('KF', '01800142', kfIndex, { level: 'valkrets', code: '018001' }), 'distrikt i vald valkrets (indelad kommun) matchar')
check(!matches('KF', '01800256', kfIndex, { level: 'valkrets', code: '018001' }), 'distrikt i ANNAN valkrets (018004) matchar INTE valkrets 018001')
// Oindelad kommun kollapsar valkretsnivån ur ancestorsOf (se §10c) — men UI:t erbjuder den
// aldrig som ett valbart "valkrets"-läge för en sådan kommun (childGroupsOf ger distrikt
// direkt), så detta scenario når aldrig markMatched i praktiken. Dokumenterat, inte en bugg.
check(!matches('KF', '10600011', kfIndex, { level: 'valkrets', code: '106000' }), 'KÄND FÅLLA (ofarlig): oindelad kommuns valkrets syns inte i ancestorsOf → matchar inte ens sig själv (UI erbjuder aldrig detta läge)')

console.log(ok ? '\nAlla kontroller OK.' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
