// Dashboard-vyns URL-schema (view + fyra rutors valtyp/område) — supabase-fri modul
// (samma mönster som src/lib/area.ts) så den kan importeras av standalone-skript
// (verify-dashboard-url.ts) utan att dra in ResultsProvider.tsx:s
// `import { supabase } from '@/lib/supabase'` (import.meta.env kraschar under
// plain tsx/Node, se PR 1 Task 2). parseAreaParam/AREA_LEVELS flyttade hit
// från ResultsProvider.tsx av samma skäl — readViewFromUrl där importerar dem
// tillbaka i stället för att duplicera logiken.
//
// Delbara vy-URL:er: en vy = valtyp + markerat område. Kodas i query-strängen så
// en länk kan öppna en specifik default-vy, t.ex. ?val=KF&omrade=kommun:1488 =
// "Kommunalvalet Trollhättan". Området kodas "nivå:kod" (riket saknar kod;
// RF/KF-promptläget = default → utelämnas → ren länk).
import { RIKET, defaultAreaFor, type Area } from './area'
import { VALTYPER, type Valtyp } from './results'
import type { Level } from './aggregate'

export const AREA_LEVELS: Level[] = ['riket', 'region', 'kommun', 'valkrets', 'distrikt']

export function parseAreaParam(raw: string | null, valtyp: Valtyp): Area {
  if (!raw) return defaultAreaFor(valtyp)
  if (raw === 'riket') return RIKET
  const i = raw.indexOf(':')
  const level = (i === -1 ? raw : raw.slice(0, i)) as Level
  const code = i === -1 ? null : raw.slice(i + 1)
  if (!AREA_LEVELS.includes(level)) return defaultAreaFor(valtyp)
  return { level, code: code || null }
}

export type ViewMode = 'karta' | 'dashboard'
export type DashboardBox = { valtyp: Valtyp; area: Area }
const DASHBOARD_BOX_COUNT = 4

// Delad med ResultsProvider.tsx:s viewToSearch (samma "nivå:kod"-kodning för karta-
// lägets ?omrade=) — se finalgranskningens fix-våg (Minor #3, DRY).
export function encodeAreaParam(area: Area): string {
  return `${area.level}${area.code ? ':' + encodeURIComponent(area.code) : ''}`
}

// Dashboard-vyns fyra-rutors-state ur URL:en — additivt till val=/omrade= (se
// readViewFromUrl/viewToSearch i ResultsProvider.tsx, oförändrade): bara
// vy=dashboard&p1=..&a1=.. osv existerar när Dashboard-läget är aktivt. Saknas
// ett pN/aN-par (första besöket) → den rutan defaultar till RD/Riket (samma
// defaultAreaFor-fallback som parseAreaParam redan ger vid saknad/ogiltig kod).
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
