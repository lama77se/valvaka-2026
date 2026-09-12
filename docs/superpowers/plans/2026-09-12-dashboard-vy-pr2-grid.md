# Dashboard-vy PR 2: fyra oberoende resultatrutor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the actual Dashboard view — a desktop-only, 4-box grid where each box independently picks its own valtyp + område, toggled via a new always-visible header bar next to the existing karta+panel view. Built entirely on top of PR 1 (`useAreaView`/`AreaSelect`, already merged to `main`), with the same hard requirement: **zero regression to the existing karta+panel view**.

**Architecture:** Two new leaf components (`AreaSummary` = one box's full content, `DashboardGrid` = 4× `AreaSummary` in a 2×2 layout) sit beside the existing `DistrictMap`/`aside`/`ResultPanel` tree in `App.tsx`, switched by a new `view: 'karta' | 'dashboard'` piece of state. The Dashboard's 4-box state lives in `ResultsProvider` (survives the grid unmounting when you toggle back to Karta) and round-trips through an additive URL query-string extension, mirroring the existing `valtyp`/`selectedArea` pattern exactly. One prerequisite bugfix (Task 1) closes a latent per-valtyp-scoping gap in two PR-1 files that only matters once a component is used with a valtyp OTHER than the globally active one — exactly what Dashboard boxes do.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind. No test framework — this repo's `scripts/verify-*.ts` (`tsx`, plain `check()` helper) convention for pure-logic tests, Playwright (scratch scripts, not committed) for browser-level regression/functional proof, exactly as PR 1 did.

**Spec:** `docs/superpowers/specs/2026-09-12-dashboard-vy-design.md` — this plan implements spec sections 6-9 + URL schema + testplan points 2-4 (PR 1 already implemented sections 1-5 + testplan point 1).

## Global Constraints

- **HARD REQUIREMENT (spec): zero regression in the existing map+panel view.** This PR is additive — every existing scenario in Karta mode (valtyp/area switching, Bryt ner, Ogiltiga röster, mandate display, URL sharing) must render identically to before. The only change to Karta mode's own code is a vertical repositioning of `<aside>` (see Task 5) — `ResultPanel.tsx`, `DistrictMap.tsx` internals are NOT touched by this plan.
- **Decided in this session, binding:**
  - Extraction approach already settled in PR 1 (shared hook, not duplicated logic) — this PR just consumes `useAreaView`/`AreaSelect`, doesn't re-litigate that.
  - **Dashboard mode hides the avgångstavlor (ticker) column too**, not just `DistrictMap`/`aside` — a clean full-screen swap under the always-visible header toggle bar. (Decided to avoid the ticker column visually overlapping and stealing clicks from the top-left grid box — see Task 5.)
  - Default dashboard state (no URL params): all 4 boxes → RD/Riket (spec's own default).
  - No breadcrumb, no "Bryt ner" in dashboard boxes (spec's own scope decision).
  - MandatBars always renders with `compact` in dashboard boxes (spec's own decision) — this plan additionally applies the SAME compact wording to the subtitle/turnout text in each box (not explicitly specified by the spec, but the natural extension of "narrow column" to the box's other width-sensitive text; flagged here as this plan's own assumption, not blocking).
- Never `git commit` directly on `main` — feature branch + PR + CI green + explicit "merge" from Lars before merging (this PR's changes touch client UI/state only, no edge/migration/data-path — but this session's normal, non-hotfix workflow still asks first). Branch: `feat/dashboard-vy-grid`, in an isolated worktree per `superpowers:using-git-worktrees`.
- Svenska i kommentarer/docs.
- Run `npx tsc --noEmit`, `npm run lint`, `npm run build` after every task — all three green throughout.
- No new npm dependencies.
- **This plan was written against `main` at commit `9482ce3` (PR 1, merged).** Re-read any file before editing it — this is a live, multi-session repo; if a file has drifted from what a task assumes, adapt the same intent to the current source rather than blindly applying a stale snippet.

---

### Task 1: Fix `valkretsar` per-valtyp scoping in `useAreaView.ts` and `AreaSelect.tsx`

**Files:**
- Modify: `src/components/useAreaView.ts`
- Modify: `src/components/AreaSelect.tsx`

**Interfaces:** No signature changes — both components' public props/exports stay identical. Only their INTERNAL sourcing of valkrets names changes.

**Why this is a prerequisite, not a nice-to-have:** `ResultsContextValue.valkretsar` (see `src/components/ResultsProvider.tsx`, the line reading `valkretsar: valkretsListRef.current[valtyp]` near the end of the provider body) is scoped to the GLOBALLY ACTIVE `valtyp` — it's documented as such in `ResultsContextValue`'s own comment: `// valkretsar för AKTIV valtyp (RD 29 / RF 62; KF tom)`. Both `useAreaView` and `AreaSelect` currently destructure this `valkretsar` field directly from `useResults()` and use it regardless of their OWN `valtyp` parameter/prop. This is harmless for `ResultPanel.tsx` (PR 1's only caller), which always calls both with the SAME `valtyp` that's globally active. But Dashboard boxes call both with a LOCAL `valtyp` that can differ from the active one — in that case, a box showing e.g. a valkrets-level area under RF while the globally active valtyp is KF would silently get RF's valkretsar from the WRONG active-valtyp list (or an empty/wrong one), producing an incorrect `areaName` (a raw code shown instead of a name) and a wrong/missing "Valkrets" `<optgroup>` in that box's selector. `valkretsListRef` (`ResultsContextValue.valkretsListRef: RefObject<Record<Valtyp, NamedCode[]>>`) already exists for exactly this — its own comment says so: `// valkrets-namn PER valtyp (avgångstavlan visar en annan valtyp än den aktiva)`. `src/components/DepartureBoard.tsx` already solves this identical problem correctly — mirror its pattern exactly:
```ts
const valkretsName = useMemo(
  () => new Map((valkretsListRef.current[valtyp] ?? []).map((v) => [v.code, v.name])),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [valtyp, snapshotVersion],
)
```

- [ ] **Step 1: Write a verify script proving the bug exists, then that the fix closes it**

Create `scripts/verify-area-view-multivaltyp.ts`:
```ts
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
```

- [ ] **Step 2: Run it to confirm it passes as-is (it's testing the already-correct pure function, not the buggy wiring)**

Run: `npx tsx scripts/verify-area-view-multivaltyp.ts`
Expected: `Alla kontroller OK.` — this script proves `computeAreaView` itself is fine; the bug is purely in `useAreaView.ts`/`AreaSelect.tsx` NOT PASSING the right list. This test documents the contract those two files must uphold — it doesn't exercise them directly (they're React components/hooks, harder to unit test standalone; the REAL proof for them is Task 6's Playwright pass with two boxes on different valtypar).

- [ ] **Step 3: Fix `src/components/useAreaView.ts`**

Read the current file. Change the destructure from `useResults()` to include `valkretsListRef` and `snapshotVersion` instead of `valkretsar`:
```ts
// React-wiring runt computeAreaView (src/lib/areaView.ts): hämtar de globala,
// valtyp-oberoende referensdata-refarna ur ResultsProvider och memoiserar om på
// samma beroenden som ResultPanel.tsx:s view-useMemo gjorde innan extraktionen
// (valtyp, area, revision — se computeAreaView-anropet nedan). Both ResultPanel
// (globalt state) och Dashboard-vyns rutor (lokalt state per ruta) anropar denna
// med SINA respektive valtyp/area — datan (storesRef m.fl.) är gemensam.
//
// valkretsListRef (INTE context-fältet `valkretsar`, som bara täcker den GLOBALT
// AKTIVA valtypen): Dashboard-rutorna anropar denna hook med SIN EGEN valtyp, som
// kan skilja sig från den aktiva — samma mönster som DepartureBoard.tsx redan
// löser problemet med (se dess `valkretsName`-useMemo).
import { useMemo } from 'react'
import { useResults, type Area } from '@/components/ResultsProvider'
import { computeAreaView, type AreaViewResult } from '@/lib/areaView'
import type { Valtyp } from '@/lib/results'

export function useAreaView(valtyp: Valtyp, area: Area): AreaViewResult {
  const {
    storesRef, turnoutStoresRef, allCodesRef, metaRef, partyRef, groupsRef, uppsamlingRef,
    areaIndexRef, comparisonRef, district2022Ref, kommuner, regioner, valkretsListRef,
    distriktNamnRef, revision, snapshotVersion,
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
        valkretsar: valkretsListRef.current[valtyp] ?? [],
        distriktNamn: distriktNamnRef.current,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valtyp, area, revision, snapshotVersion, kommuner, regioner],
  )
}
```
(Only the `valkretsar` field's source, the destructure list, and the deps array changed — everything else is identical to the current file. Re-read the CURRENT file before applying this — if it has drifted, apply the same substitution to whatever's actually there.)

- [ ] **Step 4: Fix `src/components/AreaSelect.tsx`**

Read the current file. Change the destructure and the `valkretsarForSelect` useMemo:
```ts
// (top comment: add a line noting valkretsListRef is used instead of the
// active-valtyp-scoped `valkretsar`, same reasoning as useAreaView.ts)
import { useMemo } from 'react'
import { useResults, type Area } from '@/components/ResultsProvider'
import { LEVELS, PROMPT, areaFromSelectValue } from '@/lib/areaSelect'
import { SEAT_CONFIG_2026 } from '@/lib/seatConfig2026'
import type { Valtyp } from '@/lib/results'

export function AreaSelect({
  valtyp,
  area,
  areaName,
  onChange,
}: {
  valtyp: Valtyp
  area: Area
  areaName: string
  onChange: (next: Area) => void
}) {
  const { kommuner, regioner, valkretsListRef, snapshotVersion } = useResults()
  const levels = LEVELS[valtyp]

  const regionerRF = useMemo(() => regioner.filter((r) => r.code in SEAT_CONFIG_2026.RF), [regioner])
  const regionName = useMemo(() => new Map(regioner.map((r) => [r.code, r.name])), [regioner])
  const valkretsarForSelect = useMemo(() => {
    const valkretsar = valkretsListRef.current[valtyp] ?? []
    const label = (v: (typeof valkretsar)[number]) => (valtyp === 'RF' ? `${regionName.get(v.code.slice(0, 2)) ?? ''} · ${v.name}` : v.name)
    return [...valkretsar].sort((a, b) => label(a).localeCompare(label(b), 'sv'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valtyp, regionName, snapshotVersion])
```
(Everything below `valkretsarForSelect` — the JSX, `isPrompt`/`selectValue`, `onChange` handler — is UNCHANGED. `kommuner` stays sourced from context directly since it's valtyp-INDEPENDENT (all 290 kommuner regardless of valtyp) — only `valkretsar` was ever active-valtyp-scoped.)

- [ ] **Step 5: Typecheck/lint/build + re-run the verify script**

Run: `npx tsc --noEmit && npm run lint && npm run build && npx tsx scripts/verify-area-view-multivaltyp.ts`
Expected: all green.

- [ ] **Step 6: Manual regression check — this fix must NOT change ResultPanel.tsx's own behavior**

Since `ResultPanel.tsx` always calls both with the globally-active `valtyp`, and `valkretsListRef.current[valtyp]` for the ACTIVE valtyp is exactly what the old `valkretsar` context field already computed (`valkretsar: valkretsListRef.current[valtyp]` — see `ResultsProvider.tsx`'s context-value construction), this is a like-for-like substitution for the existing call site. Confirm with a quick dev-server check: load the app, pick a valkrets-level area under RD (a läns-valkrets, e.g. via the map/drill), confirm the name still shows correctly in `ResultPanel`'s area selector and title — exactly as before this fix.

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/dashboard-vy-grid
git add src/components/useAreaView.ts src/components/AreaSelect.tsx scripts/verify-area-view-multivaltyp.ts
git commit -m "Fixa valkretsar-per-valtyp-scoping i useAreaView/AreaSelect (förberedelse för Dashboard-rutor med egen valtyp)"
```

---

### Task 2: `ResultsProvider.tsx` — Dashboard-state + URL-schema

**Files:**
- Modify: `src/components/ResultsProvider.tsx`

**Interfaces:**
- Produces on `ResultsContextValue`: `view: 'karta' | 'dashboard'`, `setView: (v: 'karta' | 'dashboard') => void`, `dashboardBoxes: DashboardBox[]` (fixed length 4), `setDashboardBox: (i: number, box: DashboardBox) => void`.
- Produces exported types: `export type ViewMode = 'karta' | 'dashboard'`, `export type DashboardBox = { valtyp: Valtyp; area: Area }`.
- Consumed by: Task 3 (`AreaSummary.tsx` indirectly via `DashboardGrid`), Task 4 (`DashboardGrid.tsx`), Task 5 (`App.tsx`).

- [ ] **Step 1: Write a verify script for the URL read/write logic (pure functions, testable without React)**

Read the CURRENT `src/components/ResultsProvider.tsx` fully first — you'll be adding a new URL-parsing function alongside the existing `parseAreaParam`/`readViewFromUrl`/`viewToSearch` (currently around lines 74-101), and this script imports it directly.

Create `scripts/verify-dashboard-url.ts`:
```ts
// Validerar dashboard-URL-schemat (readDashboardFromUrl / dashboardToSearch) i
// ResultsProvider.tsx — additivt till val=/omrade= (oförändrat, se PR 1), bara
// närvarande när vy=dashboard. Körs mot en global.window-stub (samma mönster
// som readViewFromUrl redan hanterar för SSR/no-window via typeof window check —
// här körs det ALLTID i Node, så vi stubbar window.location.search manuellt).
//   npx tsx scripts/verify-dashboard-url.ts
import { readDashboardFromUrl, dashboardToSearch } from '../src/components/ResultsProvider.tsx'
import { defaultAreaFor } from '../src/lib/area.ts'

let ok = true
const check = (pass: boolean, label: string, extra = '') => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}${extra ? ` — ${extra}` : ''}`) }

// Stub window.location.search för varje test-case (Node har inget `window`).
function withSearch<T>(search: string, fn: () => T): T {
  ;(globalThis as { window?: unknown }).window = { location: { search } }
  try {
    return fn()
  } finally {
    delete (globalThis as { window?: unknown }).window
  }
}

// 1) Inga parametrar alls → karta-läge, alla 4 rutor default RD/Riket.
withSearch('', () => {
  const { view, boxes } = readDashboardFromUrl()
  check(view === 'karta', 'inga params → view=karta', view)
  check(boxes.length === 4, 'exakt 4 rutor', String(boxes.length))
  check(boxes.every((b) => b.valtyp === 'RD' && JSON.stringify(b.area) === JSON.stringify(defaultAreaFor('RD'))), 'alla 4 rutor default RD/Riket', JSON.stringify(boxes))
})

// 2) vy=dashboard utan p/a-parametrar → dashboard-läge, ändå default-rutor.
withSearch('?vy=dashboard', () => {
  const { view, boxes } = readDashboardFromUrl()
  check(view === 'dashboard', 'vy=dashboard läses', view)
  check(boxes.every((b) => b.valtyp === 'RD'), 'saknade p/a-par → RD-default per ruta')
})

// 3) Fullt exempel ur specen.
withSearch('?vy=dashboard&p1=RD&a1=riket&p2=RD&a2=region:21&p3=RF&a3=region:21&p4=KF&a4=kommun:2104', () => {
  const { view, boxes } = readDashboardFromUrl()
  check(view === 'dashboard', 'view=dashboard')
  check(JSON.stringify(boxes[0]) === JSON.stringify({ valtyp: 'RD', area: { level: 'riket', code: null } }), 'ruta 1: RD/Riket', JSON.stringify(boxes[0]))
  check(JSON.stringify(boxes[1]) === JSON.stringify({ valtyp: 'RD', area: { level: 'region', code: '21' } }), 'ruta 2: RD/region 21', JSON.stringify(boxes[1]))
  check(JSON.stringify(boxes[2]) === JSON.stringify({ valtyp: 'RF', area: { level: 'region', code: '21' } }), 'ruta 3: RF/region 21', JSON.stringify(boxes[2]))
  check(JSON.stringify(boxes[3]) === JSON.stringify({ valtyp: 'KF', area: { level: 'kommun', code: '2104' } }), 'ruta 4: KF/kommun 2104', JSON.stringify(boxes[3]))
})

// 4) dashboardToSearch: karta-läge → tom sträng (inga dashboard-parametrar skrivs).
check(dashboardToSearch('karta', [
  { valtyp: 'RD', area: defaultAreaFor('RD') }, { valtyp: 'RD', area: defaultAreaFor('RD') },
  { valtyp: 'RD', area: defaultAreaFor('RD') }, { valtyp: 'RD', area: defaultAreaFor('RD') },
]) === '', 'dashboardToSearch(karta, ...) → tom sträng (inga vy=/p/a-parametrar i kartläge)')

// 5) dashboardToSearch: dashboard-läge → hela strängen, samma exempel som (3), rundtripp.
const roundTrip = dashboardToSearch('dashboard', [
  { valtyp: 'RD', area: { level: 'riket', code: null } },
  { valtyp: 'RD', area: { level: 'region', code: '21' } },
  { valtyp: 'RF', area: { level: 'region', code: '21' } },
  { valtyp: 'KF', area: { level: 'kommun', code: '2104' } },
])
check(roundTrip.startsWith('vy=dashboard&'), 'dashboardToSearch börjar med vy=dashboard&', roundTrip)
withSearch(`?${roundTrip}`, () => {
  const { view, boxes } = readDashboardFromUrl()
  check(view === 'dashboard', 'rundtripp: view=dashboard')
  check(JSON.stringify(boxes[2]) === JSON.stringify({ valtyp: 'RF', area: { level: 'region', code: '21' } }), 'rundtripp: ruta 3 överlever skriv→läs', JSON.stringify(boxes[2]))
})

console.log(ok ? '\nAlla kontroller OK.' : '\nMinst en kontroll FEL.')
process.exit(ok ? 0 : 1)
```

**Note for the implementer:** `ResultsProvider.tsx` imports `supabase.ts` (Vite `import.meta.env`), same issue Task 2 of PR 1 hit. This verify script imports directly from `ResultsProvider.tsx`, so running it under plain `tsx` WILL crash unless `readDashboardFromUrl`/`dashboardToSearch` are written as pure functions with NO transitive dependency on anything that touches `import.meta.env` at module scope. Check: does importing `ResultsProvider.tsx` for just these two named exports still execute the whole module top-level (including its `import { supabase } from '@/lib/supabase'`)? Yes — ES module imports execute the WHOLE module. **If this crashes**, the fix is the same pattern as PR 1 Task 2: move `readDashboardFromUrl`/`dashboardToSearch` (and the `parseAreaParam`/`AREA_LEVELS`-adjacent logic they need) into a new, supabase-free module — e.g. `src/lib/dashboardUrl.ts` — and have `ResultsProvider.tsx` import from there, mirroring exactly how `src/lib/area.ts` was extracted in PR 1. Try running the verify script FIRST (Step 2) before writing extensive code — if it crashes with an `import.meta.env` error, do the extraction proactively rather than debugging around it; do not skip this check and assume it will "probably be fine."

- [ ] **Step 2: Run it to verify it fails (module doesn't exist yet) — and check for the import.meta.env crash risk immediately**

Run: `npx tsx scripts/verify-dashboard-url.ts`
Expected: FAIL — `readDashboardFromUrl is not exported` (or similar). If instead you see an `import.meta.env`/Vite-related crash, that confirms the note above — extract to `src/lib/dashboardUrl.ts` from the start rather than writing the functions directly in `ResultsProvider.tsx` first and discovering the crash later.

- [ ] **Step 3: Add the new state, types, and URL functions to `ResultsProvider.tsx`** (or to `src/lib/dashboardUrl.ts` if Step 2 required the extraction — adjust import paths accordingly throughout this task if so)

Add near the top, alongside the existing `AREA_LEVELS`/`parseAreaParam` (read the CURRENT file to place these correctly relative to what's there):
```ts
export type ViewMode = 'karta' | 'dashboard'
export type DashboardBox = { valtyp: Valtyp; area: Area }
const DASHBOARD_BOX_COUNT = 4

function encodeAreaParam(area: Area): string {
  return `${area.level}${area.code ? ':' + encodeURIComponent(area.code) : ''}`
}

// Dashboard-vyns fyra-rutors-state ur URL:en — additivt till val=/omrade= (se
// readViewFromUrl/viewToSearch, oförändrade): bara vy=dashboard&p1=..&a1=.. osv
// existerar när Dashboard-läget är aktivt. Saknas ett pN/aN-par (första besöket)
// → den rutan defaultar till RD/Riket (samma defaultAreaFor-fallback som
// parseAreaParam redan ger vid saknad/ogiltig kod).
export function readDashboardFromUrl(): { view: ViewMode; boxes: DashboardBox[] } {
  if (typeof window === 'undefined') {
    return { view: 'karta', boxes: Array.from({ length: DASHBOARD_BOX_COUNT }, () => ({ valtyp: 'RD' as Valtyp, area: defaultAreaFor('RD') })) }
  }
  const q = new URLSearchParams(window.location.search)
  const view: ViewMode = q.get('vy') === 'dashboard' ? 'dashboard' : 'karta'
  const boxes: DashboardBox[] = Array.from({ length: DASHBOARD_BOX_COUNT }, (_, i) => {
    const n = i + 1
    const rawValtyp = (q.get(`p${n}`) ?? '').toUpperCase()
    const valtyp: Valtyp = (VALTYPER as readonly string[]).includes(rawValtyp) ? (rawValtyp as Valtyp) : 'RD'
    const area = parseAreaParam(q.get(`a${n}`), valtyp)
    return { valtyp, area }
  })
  return { view, boxes }
}

// Bara p1/a1..p4/a4 (utan ledande "&") — inget vy=dashboard-prefix och ingen tom
// sträng när view==='karta' (dashboard-parametrarna ska inte synas alls i
// kartläget, per specens "samexisterar med, inte ersätter"-krav).
export function dashboardToSearch(view: ViewMode, boxes: DashboardBox[]): string {
  if (view !== 'dashboard') return ''
  const parts = boxes.flatMap((b, i) => [`p${i + 1}=${b.valtyp}`, `a${i + 1}=${encodeAreaParam(b.area)}`])
  return `vy=dashboard&${parts.join('&')}`
}
```
(`parseAreaParam`, `defaultAreaFor`, `VALTYPER`, `Valtyp`, `Area` are already imported/defined in this file — no new imports needed beyond what's already there, UNLESS Step 2 required the `src/lib/dashboardUrl.ts` extraction, in which case duplicate only the minimal imports that file needs: `Level`/`Valtyp`/`Area`/`defaultAreaFor`/`VALTYPER`, and have it export `parseAreaParam`-equivalent logic too if `ResultsProvider.tsx`'s own `parseAreaParam` can't be cleanly shared — check whether `parseAreaParam` itself has any supabase-adjacent dependency; it shouldn't, since it only touches `Area`/`Level`/`defaultAreaFor`, all supabase-free, so it CAN be imported/reused directly even if pulled into a new file — the crash risk is specifically about importing FROM `ResultsProvider.tsx`, not about `parseAreaParam`'s own logic.)

- [ ] **Step 4: Add the new provider state**

In `ResultsProvider` function body, right after the existing `colorMode`/`lastAreaByValtyp`/`setValtyp` block and BEFORE the existing URL-write `useEffect` (read the current file to place this correctly — it needs to exist before that effect since the effect will be extended to include it):
```ts
  // Dashboard-vyns läge + fyra-rutors-state. Helt separat från valtyp/selectedArea
  // ovan (spec: "rör inte den globala selectedArea/valtyp") — en egen ruta väljer
  // fritt sin egen valtyp+område, aldrig kopplad till kartlägets state.
  const [view, setView] = useState<ViewMode>(() => readDashboardFromUrl().view)
  const [dashboardBoxes, setDashboardBoxes] = useState<DashboardBox[]>(() => readDashboardFromUrl().boxes)
  const setDashboardBox = useCallback((i: number, box: DashboardBox) => {
    setDashboardBoxes((prev) => prev.map((b, idx) => (idx === i ? box : b)))
  }, [])
```

- [ ] **Step 5: Extend the existing URL-write effect**

Find the current effect:
```ts
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname + viewToSearch(valtyp, selectedArea, colorMode) + window.location.hash)
  }, [valtyp, selectedArea, colorMode])
```
Replace with (combining the two query-string parts correctly regardless of which is empty — see the inline comment):
```ts
  useEffect(() => {
    const base = viewToSearch(valtyp, selectedArea, colorMode) // '' or '?val=...'
    const dash = dashboardToSearch(view, dashboardBoxes) // '' or 'vy=dashboard&p1=...'
    // base starts with '?' (or is ''); dash has no leading punctuation (or is '').
    // Combine correctly whichever combination is present:
    const search = base ? (dash ? `${base}&${dash}` : base) : dash ? `?${dash}` : ''
    window.history.replaceState(null, '', window.location.pathname + search + window.location.hash)
  }, [valtyp, selectedArea, colorMode, view, dashboardBoxes])
```

- [ ] **Step 6: Add the 4 new fields to `ResultsContextValue` and the returned context value**

In the `ResultsContextValue` interface, add (near `colorMode`/`setColorMode`, same "Delad UI-state" group):
```ts
  // Dashboard-vyns läge + fyra oberoende rutors state (helt separat från
  // valtyp/selectedArea ovan — se Task 2 i PR 2-planen).
  view: ViewMode
  setView: (v: ViewMode) => void
  dashboardBoxes: DashboardBox[]
  setDashboardBox: (i: number, box: DashboardBox) => void
```
In the returned context value object (find the `const value = { ... }` object near the end of the function, alongside `valtyp`/`setValtyp`/`selectedArea`/`setSelectedArea`/`colorMode`/`setColorMode`), add:
```ts
    view,
    setView,
    dashboardBoxes,
    setDashboardBox,
```

- [ ] **Step 7: Typecheck/lint/build + run both verify scripts**

Run: `npx tsc --noEmit && npm run lint && npm run build && npx tsx scripts/verify-dashboard-url.ts`
Expected: all green.

- [ ] **Step 8: Manual regression check — existing URL behavior untouched**

Start the dev server, confirm: (a) a plain visit still produces a clean URL (no `vy=`/`p1=` params) exactly as before; (b) `?val=KF&omrade=kommun:1488` still loads Trollhättan in Karta mode exactly as before (this proves `viewToSearch`/`readViewFromUrl` — untouched by this task — still work, and that the new combining logic in Step 5 doesn't corrupt the existing query string when dashboard params are absent, i.e. `view === 'karta'`).

- [ ] **Step 9: Commit**

```bash
git add src/components/ResultsProvider.tsx scripts/verify-dashboard-url.ts
# (+ src/lib/dashboardUrl.ts if Step 2/3 required that extraction)
git commit -m "ResultsProvider: Dashboard-vyns state (view + fyra rutor) + additivt URL-schema"
```

---

### Task 3: `src/components/AreaSummary.tsx` — en rutas fulla innehåll

**Files:**
- Create: `src/components/AreaSummary.tsx`

**Interfaces:**
- Consumes: `useAreaView` (Task 1's fixed version), `AreaSelect` (Task 1's fixed version), `ValtypSelector` (PR 1, already has `value`/`onChange` overrides), `MandatBars`, `ResultTable`, `sparrFor` from `@/lib/aggregate`, `RIKET`/`Area` from `@/lib/area`, `VALTYP_LABEL`/`Valtyp` from `@/lib/results`.
- Produces: `<AreaSummary valtyp={Valtyp} area={Area} onValtypChange={(v: Valtyp) => void} onAreaChange={(a: Area) => void} />` — a fully controlled component (no internal state besides what the hooks it calls own), used by Task 4 (`DashboardGrid`).

- [ ] **Step 1: Write `src/components/AreaSummary.tsx`**

```tsx
// En Dashboard-rutas fulla innehåll — "toppen" av ResultPanel.tsx (till och med
// Summa-raden), men med EGEN, lokal valtyp+område i stället för providerns
// globala selectedArea. Helt kontrollerad (state ägs av ResultsProvider, se
// dashboardBoxes/setDashboardBox) — denna komponent har ingen egen state.
// Ingen breadcrumb, ingen "Bryt ner": varje ruta har redan en flat områdesväljare
// (AreaSelect) för att hoppa vart som helst, och Bryt ner är explicit utanför
// scope (se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md). MandatBars
// körs alltid `compact` (smalare kolumn i rutnätet); samma kompakta ordval
// används för undertext/valdeltagande-etiketten (samma anda som mobilens
// `compact`-läge i ResultPanel.tsx, fast hårdkodat här — varje ruta är alltid smal).
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'
import { sparrFor } from '@/lib/aggregate'
import { RIKET, type Area } from '@/lib/area'
import { ResultTable } from '@/components/ResultTable'
import { MandatBars } from '@/components/MandatBars'
import { AreaSelect } from '@/components/AreaSelect'
import { ValtypSelector } from '@/components/ValtypSelector'
import { useAreaView } from '@/components/useAreaView'

const ELECTION: Record<Valtyp, string> = { RD: 'Riksdagsvalet', RF: 'Regionvalet', KF: 'Kommunvalet' }

export function AreaSummary({
  valtyp,
  area,
  onValtypChange,
  onAreaChange,
}: {
  valtyp: Valtyp
  area: Area
  onValtypChange: (v: Valtyp) => void
  onAreaChange: (a: Area) => void
}) {
  const av = useAreaView(valtyp, area)
  const isPrompt = area.level !== 'riket' && area.code == null
  const pct = av.pct

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <ValtypSelector fill value={valtyp} onChange={onValtypChange} />
      <div className="flex items-center gap-2">
        <AreaSelect valtyp={valtyp} area={area} areaName={av.areaName} onChange={onAreaChange} />
        <span
          className="shrink-0 select-none rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-sm font-semibold text-sky-200"
          title={ELECTION[valtyp]}
        >
          {VALTYP_LABEL[valtyp]}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {isPrompt ? (
          <p className="mb-2 mt-4 text-center text-sm text-slate-400">
            Välj {valtyp === 'RF' ? 'en region' : 'en kommun'} i listan ovan.
          </p>
        ) : (
          <>
            {valtyp === 'RD' && area.level !== 'riket' && area.level !== 'valkrets' && (
              <p className="mb-3 text-xs text-slate-500">
                Riksdagsmandat räknas bara ut på riksnivå — se{' '}
                <button type="button" onClick={() => onAreaChange(RIKET)} className="underline hover:text-slate-300">
                  Riket
                </button>{' '}
                för mandatfördelning. Här visas bara röstandelen för {av.areaName}.
              </p>
            )}
            {av.giltiga > 0 && (
              <div className="mb-3 border-b border-slate-800 pb-3">
                <MandatBars
                  shown={av.display.shown}
                  ovriga={av.display.ovriga}
                  totalMandat={av.totalMandat}
                  giltiga={av.giltiga}
                  sparr={sparrFor(valtyp, area.level, area.code)}
                  reportPct={pct}
                  blocks={av.blocks}
                  compact
                />
              </div>
            )}
            <ResultTable
              title={`${ELECTION[valtyp]} — ${av.areaName}`}
              statusTag={av.statusTag}
              subtitle={`${av.reported.toLocaleString('sv-SE')}/${av.total.toLocaleString('sv-SE')} distrikt (${pct} %)`}
              turnoutLabel={
                av.turnout == null
                  ? undefined
                  : `${av.turnout.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % röstade`
              }
              turnoutTitle={av.turnoutTitle}
              reportPct={av.total > 0 ? (av.reported / av.total) * 100 : 0}
              display={av.display}
              giltiga={av.giltiga}
              sparr={sparrFor(valtyp, area.level, area.code)}
              showSparr={area.level !== 'distrikt'}
              showMandat={av.showMandat}
              totalMandat={av.totalMandat}
              totalMandat2022={av.totalMandat2022}
            />
            {av.giltiga === 0 &&
              (av.has2022 ? (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga 2026-röster inrapporterade än — <span className="text-slate-400">2022</span>-kolumnerna visar
                  förra valets slutresultat.
                </p>
              ) : (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga resultat inrapporterade för {VALTYP_LABEL[valtyp].toLowerCase()} i {av.areaName} än.
                </p>
              ))}
          </>
        )}
      </div>
    </div>
  )
}
```

**IMPORTANT — deliberately NOT passed:** `ResultTable`'s `invalidVotes` prop is omitted entirely (not `undefined` explicitly, just absent from the call) — this is what makes it stop at the Summa row (see `ResultTable.tsx`'s `invalidVotes?:` optional prop, unchanged by this plan). Verify you did not add it.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: green. (No isolated runtime test for this component — it's a composition of already-tested/reviewed pieces (`useAreaView`, `AreaSelect`, `ValtypSelector`, `MandatBars`, `ResultTable`); its correctness becomes observable once `DashboardGrid` renders it in Task 6's Playwright pass.)

- [ ] **Step 3: Commit**

```bash
git add src/components/AreaSummary.tsx
git commit -m "Lägg till AreaSummary (en Dashboard-rutas fulla innehåll)"
```

---

### Task 4: `src/components/DashboardGrid.tsx` — 2×2-rutnät

**Files:**
- Create: `src/components/DashboardGrid.tsx`

**Interfaces:**
- Consumes: `useResults()` for `dashboardBoxes`/`setDashboardBox` (Task 2); `AreaSummary` (Task 3); `defaultAreaFor` from `@/lib/area`.
- Produces: `<DashboardGrid />` (no props — reads/writes provider state directly), used by Task 5 (`App.tsx`).

- [ ] **Step 1: Write `src/components/DashboardGrid.tsx`**

```tsx
// Dashboard-vyns rutnät — 2×2, en AreaSummary per ruta, state i ResultsProvider
// (dashboardBoxes/setDashboardBox) så det överlever att detta rutnät avmonteras
// (toggla till Karta och tillbaka). Fyller HELA ytan under App.tsx:s vy-växlare
// (beslutat: avgångstavlorna döljs också i Dashboard-läge, se App.tsx).
import { useResults } from '@/components/ResultsProvider'
import { AreaSummary } from '@/components/AreaSummary'
import { defaultAreaFor } from '@/lib/area'
import type { Valtyp } from '@/lib/results'

export function DashboardGrid() {
  const { dashboardBoxes, setDashboardBox } = useResults()
  return (
    <div className="absolute inset-0 top-11 grid grid-cols-2 grid-rows-2 gap-3 bg-[#0b1020] p-3">
      {dashboardBoxes.map((box, i) => (
        <div
          key={i}
          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950/85 p-3 shadow-2xl backdrop-blur"
        >
          <AreaSummary
            valtyp={box.valtyp}
            area={box.area}
            onValtypChange={(v: Valtyp) => setDashboardBox(i, { valtyp: v, area: defaultAreaFor(v) })}
            onAreaChange={(a) => setDashboardBox(i, { valtyp: box.valtyp, area: a })}
          />
        </div>
      ))}
    </div>
  )
}
```

**Design note (deliberate, not a bug):** switching a box's OWN valtyp resets that box's area to `defaultAreaFor(newValtyp)` (RD→Riket, RF/KF→prompt) rather than trying to preserve the old area across the switch — this avoids a genuinely invalid combination (e.g. an RF box's area was `{level:'kommun',...}` and it switches to KF, where `kommun` IS valid, vs. switching to RF, where `kommun` is NOT a level `AreaSelect` offers — see `LEVELS` in `src/lib/areaSelect.ts`). This mirrors the simplicity of the box's own independence — no cross-box "remember last area per valtyp" memory is implemented (that global-scope feature is explicitly listed as out-of-scope for Dashboard boxes in the spec).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add src/components/DashboardGrid.tsx
git commit -m "Lägg till DashboardGrid (2x2-rutnät av AreaSummary)"
```

---

### Task 5: `App.tsx` — vy-växlare + villkorlig rendering

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `view`/`setView` (Task 2), `DashboardGrid` (Task 4).
- No change to `ResultPanel`, `DistrictMap`, or any other existing component's own code — only `App.tsx`'s layout JSX changes.

- [ ] **Step 1: Read the CURRENT `src/App.tsx` in full** (it may have drifted since this plan was written against `main@9482ce3` — apply the same intent to whatever is actually there)

- [ ] **Step 2: Add the always-visible toggle bar, and make `<aside>`'s position conditional on `view`**

In `DesktopApp`, destructure `view`/`setView` alongside the existing `valtyp` from `useResults()`. Add a new toggle bar as the FIRST child of `<main>` (before `<DistrictMap />`), and wrap the existing karta-mode JSX (the `<DistrictMap/>`, the vänsterkolumn `<div>` with avgångstavlorna, and the `<aside>`) in a `view === 'karta' &&` conditional; render `<DashboardGrid/>` when `view === 'dashboard'`. The `<aside>`'s `top-0 h-full` becomes `top-11 h-[calc(100%-2.75rem)]` (shifted down by the toggle bar's height, `h-11` = 2.75rem = 44px) — `<ResultPanel/>` itself is NOT touched, only the `<aside>` wrapper's position.

```tsx
function DesktopApp() {
  const { valtyp, view, setView } = useResults()
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b1020] text-slate-100">
        {/* Vy-växlare (Karta/Dashboard) — alltid synlig, oavsett läge. Samma bredd/
            högerkant som resultatpanelen (--panel-w) så den känns som panelens
            "header", fast den styr HELA huvudytan, inte bara panelen. z-20 så den
            alltid ligger ovanpå kartan i kartläget. */}
        <div className="absolute right-0 top-0 z-20 flex h-11 w-[var(--panel-w)] items-center justify-end border-b border-l border-slate-800 bg-slate-950/90 px-4 shadow-lg backdrop-blur">
          <div className="flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-sm shadow-lg">
            <button
              type="button"
              onClick={() => setView('karta')}
              className={`px-4 py-1.5 font-medium transition-colors ${view === 'karta' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Karta
            </button>
            <button
              type="button"
              onClick={() => setView('dashboard')}
              className={`px-4 py-1.5 font-medium transition-colors ${view === 'dashboard' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Dashboard
            </button>
          </div>
        </div>

        {view === 'karta' ? (
          <>
            <DistrictMap />
            {/* Vänsterkolumn: info-kort + "Vinnande parti"-legend högst upp, avgångstavlorna
                fyller resten av höjden (flex-1) ner till nederkanten → de växer och visar fler
                rader på högre skärmar men håller sig kompakta nära brytpunkten, utan att krocka
                med legenden ovanför. */}
            <div className="pointer-events-none absolute inset-y-4 left-4 flex flex-col gap-3">
              <div className="flex max-w-[248px] flex-col gap-3">
              <div className="pointer-events-none relative rounded-lg border border-slate-700 bg-slate-900/85 p-4 shadow-lg backdrop-blur">
                {/* Källkodslänk — icon-only-länk (best practice: aria-label för
                    skärmläsare, target=_blank + rel=noopener noreferrer, pointer-events-auto
                    då kortet självt släpper klick till kartan, focus-visible-ring för
                    tangentbord). Inline SVG = ingen ikon-beroende-osäkerhet. */}
                <a
                  href="https://github.com/lama77se/valvaka-2026"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Källkod på GitHub"
                  title="Källkod på GitHub"
                  className="pointer-events-auto absolute right-3 top-3 rounded text-slate-400 outline-none transition-colors hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.76-3.65 3.95.29.25.55.73.55 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </a>
                <h1 className="pr-7 text-xl font-bold tracking-tight">Valvaka 2026</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Liveresultat på alla nivåer.
                </p>
                {/* Källhänvisning — Valmyndighetens villkor: all data är fri att använda
                    förutsatt att Valmyndigheten anges som källa. */}
                <div className="mt-2 border-t border-slate-800 pt-2">
                  <AttributionInfo />
                </div>
              </div>
              <PartyLegend />
              </div>

              {/* Tre avgångstavlor — RD/RF/KF, alltid synliga I KARTLÄGET (döljs i Dashboard-
                  läget tillsammans med kartan, se view-villkoret ovan — annars skulle de
                  visuellt överlappa och stjäla klick från översta vänstra Dashboard-rutan).
                  Fyller (flex-1) höjden under legenden ner till nederkanten → visar fler
                  rader på högre skärmar, kompakta nära brytpunkten. id:t används av kartans
                  fitBounds för att reservera vänsterkolumnen. Vald valtyp (ValtypSelector)
                  vägs upp (emphasized → 50 %), övriga två delar resten (25 % var). */}
              <div id="left-boards" className="flex min-h-0 flex-1 flex-col gap-2">
                {VALTYPER.map((vt) => (
                  <DepartureBoard key={vt} valtyp={vt} fill emphasized={vt === valtyp} />
                ))}
              </div>
            </div>

            {/* Resultattabell — höger panel. Bredden styrs av --panel-w (index.css), delad med
                kartkontrollernas offset så zoom-knapparna aldrig hamnar under panelen. Skjuten
                ner (top-11) under vy-växlaren ovan; ResultPanel självt är oförändrat. */}
            <aside className="absolute right-0 top-11 h-[calc(100%-2.75rem)] w-[var(--panel-w)] border-l border-slate-800 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
              <ResultPanel />
            </aside>
          </>
        ) : (
          <DashboardGrid />
        )}

        {/* Vercel Web Analytics — sidvisningar/besök. Vite/React-varianten (ej /next).
            Samlar in data först i produktion på Vercel; no-op lokalt. */}
        <Analytics />
      </main>
  )
}
```

Add the import: `import { DashboardGrid } from '@/components/DashboardGrid'`.

- [ ] **Step 3: Typecheck/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Manual regression check — Karta mode must look and behave EXACTLY as before, just shifted down 44px**

Start the dev server, confirm in Karta mode (default on load): map, avgångstavlor, panel all render and behave as before — the only visible difference should be the new toggle bar occupying the top-right 44px strip (where the panel used to start flush at the top) and the panel now starting just below it. Confirm switching Riksdag/Region/Kommun, clicking map districts, and the "Bryt ner" table all still work.

- [ ] **Step 5: Manual check — Dashboard mode renders, toggle works**

Click "Dashboard" in the toggle bar. Confirm: map/avgångstavlor/panel disappear, a 2×2 grid of 4 boxes appears (default RD/Riket in all 4 per Task 2's default), each with its own valtyp pills + area selector + (once you pick a real area) MandatBars/ResultTable. Toggle back to "Karta" — confirm the karta-mode state (whatever valtyp/area/selection you had before) is exactly as you left it. Toggle to "Dashboard" again — confirm your box customizations from before are still there (this proves the state genuinely lives in `ResultsProvider`, not component-local state that would reset on unmount).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "App.tsx: Karta/Dashboard-vyväxlare + villkorlig rendering av DashboardGrid"
```

---

### Task 6: Regressions- och funktionstest (Playwright)

**Files:** No source changes — this task is verification only, using scratch Playwright scripts (not committed) against the running dev server, following the exact pattern established in PR 1's Task 7 and earlier sessions' feature work this same day (copy script into repo root temporarily so `node_modules` resolves, run with `node`, delete after).

**Interfaces:** N/A (verification task).

- [ ] **Step 1: Start the dev server in this worktree**

Confirm `.env.local` exists in this worktree with REAL Supabase credentials (check `cat .env.local` — if it's missing or a dummy placeholder, as happened in PR 1's Task 7, copy the real one from the main checkout's `.env.local` before proceeding; do NOT fabricate a dummy one). Start `npm run dev -- --port <pick one unlikely to collide> --strictPort` in the background, poll until ready.

- [ ] **Step 2: Regression pass — Karta mode identical to `main`**

Reuse the same before/after Playwright comparison approach as PR 1's Task 7 (capture key DOM text across representative scenarios), but this time comparing THIS BRANCH's Karta mode against `main` (the merged PR 1 state) rather than against itself — since this task's changes (Task 5) DO touch `App.tsx`'s Karta-mode JSX (repositioning `<aside>`), unlike PR 1 where `ResultPanel.tsx` itself was untouched by the surrounding layout. Concretely:
1. Check out `main` in a SEPARATE temporary worktree (or use the primary checkout at `C:\dev\valvaka-2026` if it's on `main` and idle — check `git branch --show-current` there first; do not disturb another session's in-progress work), start ITS dev server on a different port.
2. Run the same Playwright scenario script (valtyp switches RD/RF/KF, area switches kommun/region/valkrets/distrikt, a Bryt ner interaction, a URL direct-load) against BOTH ports, capturing DOM text/values.
3. Diff the two captures. They must be IDENTICAL (the panel's rendered content, not pixel position — the panel legitimately sits 44px lower on screen now, which is expected and fine; what must NOT differ is what it says/shows).

If you cannot safely access a clean `main` checkout (e.g. the primary checkout is mid-work in another session), fall back to: capture THIS branch's Karta-mode output, and manually verify by code-reading that `ResultPanel.tsx`/`DistrictMap.tsx` are byte-unchanged from `main` (`git diff main -- src/components/ResultPanel.tsx src/components/DistrictMap.tsx` should be empty) — if those two files have zero diff against `main`, the DOM content they produce cannot have regressed; only `App.tsx`'s wrapper positioning changed, which Step 3 below covers.

- [ ] **Step 3: New functionality pass — Dashboard mode**

Playwright script covering: (a) all 4 boxes start at RD/Riket on first load (no URL params); (b) changing box 2's valtyp to RF and area to a real region updates ONLY box 2, others unaffected, and does NOT affect the global `?val=`/`?omrade=` URL params (confirm by checking `window.location.search` doesn't gain a `val=RF` — only `p2=RF&a2=...`); (c) toggle Dashboard→Karta→Dashboard preserves all 4 boxes' customizations (per Task 5 Step 5's manual check, now scripted); (d) reload the page with a `?vy=dashboard&p1=..&a1=..` URL (construct one from a captured `dashboardToSearch` output or by hand) and confirm all 4 boxes render with the right valtyp/area on a FRESH load (not just client-side state); (e) confirm no "Bryt ner" section and no "Ogiltiga röster" block ever appear in a Dashboard box regardless of area (grep the box's rendered text for the absence of "Bryt ner" and "Ogiltiga").

- [ ] **Step 4: Visual check at breakpoint extremes**

At 1280×700 and 1536×750 (the office-envelope range referenced in `App.tsx`'s own brytpunkt comment), screenshot both Karta and Dashboard modes. Confirm nothing overflows/clips awkwardly — the 4-box grid should comfortably show each box's `AreaSelect`/`ValtypSelector`/MandatBars header even at the smaller extreme, though individual `ResultTable` rows will naturally require the box's own internal scroll (`overflow-auto`, already built into `AreaSummary`).

- [ ] **Step 5: Console error check**

Across all of the above interactions, confirm zero console/page errors (`page.on('console', ...)` / `page.on('pageerror', ...)`, same pattern as prior sessions' Playwright checks).

- [ ] **Step 6: Clean up, report**

Stop the dev server(s), delete any scratch Playwright scripts/JSON captures (never commit them), and write a summary of what was verified into `.superpowers/sdd/<this-plan>/task-6-report.md` (the report is the deliverable for this task, not a commit — there's no code change).

---

### Task 7: Dokumentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (this PR DOES have user-visible functionality, unlike PR 1 — check if README's feature list should mention it)

**Interfaces:** None (docs only).

- [ ] **Step 1: Update `CLAUDE.md`**

Read the current file (PR 1 already fixed its "Status" section and "Stack" heading, and added a note about `useAreaView`/`AreaSelect`). Update the note added in PR 1 (currently ending "...t.ex. i en framtida Dashboard-vy") to reflect that the Dashboard vy now EXISTS rather than being a future example — e.g. change "t.ex. i en framtida Dashboard-vy" to "används redan av Dashboard-vyn (`AreaSummary`/`DashboardGrid`)". Keep it to a similarly short addition — do not expand into a full feature description here (that belongs in README.md).

- [ ] **Step 2: Update `README.md`**

Read the current file's "Vad den gör" (feature list) section. Add a short bullet describing the Dashboard view, matching the existing bullets' style/tone/length (see the current bullets for "Realtidskarta", "Tre val på samma karta", etc. as a model) — something conveying: a desktop-only alternate view, four independently-configurable result boxes (own valtyp + område each), toggled via a Karta/Dashboard switch. Keep it factual and concise, consistent with the rest of the document's voice (no marketing language).

- [ ] **Step 3: Final full verification**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Dokumentera Dashboard-vyn i CLAUDE.md och README.md"
```

---

## Self-Review Notes

- **Spec coverage:** Covers spec sections 6-9 (AreaSummary, DashboardGrid, ResultsProvider state, App.tsx toggle) + URL schema + default state + testplan points 2-4. Section pointer "5. ValtypSelector" was already done in PR 1. The prerequisite bugfix (Task 1) was NOT in the original spec text — it's a defect the PR 1 final review flagged as a forward-looking risk for this exact PR, verified for real during this plan's own research (both `useAreaView.ts` and `AreaSelect.tsx` confirmed to have the bug by reading their current PR-1-merged source).
- **Placeholder scan:** No TBD/TODO. Every code step has complete, concrete code or an explicit, reasoned fallback (e.g. Task 2's `import.meta.env` contingency, Task 6's "if you can't access a clean main checkout" fallback).
- **Type consistency:** `DashboardBox = { valtyp: Valtyp; area: Area }` used identically across Task 2 (definition), Task 4 (`DashboardGrid`'s map), and implicitly Task 3 (`AreaSummary`'s props, which decompose the same shape into `valtyp`/`area` individually rather than taking a `DashboardBox` directly — deliberate, since `AreaSummary` also needs the two separate `onXChange` callbacks, and taking the box apart at the `DashboardGrid` call site is cleaner than a nested-object prop).
- **Known limitation carried forward from PR 1:** MandatBars/soffa-blocks in Dashboard boxes will face the SAME "zero live votes" testing gap PR 1 disclosed for `ResultPanel.tsx` — Task 6's Playwright pass cannot exercise a box with `giltiga > 0` any more than PR 1's could. Task 6 should note this explicitly in its report rather than silently passing over it, exactly as PR 1's final review required.
