// Drill-down-hierarki för områdesnavigering (breadcrumb uppåt + barn-nedbrytning).
// Ren logik (ingen IO/React) → testbar i verify-aggregate. Nivåkedjan per valtyp är
// den nativa nivån + geografisk nedbrytning under den (samma som väljaren erbjuder),
// avslutad med 'distrikt' (nås via kartklick). Förfäders koder härleds ur nuvarande
// valdistriktskod som prefix; barn enumereras ur FAKTISK data, aldrig hårdkodad lista.
import type { Level } from './aggregate'
import type { Valtyp } from './results'

export const HIERARCHY: Record<Valtyp, Level[]> = {
  RD: ['riket', 'region', 'kommun', 'distrikt'],
  RF: ['region', 'kommun', 'distrikt'],
  KF: ['kommun', 'distrikt'],
}

// Kodlängd (prefix av valdistriktskod) per nivå. riket = hela landet → ingen kod.
const CODE_LEN: Partial<Record<Level, number>> = { region: 2, kommun: 4, distrikt: 8 }

export interface HArea {
  level: Level
  code: string | null
}

// Path top→current (inklusive). T.ex. RD distrikt 01800142 →
// [riket, region 01, kommun 0180, distrikt 01800142].
export function ancestorsOf(valtyp: Valtyp, area: HArea): HArea[] {
  const chain = HIERARCHY[valtyp]
  const idx = chain.indexOf(area.level)
  if (idx < 0) return [area]
  const out: HArea[] = []
  for (let i = 0; i <= idx; i++) {
    const lvl = chain[i]
    const len = CODE_LEN[lvl]
    out.push({ level: lvl, code: len != null && area.code ? area.code.slice(0, len) : null })
  }
  return out
}

// Nästa nivå ned i kedjan (barnnivån), eller null om lövet (distrikt).
export function childLevelOf(valtyp: Valtyp, level: Level): Level | null {
  const chain = HIERARCHY[valtyp]
  const idx = chain.indexOf(level)
  return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null
}

// Barnen (distinkta prefix på barnnivån) inom området, var och en med sina distrikt.
// EN pass över allCodes; barnen kommer i datans ordning (UI sorterar på namn).
export function childGroupsOf(
  valtyp: Valtyp,
  area: HArea,
  allCodes: Iterable<string>,
): { level: Level; code: string; districts: string[] }[] {
  const childLevel = childLevelOf(valtyp, area.level)
  if (!childLevel) return []
  const len = CODE_LEN[childLevel]
  if (len == null) return []
  const prefix = area.code ?? ''
  const map = new Map<string, string[]>()
  const order: string[] = []
  for (const vd of allCodes) {
    if (prefix && !vd.startsWith(prefix)) continue
    const code = vd.slice(0, len)
    let arr = map.get(code)
    if (!arr) {
      arr = []
      map.set(code, arr)
      order.push(code)
    }
    arr.push(vd)
  }
  return order.map((code) => ({ level: childLevel, code, districts: map.get(code)! }))
}
