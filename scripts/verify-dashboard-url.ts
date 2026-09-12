// Validerar dashboard-URL-schemat (readDashboardFromUrl / dashboardToSearch),
// definierat i src/lib/dashboardUrl.ts (supabase-fri modul — ResultsProvider.tsx
// re-exporterar samma funktioner men drar in @/lib/supabase, som kraschar under
// plain tsx/Node p.g.a. import.meta.env vid modulscope, se PR 1 Task 2) —
// additivt till val=/omrade= (oförändrat, se PR 1), bara närvarande när
// vy=dashboard. Körs mot en global.window-stub (samma mönster som
// readViewFromUrl redan hanterar för SSR/no-window via typeof window check —
// här körs det ALLTID i Node, så vi stubbar window.location.search manuellt).
//   npx tsx scripts/verify-dashboard-url.ts
import { readDashboardFromUrl, dashboardToSearch } from '../src/lib/dashboardUrl.ts'
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
