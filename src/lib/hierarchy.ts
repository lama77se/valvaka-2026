// Drill-down-hierarki för områdesnavigering (breadcrumb uppåt + barn-nedbrytning).
// Ren logik (ingen IO/React) → testbar i verify-aggregate.
//
// Både RD och RF har VALKRETS som nivå under sitt topporgan, men de skiljer sig:
//   • RD: riket → valkrets (29) → kommun → distrikt. Valkretsen byggs av HELA
//     kommuner, så kommun4→valkrets är entydigt (kommunToVk). Riket → alla valkretsar.
//   • RF: region → valkrets (62) → distrikt. Valkretsen är INTE hela kommuner —
//     Stockholm delas i 12 valkretsar tvärs över kommungränser — så kommun-nivån
//     UTGÅR; man går region → valkrets → distrikt. RF-valkretskoden är län-prefixad
//     (4 siffror) så region→valkrets filtreras på prefix.
// Valkrets är aldrig ett rent prefix av valdistriktskoden → översätts via ett
// förberäknat index. distrikt→valkrets är ALLTID entydigt (ett distrikt hör till
// exakt en valkrets); kommun→valkrets gäller bara RD (där valkrets = hela kommuner).
import type { Level } from './aggregate'
import type { Valtyp } from './results'

export const HIERARCHY: Record<Valtyp, Level[]> = {
  RD: ['riket', 'valkrets', 'kommun', 'distrikt'],
  RF: ['region', 'valkrets', 'distrikt'],
  KF: ['kommun', 'distrikt'],
}

// Kodlängd (prefix av valdistriktskod) per nivå. riket = hela landet; valkrets är
// metadata (ej prefix) och hanteras via indexet.
const CODE_LEN: Partial<Record<Level, number>> = { region: 2, kommun: 4, distrikt: 8 }

export interface HArea {
  level: Level
  code: string | null
}

// Valkretsindex per valtyp. districtToVk (8-siffrig vd → valkrets) är entydigt och
// finns alltid; vkToDistricts är inversen; kommunToVk (kommun4 → valkrets) finns
// bara för RD, där valkretsen byggs av hela kommuner.
export interface AreaIndex {
  districtToVk: Map<string, string>
  vkToDistricts: Map<string, string[]>
  kommunToVk?: Map<string, string>
}

// Kod för en förfaders nivå, härledd ur nuvarande område. valkrets är inte ett
// prefix → härleds via indexet: ett distrikt (8 siffror) slås direkt i districtToVk,
// en kommun (RD) via kommunToVk.
function codeForLevel(level: Level, area: HArea, index?: AreaIndex): string | null {
  if (level === 'riket') return null
  if (level === 'valkrets') {
    if (area.level === 'valkrets') return area.code
    if (!area.code || !index) return null
    if (area.code.length >= 8) return index.districtToVk.get(area.code) ?? null
    return index.kommunToVk?.get(area.code.slice(0, 4)) ?? null
  }
  const len = CODE_LEN[level]
  return len != null && area.code ? area.code.slice(0, len) : null
}

// Path top→current (inklusive). T.ex. RD kommun 2560 → [riket, valkrets 29, kommun 2560];
// RF distrikt 0180xxxx → [region 01, valkrets 0101, distrikt 0180xxxx].
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
// utom valkretshoppen, som går via indexet.
export function childGroupsOf(
  valtyp: Valtyp,
  area: HArea,
  allCodes: Iterable<string>,
  index?: AreaIndex,
): { level: Level; code: string; districts: string[] }[] {
  const childLevel = childLevelOf(valtyp, area.level)
  if (!childLevel) return []

  // → valkrets (RD riket→valkrets, RF region→valkrets): valkretsgrupperna ur indexet.
  // RF-koden är län-prefixad → filtrera på regionens prefix; RD:s riket tar alla.
  if (childLevel === 'valkrets') {
    if (!index) return []
    const prefix = area.level === 'region' ? area.code ?? '' : ''
    return [...index.vkToDistricts.entries()]
      .filter(([code]) => !prefix || code.startsWith(prefix))
      .map(([code, districts]) => ({ level: 'valkrets' as Level, code, districts }))
  }
  // valkrets → barn: distrikten i valkretsen, grupperade på barnnivåns prefixlängd
  // (RD valkrets→kommun = 4, RF valkrets→distrikt = 8 → varje distrikt sin egen grupp).
  if (area.level === 'valkrets') {
    const len = CODE_LEN[childLevel]
    if (len == null) return []
    return groupByPrefix(index?.vkToDistricts.get(area.code ?? '') ?? [], len, childLevel)
  }
  // Prefix-baserat (kommun→distrikt, region→kommun, ...).
  const len = CODE_LEN[childLevel]
  if (len == null) return []
  const prefix = area.code ?? ''
  const filtered: string[] = []
  for (const vd of allCodes) if (!prefix || vd.startsWith(prefix)) filtered.push(vd)
  return groupByPrefix(filtered, len, childLevel)
}
