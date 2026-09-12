// Bevisar och verifierar fixen för valkretsar-per-valtyp-bugen i useAreaView.ts/
// AreaSelect.tsx: en komponent anropad med ETT valtyp (t.ex. RF) måste slå upp
// valkretsnamn ur DEN valtypens lista (valkretsListRef.current['RF']), aldrig ur
// en annan valtyps — se Task 1 i docs/superpowers/plans/2026-09-12-dashboard-vy-pr2-grid.md.
// Denna fil testar computeAreaView (den delade RENA funktionen) direkt med två
// OLIKA valkretsar-listor för RF resp. KF, för att bevisa att skickar man RF:s
// lista in för ett RF-anrop får man RF:s namn — inte KF:s eller en tom lista.
//   npx tsx scripts/verify-area-view-multivaltyp.ts
import { ResultStore, TurnoutStore } from '../src/lib/results.ts'
import { buildGroups } from '../src/lib/aggregate.ts'
import { computeAreaView, type AreaViewParams } from '../src/lib/areaView.ts'
import type { PartyMeta } from '../src/lib/aggregate.ts'

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

const party = new Map<string, PartyMeta>()
const allCodes = ['01800142']
const store = new ResultStore()
const turnoutStore = new TurnoutStore()
const baseParams = (valkretsar: { code: string; name: string }[]): AreaViewParams => ({
  valtyp: 'RF',
  area: { level: 'valkrets', code: '0101' },
  store,
  turnoutStore,
  allCodes,
  meta: new Map(),
  party,
  groups: buildGroups(allCodes),
  uppsamling: { byOrgan: new Map(), byValkrets: new Map(), unresolvedByOrgan: new Map() },
  areaIndex: { districtToVk: new Map(), vkToDistricts: new Map() },
  comparison: null,
  district2022: new Map(),
  kommuner: [],
  regioner: [],
  valkretsar,
  distriktNamn: new Map(),
})

// Rätt lista (RF:s egen) → riktigt namn.
const withRfList = computeAreaView(baseParams([{ code: '0101', name: 'Stockholms stad' }]))
check(withRfList.areaName === 'Stockholms stad', 'computeAreaView med RÄTT (RF-egen) valkretsar-lista ger riktigt namn', withRfList.areaName)

// Fel lista (t.ex. KF:s, eller den globalt aktiva valtypens om den råkar vara KF) → fallback till kod.
const withWrongList = computeAreaView(baseParams([{ code: '018001', name: 'Stockholm innerstad (KF)' }]))
check(withWrongList.areaName === '0101', 'computeAreaView med FEL valkretsar-lista faller tillbaka till rå kod (bevisar varför denna korrekthet spelar roll)', withWrongList.areaName)

console.log(ok ? '\nAlla kontroller OK — computeAreaView är korrekt GIVET rätt indata; ansvaret ligger på useAreaView/AreaSelect att skicka RÄTT valkrets-lista (fixas i denna task).' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
