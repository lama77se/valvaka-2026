// Smoke-testar computeAreaView (src/lib/areaView.ts) — bevisar att den rena
// orsakskedjan (aggregat → mandat/valkretsmandat-fallback → jämförelse → display)
// producerar internt konsistent output för två minimala men REALA scenarier
// (tom store; en store med två distrikt och riktiga röster). Detta är INTE en
// mandatkorrekthets-proof (den täcks redan uttömmande av verify-mandate*.ts/
// verify-aggregate.ts mot de UNDERLIGGANDE funktionerna computeAreaView själv
// bara orkestrerar, oförändrade här) — det är ett wiring-smoke-test av
// EXTRAKTIONEN. Den RIKTIGA regressionsproofen är Playwright-jämförelsen i
// Task 7 (ResultPanel före/efter, mot körande app).
//   npx tsx scripts/verify-area-view.ts
import { ResultStore, TurnoutStore } from '../src/lib/results.ts'
import { buildGroups } from '../src/lib/aggregate.ts'
import { computeAreaView, type AreaViewParams } from '../src/lib/areaView.ts'
import type { PartyMeta } from '../src/lib/aggregate.ts'

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

const party = new Map<string, PartyMeta>([
  ['S', { forkortning: 'S', farg: '#e8112d', beteckning: 'Arbetarepartiet-Socialdemokraterna' } as PartyMeta],
  ['M', { forkortning: 'M', farg: '#52bdec', beteckning: 'Moderaterna' } as PartyMeta],
])
const allCodes = ['01800142', '01800256']
const baseParams = (store: ResultStore, turnoutStore: TurnoutStore): AreaViewParams => ({
  valtyp: 'RD',
  area: { level: 'riket', code: null },
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
  valkretsar: [],
  distriktNamn: new Map(),
})

// 1) Tom store — inga röster, inget rapporterat. Ska inte kasta; giltiga=0, reported=0.
const emptyStore = new ResultStore()
const emptyTurnout = new TurnoutStore()
const empty = computeAreaView(baseParams(emptyStore, emptyTurnout))
check(empty.giltiga === 0, 'tom store → giltiga = 0', String(empty.giltiga))
check(empty.reported === 0 && empty.total === 2, 'tom store → 0 av 2 rapporterade', `${empty.reported}/${empty.total}`)
check(empty.turnout === null, 'tom store → turnout null (ingen röstlängd)', String(empty.turnout))
// TurnoutStore.aggregate() (oförändrad, se src/lib/results.ts) initierar blanka/ejAnmalda/
// ovrigaOgiltiga till 0 och sätter dem bara till null om ett FAKTISKT rapporterat distrikt
// saknar fälten — inga distrikt alls (helt tom store) ger alltså {..:0, totalt:0}, inte null.
check(
  empty.invalidVotes !== null && empty.invalidVotes.totalt === 0 && empty.invalidVotes.pctOfTotal === null,
  'tom store → invalidVotes = 0/0/0 (inga distrikt alls, inte "fält saknas")',
  JSON.stringify(empty.invalidVotes),
)
check(empty.areaName === 'Riket', 'areaName för riket')

// 2) Två distrikt med riktiga röster + röstlängd/ogiltiga-fält.
const store = new ResultStore()
store.set('01800142', 'S', 300, '2026-09-13T20:00:00')
store.set('01800142', 'M', 200, '2026-09-13T20:00:00')
store.set('01800256', 'S', 100, '2026-09-13T20:05:00')
store.set('01800256', 'M', 400, '2026-09-13T20:05:00')
const turnoutStore = new TurnoutStore()
turnoutStore.set('01800142', 500, 600, 5, 2, 1)
turnoutStore.set('01800256', 500, 700, 3, 1, 0)
const withVotes = computeAreaView(baseParams(store, turnoutStore))
check(withVotes.giltiga === 1000, 'giltiga röster summerar över båda distrikten', String(withVotes.giltiga))
check(withVotes.reported === 2, 'båda distrikten rapporterade')
// M=200+400=600, S=300+100=400 → M störst (rows sorteras fallande på röster, buildRows).
check(withVotes.display.shown.length === 2 && withVotes.display.shown[0].partikod === 'M', 'M störst (600/1000)', JSON.stringify(withVotes.display.shown.map((r) => r.partikod)))
check(withVotes.turnout !== null && Math.abs(withVotes.turnout - (1000 / 1300) * 100) < 1e-9, 'turnout = Σtotal/Σrb', String(withVotes.turnout))
check(withVotes.invalidVotes?.totalt === 12, 'invalidVotes summerar blanka+ejAnmalda+ovrigaOgiltiga (5+2+1+3+1+0)', JSON.stringify(withVotes.invalidVotes))
// valtyp='RD'/nivå='riket' är RD:s ENDA meningsfulla mandatnivå → computeMandate räknar
// alltid ut en riktig fördelning där (SEAT_CONFIG_2026.RD, oberoende av fixturens storlek) —
// justerat efter faktiskt beteende (soft assertion, se brief): bara "kraschar inte" pinnas,
// inte det exakta talet 349 i sig (redan täckt av verify-mandate*.ts).
check(typeof withVotes.totalMandat === 'number' && withVotes.totalMandat > 0, 'RD/riket ger en mandatfördelning (computeMandate, ej null) — ingen krasch', String(withVotes.totalMandat))

console.log(ok ? '\nAlla kontroller OK.' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
