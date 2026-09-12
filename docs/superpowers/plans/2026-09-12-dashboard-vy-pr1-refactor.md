# Dashboard-vy PR 1: extrahera useAreaView/AreaSelect ur ResultPanel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the mandate/votes/turnout computation and the area `<select>` markup out of `ResultPanel.tsx` into shared, parameterized pieces (`computeAreaView`, `useAreaView`, `AreaSelect`), rewire `ResultPanel.tsx` to use them, and add optional value/onChange overrides to `ValtypSelector` — with **zero behavior change** to the existing map+panel view. This is PR 1 of 2 (see spec); PR 2 (the actual Dashboard grid) builds on top of this once merged and verified.

**Architecture:** Move code, don't rewrite it. Every extracted piece is a byte-faithful copy of existing logic, only parameterized (context reads → function params) instead of changed. The regression proof is a scripted Playwright comparison of the running app's rendered output across representative (valtyp, area) scenarios, captured on `main` BEFORE touching anything and re-run on the branch AFTER, diffed to be identical.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind. No test framework in this repo — verification uses the existing `scripts/verify-*.ts` convention (plain `tsx` scripts with a `check()`/`ok` helper, see `scripts/verify-aggregate.ts` and `scripts/verify-departure-highlight.ts`) plus ad-hoc Playwright scripts (see prior sessions' pattern: write to the scratchpad dir, `cp` into the repo root temporarily so `node_modules` resolves, run with plain `node`, delete after).

**Spec:** `docs/superpowers/specs/2026-09-12-dashboard-vy-design.md`

## Global Constraints

- **HARD REQUIREMENT (from spec): zero regression in the existing map+panel view.** Every task that touches `ResultPanel.tsx`, `ValtypSelector.tsx`, or shared context must produce IDENTICAL rendered output to `main` for every existing scenario. When in doubt, favor the option that changes fewer lines.
- Never `git commit` directly on `main` — always a feature branch, PR, CI green, then merge (squash) per this repo's workflow. Branch name for this plan: `refactor/dashboard-vy-extract-areaview`.
- Svenska i kommentarer/docs (projektkonvention, se CLAUDE.md). Engelska är okej i identifierare.
- Run `npx tsc --noEmit`, `npm run lint`, `npm run build` after EVERY task — all three must stay green throughout, not just at the end.
- No new npm dependencies.

---

### Task 1: Export `NamedCode` from ResultsProvider.tsx

**Files:**
- Modify: `src/components/ResultsProvider.tsx:112`

**Interfaces:**
- Produces: `export type NamedCode = { code: string; name: string }` — importable from `@/components/ResultsProvider`, used by Task 3 (`areaView.ts`) and Task 5 (`AreaSelect.tsx`).

- [ ] **Step 1: Add the `export` keyword**

Change line 112 from:
```ts
type NamedCode = { code: string; name: string }
```
to:
```ts
export type NamedCode = { code: string; name: string }
```

- [ ] **Step 2: Verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: no errors (this is a pure additive export, every existing usage of the local `NamedCode` name inside the same file keeps working unchanged).

- [ ] **Step 3: Commit**

```bash
git checkout -b refactor/dashboard-vy-extract-areaview
git add src/components/ResultsProvider.tsx
git commit -m "Exportera NamedCode-typen (förberedelse för Dashboard-vyns delade komponenter)"
```

---

### Task 2: `src/lib/areaSelect.ts` — extrahera LEVELS/PROMPT + select→Area-logiken

**Files:**
- Create: `src/lib/areaSelect.ts`
- Test: `scripts/verify-area-select.ts`
- (Modify later, Task 7): `src/components/ResultPanel.tsx` will import from here instead of defining its own copies.

**Interfaces:**
- Produces:
  - `LEVELS: Record<Valtyp, ('riket' | 'valkrets' | 'region' | 'kommun')[]>`
  - `PROMPT: Record<Valtyp, string>`
  - `areaFromSelectValue(valtyp: Valtyp, raw: string): Area | null` — `null` means "distrikt-värde, ignorera" (mirrors the `if (v.startsWith('d:')) return` early-return in `ResultPanel.tsx:424` today).

- [ ] **Step 1: Write the failing verify script**

Create `scripts/verify-area-select.ts`:
```ts
// Validerar areaFromSelectValue/LEVELS/PROMPT (src/lib/areaSelect.ts) — ren
// extraktion ur ResultPanel.tsx:46-51,422-433, ingen beteendeändring.
//   npx tsx scripts/verify-area-select.ts
import { LEVELS, PROMPT, areaFromSelectValue } from '../src/lib/areaSelect.ts'

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

check(LEVELS.RD.join() === 'riket,valkrets,kommun', 'LEVELS.RD')
check(LEVELS.RF.join() === 'region,valkrets', 'LEVELS.RF')
check(LEVELS.KF.join() === 'kommun', 'LEVELS.KF')
check(PROMPT.RD === '' && PROMPT.RF === 'Välj region…' && PROMPT.KF === 'Välj kommun…', 'PROMPT')

check(areaFromSelectValue('RD', 'd:01800142') === null, 'd: (distrikt) → null (sätts via kartklick, inte listan)')
check(JSON.stringify(areaFromSelectValue('RD', '')) === JSON.stringify({ level: 'riket', code: null }), 'RD tom sträng → defaultAreaFor(RD) = riket/null', JSON.stringify(areaFromSelectValue('RD', '')))
check(JSON.stringify(areaFromSelectValue('KF', '')) === JSON.stringify({ level: 'kommun', code: null }), 'KF tom sträng → defaultAreaFor(KF) = kommun/null (prompt-läge)', JSON.stringify(areaFromSelectValue('KF', '')))
check(JSON.stringify(areaFromSelectValue('RD', 'riket')) === JSON.stringify({ level: 'riket', code: null }), '"riket" → RIKET')
check(JSON.stringify(areaFromSelectValue('RD', 'vk:29')) === JSON.stringify({ level: 'valkrets', code: '29' }), 'vk: → valkrets')
check(JSON.stringify(areaFromSelectValue('RF', 'r:01')) === JSON.stringify({ level: 'region', code: '01' }), 'r: → region')
check(JSON.stringify(areaFromSelectValue('KF', 'k:1488')) === JSON.stringify({ level: 'kommun', code: '1488' }), 'k: → kommun')

console.log(ok ? '\nAlla kontroller OK.' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-area-select.ts`
Expected: FAIL — `Cannot find module '../src/lib/areaSelect.ts'` (file doesn't exist yet).

- [ ] **Step 3: Write `src/lib/areaSelect.ts`**

```ts
// Områdesväljarens rena logik — vilka nivåer/prompt-text varje valtyp erbjuder, och
// hur ett <select>-värde mappas till ett Area. Extraherad ur ResultPanel.tsx:46-51,
// 422-433 (oförändrad logik, bara flyttad) så AreaSelect.tsx (Dashboard-vyns egna
// väljarinstanser) och ResultPanel själv kan dela EN källa i stället för att driva
// isär. Se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md.
import { defaultAreaFor, RIKET, type Area } from '@/components/ResultsProvider'
import type { Valtyp } from './results'

// Nivåer väljaren erbjuder per valtyp: den nativa nivån + geografisk nedbrytning
// UNDER den (aldrig uppåt). RD: riket → VALKRETS (riksdagens nivå) → kommun; RF:
// region → VALKRETS (regionens nivå — Stockholm delas tvärs kommuner) → distrikt;
// KF bara kommun.
export const LEVELS: Record<Valtyp, ('riket' | 'valkrets' | 'region' | 'kommun')[]> = {
  RD: ['riket', 'valkrets', 'kommun'],
  RF: ['region', 'valkrets'],
  KF: ['kommun'],
}
export const PROMPT: Record<Valtyp, string> = { RD: '', RF: 'Välj region…', KF: 'Välj kommun…' }

// Mappar <select>:ens value-attribut (t.ex. "vk:29", "k:1488", "r:01", "riket", "")
// till ett Area. `null` = distrikt-värde ("d:...") — distrikt sätts via kartklick,
// inte listan, samma tidiga return som ResultPanel.tsx:424 gjorde inline.
export function areaFromSelectValue(valtyp: Valtyp, raw: string): Area | null {
  if (raw.startsWith('d:')) return null
  if (raw === '') return defaultAreaFor(valtyp)
  if (raw === 'riket') return RIKET
  if (raw.startsWith('vk:')) return { level: 'valkrets', code: raw.slice(3) }
  return { level: raw.startsWith('r:') ? 'region' : 'kommun', code: raw.slice(2) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-area-select.ts`
Expected: `Alla kontroller OK.`, exit code 0.

- [ ] **Step 5: Typecheck/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/areaSelect.ts scripts/verify-area-select.ts
git commit -m "Extrahera LEVELS/PROMPT/areaFromSelectValue till src/lib/areaSelect.ts"
```

---

### Task 3: `src/lib/areaView.ts` — extrahera `computeAreaView` (ren funktion)

**Files:**
- Create: `src/lib/areaView.ts`
- Test: `scripts/verify-area-view.ts`

**Interfaces:**
- Consumes: `Area`, `NamedCode` from `@/components/ResultsProvider` (Task 1); `ResultStore`, `TurnoutStore`, `Valtyp`, `slutligTag` from `@/lib/results`; `AreaComparison`, `AreaGroups`, `Comparison2022`, `DisplayRows`, `DistrictMeta`, `Level`, `PartyMeta`, `UppsamlingBuckets`, `applyComparison`, `applyMandate`, `buildRows`, `collapseForDisplay`, `computeMandate`, `computeRdValkretsMandate`, `computeRegionOrKommunValkretsMandate`, `districtsInArea`, `mergeVotes`, `sparrFor`, `uppsamlingForArea` from `@/lib/aggregate`; `BlockConfig`, `RIKET_BLOCKS`, `SPECTRUM` from `@/lib/soffa`; `REGION_STYRE_BLOCKS` from `@/lib/regionBlocks`; `KOMMUN_STYRE_BLOCKS` from `@/lib/kommunBlocks`; `AreaIndex` from `@/lib/hierarchy`.
- Produces: `computeAreaView(params: AreaViewParams): AreaViewResult` — used by Task 4 (`useAreaView` hook).

- [ ] **Step 1: Write the failing verify script**

Create `scripts/verify-area-view.ts`:
```ts
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
check(empty.invalidVotes === null, 'tom store → invalidVotes null (inga ogiltiga-fält satta)')
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
check(withVotes.display.shown.length === 2 && withVotes.display.shown[0].partikod === 'S', 'S störst (400/1000)', JSON.stringify(withVotes.display.shown.map((r) => r.partikod)))
check(withVotes.turnout !== null && Math.abs(withVotes.turnout - (1000 / 1300) * 100) < 1e-9, 'turnout = Σtotal/Σrb', String(withVotes.turnout))
check(withVotes.invalidVotes?.totalt === 12, 'invalidVotes summerar blanka+ejAnmalda+ovrigaOgiltiga (5+2+1+3+1+0)', JSON.stringify(withVotes.invalidVotes))
check(withVotes.totalMandat == null, 'ingen mandatkonfig given (groups tom/inga seatConfig-kopplingar via computeMandate på detta minimala fixture) → totalMandat null/undefined, ingen krasch', String(withVotes.totalMandat))

console.log(ok ? '\nAlla kontroller OK.' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/verify-area-view.ts`
Expected: FAIL — `Cannot find module '../src/lib/areaView.ts'`.

- [ ] **Step 3: Write `src/lib/areaView.ts`**

```ts
// Ren beräkningslogik för "toppen" av ett områdes resultatvy — röster, mandat,
// valdeltagande, ogiltiga röster, blockvy. Extraherad ur ResultPanel.tsx (view-
// useMemo:en, rad 90-149 + 151-226 i original) för att delas mellan den globala
// resultatpanelen och Dashboard-vyns fyra oberoende rutor. Ingen React här —
// parametriserad rent på valtyp+område+data, testbar isolerat (se
// scripts/verify-area-view.ts). Se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md.
import { slutligTag, type ResultStore, type TurnoutStore, type Valtyp } from './results'
import {
  applyComparison,
  applyMandate,
  buildRows,
  collapseForDisplay,
  computeMandate,
  computeRdValkretsMandate,
  computeRegionOrKommunValkretsMandate,
  districtsInArea,
  mergeVotes,
  sparrFor,
  uppsamlingForArea,
  type AreaComparison,
  type AreaGroups,
  type Comparison2022,
  type DisplayRows,
  type DistrictMeta,
  type Level,
  type PartyMeta,
  type UppsamlingBuckets,
} from './aggregate'
import { RIKET_BLOCKS, type BlockConfig } from './soffa'
import { REGION_STYRE_BLOCKS } from './regionBlocks'
import { KOMMUN_STYRE_BLOCKS } from './kommunBlocks'
import type { AreaIndex } from './hierarchy'
import type { Area, NamedCode } from '@/components/ResultsProvider'

// Nivåer där mandat överhuvudtaget är ett meningsfullt tal (organets EGEN nivå +
// valkrets) — OBEROENDE av om röster hunnit räknas än. RD:s "kommun" är bara en
// geografisk nedbrytning (se areaSelect.ts LEVELS), inte riksdagens organ-nivå.
// Flyttad hit oförändrad ur ResultPanel.tsx:58-62.
const MANDAT_LEVELS: Record<Valtyp, Level[]> = {
  RD: ['riket', 'valkrets'],
  RF: ['region', 'valkrets'],
  KF: ['kommun', 'valkrets'],
}

export interface AreaViewParams {
  valtyp: Valtyp
  area: Area
  store: ResultStore
  turnoutStore: TurnoutStore
  allCodes: string[]
  meta: Map<string, DistrictMeta>
  party: Map<string, PartyMeta>
  groups: AreaGroups
  uppsamling: UppsamlingBuckets
  areaIndex: AreaIndex
  comparison: Comparison2022 | null
  district2022: Map<string, AreaComparison>
  kommuner: NamedCode[]
  regioner: NamedCode[]
  valkretsar: NamedCode[]
  distriktNamn: Map<string, string>
}

export interface AreaViewResult {
  display: DisplayRows
  giltiga: number
  totalMandat: number | null
  totalMandat2022: number | null
  has2022: boolean
  reported: number
  total: number
  turnout: number | null
  turnoutTitle: string | undefined
  invalidVotes: {
    blanka: number
    ejAnmalda: number
    ovrigaOgiltiga: number
    totalt: number
    pctOfTotal: number | null
  } | null
  blocks: BlockConfig | undefined
  showMandat: boolean
  areaName: string
  pct: number
  statusTag: ReturnType<typeof slutligTag>
}

export function computeAreaView(p: AreaViewParams): AreaViewResult {
  const { valtyp, area, store, turnoutStore, allCodes, meta, party, groups, uppsamling, areaIndex, comparison, district2022, kommuner, regioner, valkretsar, distriktNamn } = p

  const statusTag = slutligTag(store.slutligProgress())

  const blocks: BlockConfig | undefined =
    valtyp === 'RD' && area.level === 'riket'
      ? RIKET_BLOCKS
      : valtyp === 'RF' && area.level === 'region'
        ? REGION_STYRE_BLOCKS[area.code ?? '']
        : valtyp === 'KF' && area.level === 'kommun'
          ? KOMMUN_STYRE_BLOCKS[area.code ?? '']
          : undefined

  const showMandat = MANDAT_LEVELS[valtyp].includes(area.level)

  const areaName =
    area.level === 'riket'
      ? 'Riket'
      : area.level === 'distrikt'
        ? (distriktNamn.get(area.code ?? '') ?? area.code ?? '')
        : area.level === 'valkrets'
          ? (valkretsar.find((v) => v.code === area.code)?.name ?? area.code ?? '')
          : area.level === 'region'
            ? (regioner.find((r) => r.code === area.code)?.name ?? area.code ?? '')
            : (kommuner.find((k) => k.code === area.code)?.name ?? area.code ?? '')

  const codes = districtsInArea(allCodes, area.level, area.code, valtyp, meta)
  const votes = mergeVotes(store.aggregate(codes), uppsamlingForArea(valtyp, area.level, area.code, uppsamling))
  const mandate = computeMandate(valtyp, area.level, area.code, (c) => store.aggregate(c), groups, uppsamling)
  const valkretsMandate =
    area.level !== 'valkrets' || !area.code
      ? null
      : valtyp === 'RD'
        ? computeRdValkretsMandate(area.code, areaIndex.vkToDistricts, (c) => store.aggregate(c), uppsamling)
        : computeRegionOrKommunValkretsMandate(
            valtyp,
            valtyp === 'RF' ? area.code.slice(0, 2) : area.code.slice(0, 4),
            area.code,
            areaIndex.vkToDistricts,
            (c) => store.aggregate(c),
            sparrFor(valtyp, 'valkrets', area.code),
            uppsamling,
          )
  let areaResult = applyMandate(
    buildRows(votes, party, sparrFor(valtyp, area.level, area.code)),
    mandate ?? (valkretsMandate && { seatsByParty: valkretsMandate.seatsByParty, totalMandat: valkretsMandate.totalSeats }),
  )
  const districtLeaf =
    area.level === 'distrikt' && area.code ? (district2022.get(`${valtyp}:${area.code}`) ?? null) : null
  areaResult = applyComparison(areaResult, valtyp, area.level, area.code, comparison, party, districtLeaf)
  const display = collapseForDisplay(areaResult)
  const reported = codes.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0)
  const has2022 = areaResult.rows.some((r) => r.andel2022 != null)
  const t = turnoutStore.aggregate(codes)
  const turnout = t.rb > 0 ? (t.total / t.rb) * 100 : null
  const invalidVotes =
    t.blanka != null && t.ejAnmalda != null && t.ovrigaOgiltiga != null
      ? {
          blanka: t.blanka,
          ejAnmalda: t.ejAnmalda,
          ovrigaOgiltiga: t.ovrigaOgiltiga,
          totalt: t.blanka + t.ejAnmalda + t.ovrigaOgiltiga,
          pctOfTotal: t.total > 0 ? ((t.blanka + t.ejAnmalda + t.ovrigaOgiltiga) / t.total) * 100 : null,
        }
      : null
  const total = codes.length
  const pct = total > 0 ? Math.round((reported / total) * 100) : 0

  return {
    display,
    giltiga: areaResult.giltiga,
    totalMandat: areaResult.totalMandat,
    totalMandat2022: areaResult.totalMandat2022,
    has2022,
    reported,
    total,
    turnout,
    turnoutTitle: t.rb > 0 ? `Räknade röster: ${t.total.toLocaleString('sv-SE')} · Röstberättigade: ${t.rb.toLocaleString('sv-SE')}` : undefined,
    invalidVotes,
    blocks,
    showMandat,
    areaName,
    pct,
    statusTag,
  }
}
```

**Note for the implementer:** check the ACTUAL exported member names/shapes as you go (`ResultStore.aggregate`/`.has`/`.slutligProgress`, `TurnoutStore.aggregate`/`.set`, `computeMandate`, `computeRdValkretsMandate`, `computeRegionOrKommunValkretsMandate`'s exact parameter order) against the CURRENT `src/lib/results.ts` and `src/lib/aggregate.ts` — this plan was written against a specific snapshot of those files; if `git log` shows either file changed since (very possible — this is a live multi-session repo), diff `ResultPanel.tsx`'s current `view` useMemo against what's written here and adjust the extraction to match the CURRENT source, not this plan, before proceeding. The plan's intent (parameterize, don't change behavior) matters more than its exact snippet.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-area-view.ts`
Expected: `Alla kontroller OK.`, exit code 0. If `totalMandat` assertion fails because this minimal fixture actually DOES produce a mandate number (depends on `computeMandate`'s exact handling of an empty/mismatched seat-config lookup for these synthetic codes) — that's fine, adjust the assertion to match whatever `computeMandate` actually returns for this fixture (`null`, `undefined`, or a number) rather than forcing a particular value; the point of this test is "doesn't crash and result is internally consistent," not pinning `computeMandate`'s own behavior (already covered by `verify-mandate*.ts`).

- [ ] **Step 5: Typecheck/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/areaView.ts scripts/verify-area-view.ts
git commit -m "Extrahera computeAreaView (ren funktion) till src/lib/areaView.ts"
```

---

### Task 4: `src/components/useAreaView.ts` — tunn hook runt computeAreaView

**Files:**
- Create: `src/components/useAreaView.ts`

**Interfaces:**
- Consumes: `computeAreaView`, `AreaViewResult` from `@/lib/areaView` (Task 3); `useResults`, `Area` from `@/components/ResultsProvider`; `Valtyp` from `@/lib/results`.
- Produces: `useAreaView(valtyp: Valtyp, area: Area): AreaViewResult` — used by Task 7 (`ResultPanel.tsx`) and, in PR 2, by `AreaSummary.tsx`.

- [ ] **Step 1: Write `src/components/useAreaView.ts`**

```tsx
// React-wiring runt computeAreaView (src/lib/areaView.ts): hämtar de globala,
// valtyp-oberoende referensdata-refarna ur ResultsProvider och memoiserar om på
// samma beroenden som ResultPanel.tsx:s view-useMemo gjorde innan extraktionen
// (valtyp, area, revision — se computeAreaView-anropet nedan). Both ResultPanel
// (globalt state) och Dashboard-vyns rutor (lokalt state per ruta) anropar denna
// med SINA respektive valtyp/area — datan (storesRef m.fl.) är gemensam.
import { useMemo } from 'react'
import { useResults, type Area } from '@/components/ResultsProvider'
import { computeAreaView, type AreaViewResult } from '@/lib/areaView'
import type { Valtyp } from '@/lib/results'

export function useAreaView(valtyp: Valtyp, area: Area): AreaViewResult {
  const {
    storesRef, turnoutStoresRef, allCodesRef, metaRef, partyRef, groupsRef, uppsamlingRef,
    areaIndexRef, comparisonRef, district2022Ref, kommuner, regioner, valkretsar,
    distriktNamnRef, revision,
  } = useResults()

  return useMemo(
    () =>
      computeAreaView({
        valtyp,
        area,
        store: storesRef.current[valtyp],
        turnoutStore: turnoutStoresRef.current[valtyp],
        allCodes: allCodesRef.current,
        meta: metaRef.current,
        party: partyRef.current,
        groups: groupsRef.current,
        uppsamling: uppsamlingRef.current[valtyp],
        areaIndex: areaIndexRef.current[valtyp],
        comparison: comparisonRef.current,
        district2022: district2022Ref.current,
        kommuner,
        regioner,
        valkretsar,
        distriktNamn: distriktNamnRef.current,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valtyp, area, revision, kommuner, regioner, valkretsar],
  )
}
```

**Note for the implementer:** `valkretsar` in `useResults()` is documented (see `ResultsProvider.tsx:159`) as "valkretsar för AKTIV valtyp" — i.e. it already tracks whichever valtyp is passed to `useAreaView` ONLY if that matches the globally active valtyp. Check this before wiring PR 2's Dashboard boxes (which pass a LOCAL valtyp that may differ from the active one) — if `valkretsar` doesn't cover a box's own valtyp, `areaName` for a valkrets-level box could show a raw code instead of a name. This is a PR-2 concern (flag it in that plan), NOT a regression risk for THIS task, since `ResultPanel.tsx` (Task 7) always calls `useAreaView(valtyp, selectedArea)` with the SAME `valtyp` that `valkretsar` is already scoped to today — behavior is unchanged for the existing call site.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: green. (No standalone runtime test for this file — it is pure wiring with no logic of its own; `computeAreaView` is already tested in Task 3, and the wiring becomes observable once `ResultPanel.tsx` calls it in Task 7, where the real regression test lives.)

- [ ] **Step 3: Commit**

```bash
git add src/components/useAreaView.ts
git commit -m "Lägg till useAreaView-hooken (wiring runt computeAreaView)"
```

---

### Task 5: `src/components/AreaSelect.tsx` — områdesväljarens `<select>` som egen komponent

**Files:**
- Create: `src/components/AreaSelect.tsx`

**Interfaces:**
- Consumes: `LEVELS`, `PROMPT`, `areaFromSelectValue` from `@/lib/areaSelect` (Task 2); `useResults`, `defaultAreaFor`, `RIKET`, `Area` from `@/components/ResultsProvider`; `SEAT_CONFIG_2026` from `@/lib/seatConfig2026`; `Valtyp` from `@/lib/results`.
- Produces: `<AreaSelect valtyp={Valtyp} area={Area} onChange={(next: Area) => void} />` — a drop-in replacement for `ResultPanel.tsx`'s inline `<select>` (lines 419-476 in the pre-refactor source), used by Task 7 and, in PR 2, by `AreaSummary.tsx`.

- [ ] **Step 1: Write `src/components/AreaSelect.tsx`**

Copy the EXACT JSX from `ResultPanel.tsx`'s current `<select>` block (check the file's current line numbers first — this plan assumes the structure it had when the spec was written; if it's drifted, extract from whatever is there now) into this new component, replacing `valtyp`/`selectedArea`/`setSelectedArea` with the new props, and `levels`/`PROMPT` with the imports from `areaSelect.ts`:

```tsx
// Områdesväljarens <select>-markup som egen, återanvändbar komponent. Extraherad ur
// ResultPanel.tsx (samma JSX, oförändrad) så Dashboard-vyns fyra rutor kan ha VARSIN
// instans utan att röra den globala selectedArea. Hämtar referensdata (kommuner/
// regioner/valkretsar) själv via context — bara valtyp/area/onChange är instans-
// specifika. Se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md.
import { useMemo } from 'react'
import { RIKET, useResults, type Area } from '@/components/ResultsProvider'
import { LEVELS, PROMPT, areaFromSelectValue } from '@/lib/areaSelect'
import { SEAT_CONFIG_2026 } from '@/lib/seatConfig2026'
import type { Valtyp } from '@/lib/results'

export function AreaSelect({ valtyp, area, onChange }: { valtyp: Valtyp; area: Area; onChange: (next: Area) => void }) {
  const { kommuner, regioner, valkretsar } = useResults()
  const levels = LEVELS[valtyp]

  // Regionväljaren (RF) ska bara lista regioner som FAKTISKT har ett regionval —
  // Gotland saknar eget regionfullmäktige, se ResultPanel.tsx:228-232 (oförändrad logik).
  const regionerRF = useMemo(() => regioner.filter((r) => r.code in SEAT_CONFIG_2026.RF), [regioner])
  const regionName = useMemo(() => new Map(regioner.map((r) => [r.code, r.name])), [regioner])
  // Sortering på den FAKTISKT visade texten (RF-raden skriver "Region · Valkrets"),
  // se ResultPanel.tsx:240-248 (oförändrad logik).
  const valkretsarForSelect = useMemo(() => {
    const label = (v: (typeof valkretsar)[number]) => (valtyp === 'RF' ? `${regionName.get(v.code.slice(0, 2)) ?? ''} · ${v.name}` : v.name)
    return [...valkretsar].sort((a, b) => label(a).localeCompare(label(b), 'sv'))
  }, [valkretsar, valtyp, regionName])

  const selectValue = isPromptValue(area)
    ? ''
    : area.level === 'riket'
      ? 'riket'
      : area.level === 'distrikt'
        ? `d:${area.code}`
        : area.level === 'valkrets'
          ? `vk:${area.code}`
          : `${area.level === 'region' ? 'r' : 'k'}:${area.code}`

  return (
    <select
      className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100"
      value={selectValue}
      onChange={(e) => {
        const next = areaFromSelectValue(valtyp, e.target.value)
        if (next) onChange(next)
      }}
    >
      {area.level === 'distrikt' && <option value={`d:${area.code}`}>Distrikt: {area.code}</option>}
      {area.level === 'valkrets' && !levels.includes('valkrets') && (
        <option value={`vk:${area.code}`}>Valkrets: {area.code}</option>
      )}
      {levels.includes('riket') ? <option value="riket">Riket</option> : <option value="">{PROMPT[valtyp]}</option>}
      {levels.includes('region') && (
        <optgroup label="Region / län">
          {regionerRF.map((r) => (
            <option key={r.code} value={`r:${r.code}`}>{r.name}</option>
          ))}
        </optgroup>
      )}
      {levels.includes('valkrets') && (
        <optgroup label="Valkrets">
          {valkretsarForSelect.map((v) => (
            <option key={v.code} value={`vk:${v.code}`}>
              {valtyp === 'RF' ? `${regionName.get(v.code.slice(0, 2)) ?? ''} · ${v.name}` : v.name}
            </option>
          ))}
        </optgroup>
      )}
      {levels.includes('kommun') && (
        <optgroup label="Kommun">
          {kommuner.map((k) => (
            <option key={k.code} value={`k:${k.code}`}>{k.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

function isPromptValue(area: Area): boolean {
  return area.level !== 'riket' && area.code == null
}
```

**IMPORTANT correctness check for the implementer:** the original `ResultPanel.tsx` used the fully-resolved `areaName` (from the `view`/`nameOf` logic) for the two "synthetic current value" options (`Distrikt: {areaName}` / `Valkrets: {areaName}`, lines 437 and 442 in the pre-refactor source) — NOT the raw code. The snippet above uses `area.code` as a placeholder because `AreaSelect` doesn't have `areaName` computed (that lives in `useAreaView`'s result, a sibling piece of state). **Fix this before considering the task done**: either (a) accept `areaName` as an additional prop (`<AreaSelect valtyp area onChange areaName />`, passed from the caller's `useAreaView(...).areaName`), which is the recommended fix since `ResultPanel.tsx` already computes it via `useAreaView` before rendering `<AreaSelect>`, or (b) compute a local name lookup inside `AreaSelect` duplicating the relevant branches of `areaName` (not recommended — reintroduces the duplication this refactor is meant to avoid). Use (a). Update the prop signature, the JSX call site in Task 7, and re-verify the two synthetic-option scenarios (a selected district, and a KF valkrets not in the flat list) render the NAME, not the code, exactly as before.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: green after applying the `areaName` prop fix above.

- [ ] **Step 3: Commit**

```bash
git add src/components/AreaSelect.tsx
git commit -m "Extrahera områdesväljarens <select> till AreaSelect-komponenten"
```

---

### Task 6: `ValtypSelector.tsx` — valfria value/onChange-overrides

**Files:**
- Modify: `src/components/ValtypSelector.tsx` (full file, 66 rader — se nedan för hela den nya versionen)

**Interfaces:**
- Produces: `ValtypSelector({ className?, fill?, showColorMode?, value?: Valtyp, onChange?: (v: Valtyp) => void })` — when `value`/`onChange` are omitted, behavior is byte-identical to today (falls back to `useResults().valtyp`/`setValtyp`). Used by PR 2's `AreaSummary.tsx` with overrides; existing call sites (`DistrictMap.tsx:861`, `MobileChrome.tsx:178`) pass neither and are UNCHANGED.

- [ ] **Step 1: Write the new `src/components/ValtypSelector.tsx`**

```tsx
// Valtyp-väljaren (Riksdag / Region / Kommun) som EN delad, presentationslös komponent.
// Styr providerns delade `valtyp` → alla vyer (karta, panel, tavlor) följer med. På
// desktop bor väljaren kvar som en overlay inne i kartan; på mobil lyfts den ut i den
// persistenta toppchromen (så den nås från alla flikar, inte bara Karta-fliken).
//
// `value`/`onChange` (valfria): override:ar den GLOBALA valtyp/setValtyp — används av
// Dashboard-vyns rutor (varsin lokal valtyp, rör inte den globala). Utelämnas de (de två
// BEFINTLIGA anropsplatserna gör det) är beteendet IDENTISKT mot innan denna prop fanns.
import { GROUP_LEVEL_LABEL, VALTYPER, VALTYP_LABEL, type Valtyp } from '@/lib/results'
import { useResults } from '@/components/ResultsProvider'

// `showColorMode` lägger till Valdistrikt/Valkrets-Region-Kommun-läget i SAMMA ram —
// bara på desktop (kartöverlägget); mobilens smala toppchrome (fill) har inte plats
// och behåller bara valtyp-knapparna.
export function ValtypSelector({
  className = '',
  fill = false,
  showColorMode = false,
  value,
  onChange,
}: {
  className?: string
  fill?: boolean
  showColorMode?: boolean
  value?: Valtyp
  onChange?: (v: Valtyp) => void
}) {
  const { valtyp: globalValtyp, setValtyp: setGlobalValtyp, colorMode, setColorMode } = useResults()
  const valtyp = value ?? globalValtyp
  const setValtyp = onChange ?? setGlobalValtyp
  return (
    <div className={`flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-sm shadow-lg ${fill ? 'w-full' : 'mx-auto w-fit'} ${className}`}>
      {VALTYPER.map((vt) => (
        <button
          key={vt}
          type="button"
          onClick={() => setValtyp(vt)}
          className={`${fill ? 'flex-1' : ''} px-4 py-1.5 font-medium transition-colors ${
            vt === valtyp ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          {VALTYP_LABEL[vt]}
        </button>
      ))}
      {showColorMode && (
        <>
          <div className="w-px self-stretch bg-slate-600" aria-hidden="true" />
          <span className="flex shrink-0 items-center pl-2 pr-0.5 text-slate-500" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 2 8.5 5-8.5 5-8.5-5L12 2Z" />
              <path d="m3.5 12 8.5 5 8.5-5" />
              <path d="m3.5 17 8.5 5 8.5-5" />
            </svg>
          </span>
          <button
            type="button"
            onClick={() => setColorMode('distrikt')}
            title="Färglägg varje valdistrikt efter sin egen vinnare"
            className={`px-3 py-1.5 font-medium transition-colors ${
              colorMode === 'distrikt' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Valdistrikt
          </button>
          <button
            type="button"
            onClick={() => setColorMode('grupp')}
            title={`Färglägg efter ${GROUP_LEVEL_LABEL[valtyp].toLowerCase()}ens sammanlagda vinnare, oavsett enskilda valdistrikt`}
            className={`px-3 py-1.5 font-medium transition-colors ${
              colorMode === 'grupp' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {GROUP_LEVEL_LABEL[valtyp]}
          </button>
        </>
      )}
    </div>
  )
}
```

(Only the function signature and the `valtyp`/`setValtyp` derivation at the top changed — everything else, including `showColorMode`'s JSX, is byte-identical to the current file.)

- [ ] **Step 2: Verify existing call sites are untouched**

Run: `grep -n "ValtypSelector" src/components/DistrictMap.tsx src/components/mobile/MobileChrome.tsx`
Expected: `<ValtypSelector showColorMode />` and `<ValtypSelector fill />` — neither passes `value`/`onChange`, confirming they take the fallback path unchanged.

- [ ] **Step 3: Typecheck/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/components/ValtypSelector.tsx
git commit -m "ValtypSelector: valfria value/onChange-overrides (för Dashboard-vyns rutor)"
```

---

### Task 7: Rewire `ResultPanel.tsx` — kritisk task, hela nollregression-kravet vilar här

**Files:**
- Modify: `src/components/ResultPanel.tsx` (se detaljerad diff-beskrivning nedan)

**Interfaces:**
- Consumes: `useAreaView` (Task 4), `AreaSelect` (Task 5, with the `areaName` prop fix applied).
- Produces: `ResultPanel` renders IDENTICALLY to `main`, but its internals now call the shared pieces.

- [ ] **Step 1: Capture a BASELINE from `main` BEFORE making any of the above changes visible to the running app**

This step must happen on a clean checkout of `main` (or by stashing all Task 1-6 work) — the whole point is a snapshot of TODAY's behavior to diff against later.

```bash
git stash
npm run dev -- --port 5173 --strictPort &
```
Wait for `curl -sf http://localhost:5173` to succeed, then run this Playwright script (copy it into the repo root temporarily so `node_modules` resolves, per this repo's established scratch-script pattern — see e.g. earlier session's `check-boards.mjs`):

```js
// capture-resultpanel-baseline.mjs — snapshot key ResultPanel DOM text across
// representative (valtyp, area) scenarios, for a later before/after diff.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const SCENARIOS = [
  { label: 'RD-riket', clickValtyp: 'Riksdag', selectLabel: null },
  { label: 'RF-prompt', clickValtyp: 'Region', selectLabel: null },
  { label: 'RF-region', clickValtyp: 'Region', selectIndex: 2 },
  { label: 'KF-kommun', clickValtyp: 'Kommun', selectLabel: 'Trollhättan' },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto('http://localhost:5173')
await page.waitForSelector('aside select')

const snapshot = {}
for (const s of SCENARIOS) {
  await page.click(`button:has-text("${s.clickValtyp}")`)
  await page.waitForTimeout(150)
  if (s.selectLabel) await page.selectOption('aside select', { label: s.selectLabel })
  if (s.selectIndex != null) await page.selectOption('aside select', { index: s.selectIndex })
  await page.waitForTimeout(200)
  snapshot[s.label] = {
    asideText: (await page.locator('aside').innerText()).trim(),
    selectValue: await page.locator('aside select').inputValue(),
  }
}
writeFileSync('resultpanel-baseline.json', JSON.stringify(snapshot, null, 2))
console.log('Baseline written to resultpanel-baseline.json')
await browser.close()
```

```bash
node capture-resultpanel-baseline.mjs
# stoppa dev-servern (lsof -ti:5173 -sTCP:LISTEN | xargs -r kill), ta bort scriptet
git stash pop
```

Keep `resultpanel-baseline.json` around (outside git, it's a scratch artifact) — you'll diff against it in Step 4.

- [ ] **Step 2: Rewrite `ResultPanel.tsx`**

Apply these changes to the CURRENT `src/components/ResultPanel.tsx` (re-read it first — Tasks 1-6 didn't touch it, but another session may have; if it's drifted from what this plan assumes, adapt the same MECHANICAL substitution to whatever the current file actually contains):

1. Add imports: `import { useAreaView } from '@/components/useAreaView'` and `import { AreaSelect } from '@/components/AreaSelect'`.
2. Remove the now-duplicated local `LEVELS`/`PROMPT` consts and `MANDAT_LEVELS` const (moved to `areaSelect.ts`/`areaView.ts` in Tasks 2-3) — but only if nothing else in the file still uses them; `levels` (line ~402, used for `!levels.includes('valkrets')`) is now DELETED along with the whole `<select>` block it supported (see point 4).
3. Replace the block computing `prog`/`statusTag`, `blocks`, `areaIndex`/`showMandat`, `areaName`, and the entire `view = useMemo(...)` block (everything computed from `valtyp`/`selectedArea` that duplicates `computeAreaView`) with:
   ```tsx
   const av = useAreaView(valtyp, selectedArea)
   ```
   Every downstream reference to the removed locals becomes `av.<field>` (e.g. `view.giltiga` → `av.giltiga`, `blocks` → `av.blocks`, `areaName` → `av.areaName`, `showMandat` → `av.showMandat`, `pct` → `av.pct`, `statusTag` → `av.statusTag`). `areaIndex` (still needed separately for `ancestorsOf(valtyp, selectedArea, areaIndex)` in the breadcrumb/drill code, which is NOT part of the extraction) stays as its own line: `const areaIndex = areaIndexRef.current[valtyp]`.
4. Replace the `<select>...</select>` JSX block with:
   ```tsx
   <AreaSelect valtyp={valtyp} area={selectedArea} areaName={av.areaName} onChange={setSelectedArea} />
   ```
   (matching whatever final prop name Task 5's fix settled on for the synthetic-option display name).
5. Leave EVERYTHING ELSE — breadcrumb (`crumbs`), `drill` useMemo, the "Bryt ner" table, `isPrompt`, `sortCol`, the RD-riksnivå note — completely untouched, just reading `av.*` where it used to read local variables.

- [ ] **Step 3: Typecheck/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green. Fix any leftover reference to a removed local (the compiler will point these out precisely).

- [ ] **Step 4: Re-run the SAME Playwright scenarios against the branch and diff against the baseline**

```bash
npm run dev -- --port 5173 --strictPort &
```
Wait for it to be ready, run the SAME `capture-resultpanel-baseline.mjs` script (copy it back in) but write to `resultpanel-after.json` instead, then:

```bash
node -e "
const fs = require('fs')
const before = JSON.parse(fs.readFileSync('resultpanel-baseline.json', 'utf8'))
const after = JSON.parse(fs.readFileSync('resultpanel-after.json', 'utf8'))
let ok = true
for (const key of Object.keys(before)) {
  const same = JSON.stringify(before[key]) === JSON.stringify(after[key])
  console.log(same ? 'OK ' : 'FEL', key)
  if (!same) { ok = false; console.log('  before:', before[key]); console.log('  after: ', after[key]) }
}
process.exit(ok ? 0 : 1)
"
```
Expected: `OK` for every scenario, exit 0. If any scenario differs, STOP — this is the hard-requirement gate. Diagnose the discrepancy (compare the exact JSX/logic between the old `ResultPanel.tsx` and the new extraction) before proceeding; do not weaken the assertion to make it pass.

- [ ] **Step 5: Also manually re-verify the two things the scripted diff doesn't cover well**

- "Bryt ner" table: click a row, sort by a party column (three-click cycle: desc → asc → alphabetical) — behavior unchanged (this code path wasn't touched, but confirm `av.*`-sourced values it reads, like nothing — `drill` doesn't consume `av` at all, so this is a low-risk confirmation, not a deep test).
- URL round-trip: pick `?val=KF&omrade=kommun:1488` directly in the address bar, confirm the panel renders Trollhättan exactly as before (proves `AreaSelect`'s `selectValue` derivation and the synthetic-option fix from Task 5 work for a directly-loaded URL, not just via clicks).

- [ ] **Step 6: Clean up scratch files, commit**

```bash
rm -f capture-resultpanel-baseline.mjs resultpanel-baseline.json resultpanel-after.json
git add src/components/ResultPanel.tsx
git commit -m "ResultPanel: använd useAreaView/AreaSelect i stället för inline-logik (ingen beteendeändring)"
```

---

### Task 8: Dokumentation + PR

**Files:**
- Modify: `CLAUDE.md`, `README.md` (only if `README.md` exists and documents features/architecture — check first: `ls README.md`)

**Interfaces:** None (docs only).

- [ ] **Step 1: Update CLAUDE.md**

Read the current `CLAUDE.md`. If it lists key components/architecture (it currently doesn't enumerate individual component files, per the version read at plan-writing time — it's high-level), add a short note under an appropriate existing section (or a new one) mentioning that `useAreaView`/`AreaSelect` are the shared building blocks behind both the map+panel view and (once PR 2 lands) the Dashboard view, so future readers don't duplicate this logic a third time. Keep it to 2-4 lines — CLAUDE.md is guidance, not an architecture doc (that's `docs/arkitektur.md`).

- [ ] **Step 2: Update README.md if it exists and describes features**

Run: `ls README.md 2>/dev/null && grep -c "ResultPanel\|Dashboard\|funktion" README.md 2>/dev/null`
If it exists and has a features/screenshot section, this PR itself has NO user-visible change (pure refactor) — likely nothing to update here for PR 1. Note in the PR description that PR 2 (the actual Dashboard feature) will be the one that updates README's feature list/screenshots. If README already inaccurately describes ResultPanel's internals in a way this refactor invalidates, fix that; otherwise skip.

- [ ] **Step 3: Final full verification**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin refactor/dashboard-vy-extract-areaview
gh pr create --title "Refaktor: extrahera useAreaView/AreaSelect ur ResultPanel (PR 1/2, Dashboard-vy)" --body "$(cat <<'EOF'
## Sammanfattning
Förberedande refaktor för Dashboard-vyn (docs/superpowers/specs/2026-09-12-dashboard-vy-design.md). Extraherar ResultPanel.tsx:s mandat/röster/valdeltagande-beräkning (`computeAreaView`/`useAreaView`) och områdesväljarens `<select>` (`AreaSelect`) till delade, parametriserade byggstenar. ResultPanel.tsx själv beter sig IDENTISKT mot main — se testplan.

Lägger även till valfria `value`/`onChange`-overrides på `ValtypSelector` (additiv, befintliga anropsplatser opåverkade).

Ingen ny funktionalitet i denna PR — det är PR 1 av 2, se spec-dokumentet. PR 2 bygger själva Dashboard-rutnätet ovanpå detta.

## Testplan
- `scripts/verify-area-select.ts`, `scripts/verify-area-view.ts` — gröna.
- Playwright-diff: samma scenarier (RD/riket, RF-prompt, RF/region, KF/kommun) körda mot main FÖRE och branchen EFTER — identisk renderad text i samtliga.
- Manuell koll: Bryt ner-tabellen (klick, sortering), URL-direktladdning (?val=KF&omrade=kommun:1488).
- tsc/lint/build gröna.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01PdemLe5G78J5SY5ctGs3U5
EOF
)"
```

- [ ] **Step 5: Wait for CI, report status**

Run: `gh pr checks <PR number>` (poll until not pending).
Report the PR URL and CI status; do not merge without explicit "merge" from Lars, per this session's normal (non-hotfix) merge workflow.

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** This plan covers spec sections "Extraktion ur ResultPanel.tsx" (points 1-5) fully. It deliberately does NOT cover points 6-9 (AreaSummary, DashboardGrid, ResultsProvider dashboard state, URL schema, the view toggle in App.tsx) — those are PR 2, per the spec's own "Leveransplan" section, and need their own plan once this one is merged and verified in prod.
- **Drift risk:** This plan was written against a specific read of `ResultPanel.tsx`/`ValtypSelector.tsx` on 2026-09-12. This is a live repo with many parallel sessions — RE-READ the current file before Task 7 specifically, since it's the highest-stakes task, and reconcile any drift before applying the mechanical substitution.
- **The `AreaSelect` areaName issue (Task 5)** is flagged inline as a required fix, not a footnote — do not skip it; without it, the two synthetic-option code paths (selected district, KF valkrets outside the flat list) would show a raw code instead of a name, which IS a regression.
