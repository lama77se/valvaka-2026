// Drill-down-hierarki för områdesnavigering (breadcrumb uppåt + barn-nedbrytning).
// Ren logik (ingen IO/React) → testbar i verify-aggregate.
//
// RD:s nivå under Riket är VALKRETS (riksdagens riktiga fördelningsnivå — 29 st),
// inte län: mandaten delas ut per valkrets och val.se bryter ner RD så. Valkrets är
// dock INTE ett kod-prefix (Stockholm/Skåne/VG delas i flera valkretsar inom samma
// län), så de två översta RD-hoppen använder ett förberäknat index (valkrets byggs
// av HELA kommuner → kommun4→valkrets är många-till-en). Övriga hopp är prefix-rena.
import type { Level } from './aggregate'
import type { Valtyp } from './results'

export const HIERARCHY: Record<Valtyp, Level[]> = {
  RD: ['riket', 'valkrets', 'kommun', 'distrikt'],
  RF: ['region', 'kommun', 'distrikt'],
  KF: ['kommun', 'distrikt'],
}

// Kodlängd (prefix av valdistriktskod) per nivå. riket = hela landet; valkrets är
// metadata (ej prefix) och hanteras via indexet.
const CODE_LEN: Partial<Record<Level, number>> = { region: 2, kommun: 4, distrikt: 8 }

export interface HArea {
  level: Level
  code: string | null
}

// Valkretsindex (RD): kommun4 → valkrets, och valkrets → distriktskoder.
export interface AreaIndex {
  kommunToVk: Map<string, string>
  vkToDistricts: Map<string, string[]>
}

// Kod för en förfaders nivå, härledd ur nuvarande område. valkrets är inte ett
// prefix → härleds via kommunToVk (kommun → valkrets).
function codeForLevel(level: Level, area: HArea, index?: AreaIndex): string | null {
  if (level === 'riket') return null
  if (level === 'valkrets') {
    if (area.level === 'valkrets') return area.code
    return area.code ? index?.kommunToVk.get(area.code.slice(0, 4)) ?? null : null
  }
  const len = CODE_LEN[level]
  return len != null && area.code ? area.code.slice(0, len) : null
}

// Path top→current (inklusive). T.ex. RD kommun 2560 → [riket, valkrets 29 (Norrbotten), kommun 2560].
export function ancestorsOf(valtyp: Valtyp, area: HArea, index?: AreaIndex): HArea[] {
  const chain = HIERARCHY[valtyp]
  const idx = chain.indexOf(area.level)
  if (idx < 0) return [area]
  const out: HArea[] = []
  for (let i = 0; i <= idx; i++) out.push({ level: chain[i], code: codeForLevel(chain[i], area, index) })
  return out
}

// Nästa nivå ned i kedjan (barnnivån), eller null om lövet (distrikt).
export function childLevelOf(valtyp: Valtyp, level: Level): Level | null {
  const chain = HIERARCHY[valtyp]
  const idx = chain.indexOf(level)
  return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null
}

function groupByPrefix(codes: Iterable<string>, len: number, level: Level) {
  const map = new Map<string, string[]>()
  const order: string[] = []
  for (const vd of codes) {
    const code = vd.slice(0, len)
    let arr = map.get(code)
    if (!arr) {
      arr = []
      map.set(code, arr)
      order.push(code)
    }
    arr.push(vd)
  }
  return order.map((code) => ({ level, code, districts: map.get(code)! }))
}

// Barnen (på barnnivån) inom området, var och en med sina distrikt. Prefix-rent
// utom de två RD-valkretshoppen som går via indexet.
export function childGroupsOf(
  valtyp: Valtyp,
  area: HArea,
  allCodes: Iterable<string>,
  index?: AreaIndex,
): { level: Level; code: string; districts: string[] }[] {
  const childLevel = childLevelOf(valtyp, area.level)
  if (!childLevel) return []

  // riket → valkrets (RD): valkretsgrupperna direkt ur indexet.
  if (childLevel === 'valkrets') {
    if (!index) return []
    return [...index.vkToDistricts.entries()].map(([code, districts]) => ({ level: 'valkrets' as Level, code, districts }))
  }
  // valkrets → kommun (RD): distrikten i valkretsen, grupperade per kommun-prefix.
  if (area.level === 'valkrets') {
    return groupByPrefix(index?.vkToDistricts.get(area.code ?? '') ?? [], 4, 'kommun')
  }
  // Prefix-baserat (kommun→distrikt, RF region→kommun, ...).
  const len = CODE_LEN[childLevel]
  if (len == null) return []
  const prefix = area.code ?? ''
  const filtered: string[] = []
  for (const vd of allCodes) if (!prefix || vd.startsWith(prefix)) filtered.push(vd)
  return groupByPrefix(filtered, len, childLevel)
}
