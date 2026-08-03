// Drill-down-hierarki för områdesnavigering (breadcrumb uppåt + barn-nedbrytning).
// Ren logik (ingen IO/React) → testbar i verify-aggregate.
//
// Alla tre valtyperna har VALKRETS som nivå under sitt topporgan, men de skiljer sig:
//   • RD: riket → valkrets (29) → kommun → distrikt. Valkretsen byggs av HELA
//     kommuner, så kommun4→valkrets är entydigt (kommunToVk). Riket → alla valkretsar.
//   • RF: region → valkrets (62) → distrikt. Valkretsen är INTE hela kommuner —
//     Stockholm delas i 12 valkretsar tvärs över kommungränser — så kommun-nivån
//     UTGÅR; region → valkrets → distrikt. RF-valkretskoden är län-prefixad (4 siffror).
//   • KF: kommun → valkrets → distrikt. Valkretsen ligger ALLTID inuti en kommun;
//     17 kommuner är indelade (Stockholm 6, …), övriga 273 är EN valkrets = hela
//     kommunen (kod "…00"). KF-valkretskoden är kommun-prefixad (6 siffror).
// RF/KF filtrerar förälder→valkrets på prefix (län resp. kommun). Valkrets är aldrig
// ett rent prefix av valdistriktskoden → översätts via ett förberäknat index.
// distrikt→valkrets är ALLTID entydigt; kommun→valkrets gäller bara RD (valkrets =
// hela kommuner) — RF/KF härleder valkretsen ur distriktet i stället.
//
// GENERELL REGEL (både drill och breadcrumb): en nivå visas bara om den DELAR sitt
// område i ≥2 delar. Nivåer som speglar föräldern (enkommuns-valkrets = kommun, en
// oindelad kommuns enda valkrets = kommun, en-valkrets-region = region) hoppas över —
// "Bryt ner" är alltid nästa FAKTISKT finare indelning. Alltså syns valkretsnivån bara
// där den verkligen delar (RD läns-valkretsar, RF fler-vk-regioner, 17 indelade KF-
// kommuner); annars går man direkt till distrikt.
import type { Level } from './aggregate'
import type { Valtyp } from './results'

export const HIERARCHY: Record<Valtyp, Level[]> = {
  RD: ['riket', 'valkrets', 'kommun', 'distrikt'],
  RF: ['region', 'valkrets', 'distrikt'],
  KF: ['kommun', 'valkrets', 'distrikt'],
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

// Hur många barn på `childLevel` området (`parent`) delas i? 1 ⇒ nivån speglar bara
// föräldern (ingen riktig indelning) och ska hoppas över i både drill och breadcrumb.
// valkrets: antal vk-koder under förälderns prefix (riket = alla). kommun: antal
// distinkta kommuner i valkretsen (RD). Övriga nivåer delar alltid (returnera >1).
function splitCount(parent: HArea, childLevel: Level, index?: AreaIndex): number {
  if (!index) return 2
  if (childLevel === 'valkrets') {
    const prefix = parent.code ?? ''
    let n = 0
    for (const code of index.vkToDistricts.keys()) if (!prefix || code.startsWith(prefix)) n++
    return n
  }
  if (childLevel === 'kommun') {
    const ds = index.vkToDistricts.get(parent.code ?? '') ?? []
    return new Set(ds.map((d) => d.slice(0, 4))).size
  }
  return 2
}

// Path top→current (inklusive), MED redundanta mellannivåer bortsläppta så breadcrumb
// matchar drillen. En mellannivå som inte delar sin förälder (enkommuns-valkrets =
// kommun, oindelad kommuns valkrets = kommun, en-valkrets-region = region) speglar bara
// föräldern och utelämnas. Toppen och det valda området behålls alltid.
// T.ex. RD Sthlm-distrikt → [riket, valkrets(Sthlms kommun), distrikt] (kommun slopad);
// RD Norrbottens-distrikt → [riket, valkrets(Norrbotten), kommun, distrikt].
export function ancestorsOf(valtyp: Valtyp, area: HArea, index?: AreaIndex): HArea[] {
  const chain = HIERARCHY[valtyp]
  const idx = chain.indexOf(area.level)
  if (idx < 0) return [area]
  const full: HArea[] = []
  for (let i = 0; i <= idx; i++) full.push({ level: chain[i], code: codeForLevel(chain[i], area, index) })
  return full.filter(
    (node, i) => i === 0 || i === full.length - 1 || splitCount(full[i - 1], node.level, index) > 1,
  )
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

type ChildGroup = { level: Level; code: string; districts: string[] }

// Barnen på den OMEDELBARA barnnivån (en nivå ned i kedjan). Prefix-rent utom
// valkretshoppen, som går via indexet.
function immediateChildGroups(valtyp: Valtyp, area: HArea, allCodes: Iterable<string>, index?: AreaIndex): ChildGroup[] {
  const childLevel = childLevelOf(valtyp, area.level)
  if (!childLevel) return []

  // → valkrets (RD riket→valkrets, RF region→valkrets, KF kommun→valkrets):
  // valkretsgrupperna ur indexet. RF-koden är län-prefixad och KF-koden kommun-
  // prefixad → filtrera på förälderns prefix; RD:s riket tar alla.
  if (childLevel === 'valkrets') {
    if (!index) return []
    const prefix = area.level === 'region' || area.level === 'kommun' ? area.code ?? '' : ''
    return [...index.vkToDistricts.entries()]
      .filter(([code]) => !prefix || code.startsWith(prefix))
      .map(([code, districts]) => ({ level: 'valkrets' as Level, code, districts }))
  }
  // valkrets → barn: distrikten i valkretsen, grupperade på barnnivåns prefixlängd
  // (RD valkrets→kommun = 4, RF/KF valkrets→distrikt = 8 → varje distrikt sin grupp).
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

// "Bryt ner" = nästa MENINGSFULLA nivå ned. Regel (användarens princip): breakdown
// är alltid nästa FAKTISKT finare indelning — hoppa över nivåer som inte delar
// området (en valkrets som ÄR en kommun, en oindelad kommuns enda valkrets, en
// en-valkrets-region: EXAKT ett barn = samma område, ingen nedbrytning). Descendar
// tills ≥2 barn eller distrikt (lövet). Distrikt visas även om det bara är ett.
export function childGroupsOf(valtyp: Valtyp, area: HArea, allCodes: Iterable<string>, index?: AreaIndex): ChildGroup[] {
  let a = area
  for (;;) {
    const groups = immediateChildGroups(valtyp, a, allCodes, index)
    if (groups.length !== 1 || groups[0].level === 'distrikt') return groups
    a = { level: groups[0].level, code: groups[0].code } // enda barnet = samma område → descenda
  }
}
