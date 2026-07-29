// Fas "presentation" — område-aggregat + radmodell för resultattabellen.
// Ren logik (ingen IO/React): samma funktion driver alla nivåer (rike/region/
// kommun/valkrets) och valideras mot 2022-facit (scripts/verify-aggregate.ts).
//
// Radmodellen är LÅST (advisor): fält som ännu inte wirats är `null` och renderas
// som "–". Mandat (increment 2) och ±2022 (increment 3) fylls i utan att röra
// tabellkomponenten. Kollaps till "Övriga" sker vid RENDER — andel/spärr räknas
// alltid på HELA partiuppsättningen, aldrig på den 1%-kollapsade.
import type { PartyVotes } from './mandate'
import type { Valtyp } from './results'

export type Level = 'riket' | 'region' | 'kommun' | 'valkrets'

// Riksspärr per valtyp (för spärr-linjen). KF varierar 2 %/3 % per kommun —
// förfinas när mandat wiras (increment 2); 2 % som default här.
export const SPARR: Record<Valtyp, number> = { RD: 0.04, RF: 0.03, KF: 0.02 }
export const DISPLAY_THRESHOLD = 0.01 // visa individuellt ≥1 %, resten → Övriga

export interface PartyMeta {
  forkortning: string | null
  farg: string | null
}

export interface PartyRow {
  partikod: string
  forkortning: string | null
  farg: string | null
  roster: number
  andel: number // 0..1 av giltiga
  deltaAndel: number | null // ±procentenheter mot förra valet (null = ej wirat/ojämförbart)
  mandat: number | null
  deltaMandat: number | null
  overSparr: boolean
}

export interface AreaResult {
  rows: PartyRow[] // HELA partiuppsättningen, sorterad på röster fallande
  giltiga: number
  sparr: number
  totalMandat: number | null
}

// Bygg partirader ur redan aggregerade röster för ETT område.
export function buildRows(votes: PartyVotes, party: Map<string, PartyMeta>, sparr: number): AreaResult {
  const giltiga = Object.values(votes).reduce((a, b) => a + b, 0)
  const rows: PartyRow[] = Object.entries(votes).map(([partikod, roster]) => {
    const andel = giltiga > 0 ? roster / giltiga : 0
    const m = party.get(partikod)
    return {
      partikod,
      forkortning: m?.forkortning ?? null,
      farg: m?.farg ?? null,
      roster,
      andel,
      deltaAndel: null,
      mandat: null,
      deltaMandat: null,
      overSparr: andel >= sparr,
    }
  })
  rows.sort((a, b) => b.roster - a.roster)
  return { rows, giltiga, sparr, totalMandat: null }
}

export interface OvrigaRow {
  count: number
  roster: number
  andel: number
  mandat: number | null
}
export interface DisplayRows {
  shown: PartyRow[]
  ovriga: OvrigaRow | null
  sparrIndex: number // insättningsposition i `shown` för spärr-linjen (= shown.length om alla visade är över spärren → linjen ritas före Övriga)
}

// Render-tid: dela i visade (≥ tröskel) + en sammanslagen Övriga-rad.
export function collapseForDisplay(area: AreaResult, threshold = DISPLAY_THRESHOLD): DisplayRows {
  const shown = area.rows.filter((r) => r.andel >= threshold)
  const rest = area.rows.filter((r) => r.andel < threshold)
  const ovriga: OvrigaRow | null = rest.length
    ? {
        count: rest.length,
        roster: rest.reduce((a, r) => a + r.roster, 0),
        andel: rest.reduce((a, r) => a + r.andel, 0),
        mandat: rest.every((r) => r.mandat == null) ? null : rest.reduce((a, r) => a + (r.mandat ?? 0), 0),
      }
    : null
  const idx = shown.findIndex((r) => !r.overSparr)
  return { shown, ovriga, sparrIndex: idx === -1 ? shown.length : idx }
}

// --- Områdesfiltrering (klientsida, ur distriktsmetadata) ----------------------
// Områdeskod härleds ur den 8-siffriga valdistriktskoden (stabil): län = 2 första,
// kommun = 4 första. Valkrets slås upp per valtyp i metadatan.
export interface DistrictMeta {
  vk_rd: string | null
  vk_rf: string | null
  vk_kf: string | null
}
const VK_COL: Record<Valtyp, keyof DistrictMeta> = { RD: 'vk_rd', RF: 'vk_rf', KF: 'vk_kf' }

export function districtsInArea(
  allCodes: Iterable<string>,
  level: Level,
  code: string | null,
  valtyp: Valtyp,
  meta: Map<string, DistrictMeta>,
): string[] {
  const out: string[] = []
  for (const vd of allCodes) {
    if (level === 'riket') out.push(vd)
    else if (level === 'region' && vd.slice(0, 2) === code) out.push(vd)
    else if (level === 'kommun' && vd.slice(0, 4) === code) out.push(vd)
    else if (level === 'valkrets' && meta.get(vd)?.[VK_COL[valtyp]] === code) out.push(vd)
  }
  return out
}
