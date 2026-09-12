// Ren beräkningslogik för "toppen" av ett områdes resultatvy — röster, mandat,
// valdeltagande, ogiltiga röster, blockvy. Extraherad ur ResultPanel.tsx:s
// view-useMemo (pre-refaktor) för att delas mellan den globala
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
import type { Area, NamedCode } from './area'

// Nivåer där mandat överhuvudtaget är ett meningsfullt tal (organets EGEN nivå + valkrets)
// — OBEROENDE av om röster hunnit räknas än. RD:s "kommun" är bara en geografisk
// nedbrytning (se LEVELS i areaSelect.ts), inte riksdagens organ-nivå, så den räknas INTE
// hit trots att KF:s "kommun" gör det. val.se visar inte mandat under valkretsnivå heller
// (distrikt, och för RD även kommun) — döljer Mandat-kolumnerna helt där i stället för tre
// "–"-kolumner.
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

  // Slutresultat-läge PER VALTYP ur result.status i storen (preliminärt → sluträknas · X %
  // → slutgiltigt). Panelen renderas om på `revision` så andelen hålls färsk. Fasen visas
  // som en egen badge (samma tone/etikett som kartvyns statustagg, `slutligTag`) i stället
  // för att stå inbäddad i bar-texten — baren nedan är då entydigt EN sak: hur stor andel
  // av VALT OMRÅDE som rapporterat in (skiljer sig från `prog`, som är per valtyp).
  const statusTag = slutligTag(store.slutligProgress())

  // Tvåblocksvyn (MandatBars) — bara på valtypens högsta nivå: riksblocken för RD/riket,
  // sittande styre-vs-opposition för RF/region resp. KF/kommun (samtliga 20 regioner och
  // 290 kommuner finns i REGION_STYRE_BLOCKS/KOMMUN_STYRE_BLOCKS, se regionBlocks.ts/
  // kommunBlocks.ts för källa/verifiering per post).
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
  // Organ-nivåerna (KF-kommun/RF-region/RD-riket) väger in uppsamlingsrösterna i BÅDE
  // röster/andel (här) och mandat (computeMandate) så den slutgiltiga presentationen
  // matchar val.se. Övriga nivåer → uppsamlingForArea ger null → rent geografiskt.
  const votes = mergeVotes(store.aggregate(codes), uppsamlingForArea(valtyp, area.level, area.code, uppsamling))
  const mandate = computeMandate(valtyp, area.level, area.code, (c) => store.aggregate(c), groups, uppsamling)
  // Valkretsnivå (RD:s 29, samt RF/KF:s 11/17 delade organ): computeMandate ger null där
  // (mandat är annars riks-/region-/kommunvitt) — fyll i den RIKTIGA slutgiltiga
  // fördelningen i stället: fasta valkretsmandat PLUS utjämningsmandaten geografiskt
  // PLACERADE (jämförelsetal per valkrets, se placeLevelingSeats i mandate.ts) — inte en
  // "minst"-golvsiffra (12 sep, gäller nu alla tre valtyper). Samma "preliminärt tills
  // färdigräknat"-status som riket/region/kommun redan har (statusTag ovan) gäller
  // automatiskt även här, ingen extra markering behövs.
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
  // Valdeltagande för området: Σtotalt / Σröstberättigade över dess (reguljära) distrikt.
  // null när nämnaren är 0 (inga rapporterade distrikt med röstlängd än) → visas ej.
  const turnout = t.rb > 0 ? (t.total / t.rb) * 100 : null
  // Ogiltiga röster (val.se: Blanka / Ej anmälda partier / Övriga ogiltiga / Totalt) — bara
  // när ALLA rapporterade distrikt i området har fälten (se TurnoutStore.aggregate). %:en är
  // av samtliga AVGIVNA röster (t.total, inte bara giltiga partiröster — val.se:s egen nämnare).
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
    // De absoluta talen bakom valdeltagande-%:en (val.se visar dem själva: "Räknade röster" /
    // "Röstberättigade") — hover-tooltip på samma etikett i stället för egen rad, för att inte
    // tränga ut Parti/Röster-huvudet. rb=0 → ingen röstlängd inrapporterad än → ingen tooltip.
    turnoutTitle: t.rb > 0 ? `Räknade röster: ${t.total.toLocaleString('sv-SE')} · Röstberättigade: ${t.rb.toLocaleString('sv-SE')}` : undefined,
    invalidVotes,
    blocks,
    showMandat,
    areaName,
    pct,
    statusTag,
  }
}
