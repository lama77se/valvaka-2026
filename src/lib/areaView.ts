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
  uppsamlingCountsForArea,
  uppsamlingForArea,
  type AreaComparison,
  type AreaGroups,
  type Comparison2022,
  type DisplayRows,
  type DistrictMeta,
  type Level,
  type MandateResult,
  type PartyMeta,
  type UppsamlingBuckets,
  type UppsamlingDistriktEntry,
} from './aggregate'
import { RIKET_BLOCKS, type BlockConfig } from './soffa'
import { REGION_STYRE_BLOCKS } from './regionBlocks'
import { KOMMUN_STYRE_BLOCKS } from './kommunBlocks'
import { marginalSeatInfo, type MarginalSeatInfo } from './mandate'
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

// Organets EGEN nivå (delmängden av MANDAT_LEVELS ovan som INTE är valkrets) — marginalmandat-
// analysen (handover 14 sep) visas BARA här, aldrig på valkretsnivå: "marginalmandat" är på
// valkretsnivå ett mycket krångligare begrepp (utjämningsplaceringen är i grunden nationell,
// inte lokal per valkrets, se placeLevelingSeats i mandate.ts) och skulle bli missvisande.
const ORGAN_LEVEL: Record<Valtyp, Level> = { RD: 'riket', RF: 'region', KF: 'kommun' }

// Döljer mandatberäkningarnas VISNING (inte själva beräkningen — den körs som idag)
// tills minst denna andel av valdistrikten i det VISADE området är räknade. Svensk
// mediepraxis (SVT) visar traditionellt inte första preliminära mandatfördelningen
// förrän "tillräckligt räknat" (~22:30) — tidigt räknade distrikt (ofta små) ger
// annars en skev bild, särskilt på finkornig nivå (valkrets/utjämningsmandat). Ersätter
// INTE den borttagna (12 sep) "minst"-hedgen på valkretsnivå (amber-ruta/`*`) — det var
// en annan mekanism (visa en golvsiffra). Detta är en ren tröskel: under den, inget
// mandat alls; över den, den fulla, riktiga fördelningen (ingen markering).
const MANDAT_REPORT_THRESHOLD = 10

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
  // Valmyndighetens EGEN mandatfördelning (mandat_valse-tabellen, dormant-flaggad handover
  // 13 sep) — bara relevant vid mandatKalla==='aktiv'. Valfria (default 'av'/tom karta) så
  // befintliga anrop (verify-area-view*.ts) fortsätter fungera oförändrade. Nyckel:
  // `${valtyp}|${niva:'organ'|'valkrets'}|${omradeskod}` → partikod → antal mandat. omradeskod
  // för organnivå är 'riket' (RD) eller area.code (RF/KF, redan i samma paddade format som
  // val.se:s egna koder — se ResultsProvider.tsx:s vk_rd/vk_rf/vk_kf-paddning).
  mandatKalla?: 'av' | 'shadow' | 'aktiv'
  mandatValse?: Map<string, Record<string, number>>
  // Uppsamlingsdistrikt-registret (handover 13 sep, Val ANALYSIS) — vilka uppsamlingsdistrikt
  // finns för DENNA valtyp, samt vilka av dem som redan syns i uppsamling_result. Valfria
  // (default tom lista/tom Set → oförändrat beteende, bakåtkompatibelt med
  // scripts/verify-area-view*.ts). Se uppsamlingCountsForArea (aggregate.ts).
  uppsamlingRegistry?: UppsamlingDistriktEntry[]
  uppsamlingReported?: ReadonlySet<string>
}

export interface AreaViewResult {
  display: DisplayRows
  giltiga: number
  totalMandat: number | null
  totalMandat2022: number | null
  has2022: boolean
  reported: number
  total: number
  uppTotal: number // hur många av `total` som är uppsamlingsdistrikt (icke-geografiska, se uppsamlingCountsForArea) — för "varav X uppsamling"-texten i UI:t
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
  // Marginalmandat-analysen (handover 14 sep, Val ANALYSIS) — bara organets EGEN nivå (RD/riket,
  // RF/region, KF/kommun), aldrig valkrets, och bara när showMandat redan är sant (samma
  // 10 %-rapporteringsgräns). null annars — döljer raden i UI:t helt.
  marginalSeat: MarginalSeatInfo | null
  areaName: string
  pct: number
  statusTag: ReturnType<typeof slutligTag>
}

export function computeAreaView(p: AreaViewParams): AreaViewResult {
  const {
    valtyp, area, store, turnoutStore, allCodes, meta, party, groups, uppsamling, areaIndex, comparison,
    district2022, kommuner, regioner, valkretsar, distriktNamn,
    mandatKalla = 'av', mandatValse,
    uppsamlingRegistry = [], uppsamlingReported = new Set<string>(),
  } = p

  // Slutresultat-läge PER VALTYP ur result.status i storen (preliminärt → sluträknas · X %
  // → slutgiltigt). Panelen renderas om på `revision` så andelen hålls färsk. Fasen visas
  // som en egen badge (samma tone/etikett som kartvyns statustagg, `slutligTag`) i stället
  // för att stå inbäddad i bar-texten — baren nedan är då entydigt EN sak: hur stor andel
  // av VALT OMRÅDE som rapporterat in (skiljer sig från `prog`, som är per valtyp).
  const statusTag = slutligTag(store.slutligProgress())

  // codes/reported/total/pct hoisade hit (tidigare räknade ut sent i funktionen, se
  // nedan) — blocks/showMandat nedan behöver pct FÖRE de kan avgöra om mandat ska visas.
  const codes = districtsInArea(allCodes, area.level, area.code, valtyp, meta)
  // Uppsamlingsdistrikten hör till den visade ytan (handover 13 sep) — se
  // uppsamlingCountsForArea (aggregate.ts) för exakt organ-/valkrets-gating (speglar
  // uppsamlingForArea nedan, så nämnaren aldrig inkluderar distrikt vars röster inte redan
  // vägs in i ytans egen röstsumma).
  const uppCounts = uppsamlingCountsForArea(valtyp, area.level, area.code, uppsamlingRegistry, uppsamlingReported)
  const reported = codes.reduce((n, c) => n + (store.has(c) ? 1 : 0), 0) + uppCounts.reported
  const total = codes.length + uppCounts.total
  // Rapporteringsgrad FÖR DET VISADE OMRÅDET (t.ex. EN valkrets egen räknegrad om man
  // tittar på just den) — INTE riket/hela valtypens grad. Gatar mandatberäkningarnas
  // visning nedan, se MANDAT_REPORT_THRESHOLD.
  const pct = total > 0 ? Math.round((reported / total) * 100) : 0
  const mandatReported = pct >= MANDAT_REPORT_THRESHOLD

  // Tvåblocksvyn (MandatBars) — bara på valtypens högsta nivå: riksblocken för RD/riket,
  // sittande styre-vs-opposition för RF/region resp. KF/kommun (samtliga 20 regioner och
  // 290 kommuner finns i REGION_STYRE_BLOCKS/KOMMUN_STYRE_BLOCKS, se regionBlocks.ts/
  // kommunBlocks.ts för källa/verifiering per post). Under MANDAT_REPORT_THRESHOLD:
  // undefined → MandatBars no-opar redan när blocks är falsy.
  const blocks: BlockConfig | undefined = !mandatReported
    ? undefined
    : valtyp === 'RD' && area.level === 'riket'
      ? RIKET_BLOCKS
      : valtyp === 'RF' && area.level === 'region'
        ? REGION_STYRE_BLOCKS[area.code ?? '']
        : valtyp === 'KF' && area.level === 'kommun'
          ? KOMMUN_STYRE_BLOCKS[area.code ?? '']
          : undefined

  const showMandat = mandatReported && MANDAT_LEVELS[valtyp].includes(area.level)

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
  // Valmyndighetens EGEN mandatfördelning (mandat_valse, handover 13 sep) — DORMANT tills
  // mandatKalla==='aktiv' (default 'av' → alltid null här, exakt dagens beteende oförändrat).
  // Källväxlingen sker HÄR, på ETT ställe: när en matchande rad finns vinner den över vår
  // egen beräkning (mandate/valkretsMandate nedan), annars oförändrat fallback. Samma
  // MANDAT_LEVELS-gate som showMandat — en mandat_valse-slagning görs bara på de nivåer där
  // mandat överhuvudtaget är meningsfullt.
  const valseMandate: MandateResult | null =
    mandatKalla === 'aktiv' && mandatValse && MANDAT_LEVELS[valtyp].includes(area.level)
      ? (() => {
          const niva = area.level === 'valkrets' ? 'valkrets' : 'organ'
          const omradeskod = niva === 'organ' && valtyp === 'RD' ? 'riket' : area.code
          if (!omradeskod) return null
          const seatsByParty = mandatValse.get(`${valtyp}|${niva}|${omradeskod}`)
          if (!seatsByParty) return null
          return { seatsByParty, totalMandat: Object.values(seatsByParty).reduce((a, b) => a + b, 0) }
        })()
      : null
  // Övriga partier — den RIKTIGA källan (handover 13 sep; se PR #170/#171-historiken för det
  // FÖRSTA, FELAKTIGA försöket som av misstag återanvände ej_anmalda_partier, ett Ogiltiga-
  // röster-fält). val.se:s rostfordelning-JSON har en distrikts-EGEN deklarerad
  // rosterPaverkaMandat.antalRoster som kan vara STÖRRE än summan av de itemiserade
  // partiRoster-posterna — gapet är giltiga, ALDRIG individuellt itemiserade röster
  // (turnout.roster_paverkar_mandat). Räknas PER DISTRIKT (bara de som redan har fältet;
  // resten bidrar via dagens itemiserade väg precis som förut, se store.aggregate ovan) — en
  // PARTIELL, VÄXANDE summa (Lars uttryckliga beslut, bekräftat två gånger) — väntar INTE på
  // att alla distrikt i området ska ha fältet, till skillnad från invalidVotes ovan (som
  // medvetet ÄR alla-eller-inget). Klampas till ≥0 per distrikt (säkerhetsnät mot dataskev/
  // timing-artefakter — aldrig observerat negativt i verifieringen mot skarp data).
  const ovrigaGiltigaRoster = codes.reduce((sum, vd) => {
    const rpm = turnoutStore.rosterPaverkarMandat(vd)
    if (rpm == null) return sum
    return sum + Math.max(0, rpm - store.outcome(vd).total)
  }, 0)
  const sparr = sparrFor(valtyp, area.level, area.code)
  let areaResult = applyMandate(
    buildRows(votes, party, sparr, ovrigaGiltigaRoster),
    valseMandate ?? mandate ?? (valkretsMandate && { seatsByParty: valkretsMandate.seatsByParty, totalMandat: valkretsMandate.totalSeats }),
  )
  // Marginalmandat-analysen (handover 14 sep, Val ANALYSIS) — HELT SEPARAT, parallell körning
  // av samma jämkade uddatalsmetod (mandate.ts:marginalSeatInfo), matar ALDRIG tillbaka in i
  // `mandate`/`areaResult` ovan. Bara organets EGEN nivå (ORGAN_LEVEL, aldrig valkrets) och bara
  // när mandat redan visas (mandatReported, samma 10 %-gräns) — annars null (raden döljs i UI:t).
  // `votes` (organ-nivåns röster, uppsamling redan invägd) och `sparr` är EXAKT samma indata
  // computeMandate/buildRows redan använder för denna yta, så marginalanalysen är konsistent
  // med de mandatsiffror som faktiskt visas.
  const marginalSeat =
    mandatReported && area.level === ORGAN_LEVEL[valtyp] && mandate
      ? marginalSeatInfo(votes, mandate.totalMandat, 1.2, sparr)
      : null
  const districtLeaf =
    area.level === 'distrikt' && area.code ? (district2022.get(`${valtyp}:${area.code}`) ?? null) : null
  areaResult = applyComparison(areaResult, valtyp, area.level, area.code, comparison, party, districtLeaf)
  const display = collapseForDisplay(areaResult)
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

  return {
    display,
    giltiga: areaResult.giltiga,
    // Nollade under MANDAT_REPORT_THRESHOLD: totalMandat går direkt till MandatBars
    // (inte bara via showMandat) och styr dess EGEN "Mandat 2026"-stapel + majoritets-
    // linje oberoende av showMandat — måste alltså gatas separat, annars läcker den
    // igenom. totalMandat2022 nollas av samma skäl/konsekvens (annars ser Mandat-
    // kolumnens 2022-sida konstig ut ensam).
    totalMandat: mandatReported ? areaResult.totalMandat : null,
    totalMandat2022: mandatReported ? areaResult.totalMandat2022 : null,
    has2022,
    reported,
    total,
    uppTotal: uppCounts.total,
    turnout,
    // De absoluta talen bakom valdeltagande-%:en (val.se visar dem själva: "Räknade röster" /
    // "Röstberättigade") — hover-tooltip på samma etikett i stället för egen rad, för att inte
    // tränga ut Parti/Röster-huvudet. rb=0 → ingen röstlängd inrapporterad än → ingen tooltip.
    turnoutTitle: t.rb > 0 ? `Räknade röster: ${t.total.toLocaleString('sv-SE')} · Röstberättigade: ${t.rb.toLocaleString('sv-SE')}` : undefined,
    invalidVotes,
    blocks,
    showMandat,
    marginalSeat,
    areaName,
    pct,
    statusTag,
  }
}
