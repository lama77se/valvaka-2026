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
import type { Area } from './area'
import type { NamedCode } from '@/components/ResultsProvider'

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
