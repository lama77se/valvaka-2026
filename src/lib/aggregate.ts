// Fas "presentation" — område-aggregat + radmodell för resultattabellen.
// Ren logik (ingen IO/React): samma funktion driver alla nivåer (rike/region/
// kommun/valkrets) och valideras mot 2022-facit (scripts/verify-aggregate.ts).
//
// Radmodellen är LÅST (advisor): fält som ännu inte wirats är `null` och renderas
// som "–". Mandat (increment 2) och ±2022 (increment 3) fylls i utan att röra
// tabellkomponenten. Kollaps till "Övriga" sker vid RENDER — andel/spärr räknas
// alltid på HELA partiuppsättningen, aldrig på den 1%-kollapsade.
import { computeAssembly, modifiedSainteLague, placeLevelingSeats, type ConstituencyVotes, type PartyVotes } from './mandate'
import type { Valtyp } from './results'
import { SEAT_CONFIG_2026 } from './seatConfig2026'

export type Level = 'riket' | 'region' | 'kommun' | 'valkrets' | 'distrikt'

// Riksspärr per valtyp — fallback/default för nivåer där ETT tal inte är entydigt
// (KF-aggregat över FLERA kommuner, t.ex. riket/region-summering — varje kommun
// väger då in sin EGEN spärr i mandaträkningen ändå, se computeMandate/sparrFor).
export const SPARR: Record<Valtyp, number> = { RD: 0.04, RF: 0.03, KF: 0.02 }
export const DISPLAY_THRESHOLD = 0.01 // visa individuellt ≥1 %, resten → Övriga

// Spärren att VISA (spärr-linjen i tabellen/soffan) för ett specifikt område — skiljer
// sig från den statiska SPARR[valtyp] bara för KF: tröskeln är 2 % i en odelad kommun
// (en enda valkrets) men 3 % i en kommun indelad i flera valkretsar (vallagen, ändrad
// 2018) — se build-seat-config.mjs, som härleder threshold PER KOMMUN direkt ur
// Valmyndighetens fasta-fil (räknar valkrets-rader per kommun i källfilen). RD/RF har
// ingen sådan variation i lagen (bekräftat mot val.se/SKR/Riksdagen) → samma konstant
// som computeMandate redan använder. computeMandate har ALLTID använt rätt per-kommun-
// tröskel för själva mandaträkningen — denna funktion för bara samma värde till VISNINGEN
// (spärr-linjen i ResultTable/MandatBars/hover-rutan), som tidigare låg fast på 2 % även
// för de ~17 delade kommunerna (Stockholm, Malmö, Göteborg m.fl.).
export function sparrFor(valtyp: Valtyp, level: Level, code: string | null): number {
  if (valtyp !== 'KF' || !code) return SPARR[valtyp]
  // KF: 'kommun' är koden själv; 'distrikt'/'valkrets' ligger alltid inuti EN kommun
  // (kommun-prefixade koder) → samma kommuns tröskel gäller. 'riket' (alla kommuner
  // blandade) → ingen enskild kommun är rätt svar, falla tillbaka på defaulten.
  const kommunkod = level === 'kommun' ? code : level === 'distrikt' || level === 'valkrets' ? code.slice(0, 4) : null
  return (kommunkod && SEAT_CONFIG_2026.KF[kommunkod]?.threshold) ?? SPARR.KF
}

export interface PartyMeta {
  forkortning: string | null
  farg: string | null
  beteckning?: string | null // fullständigt partinamn — join-nyckel mot 2022-facit
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
  andel2022: number | null // 2022 års andel (egen kolumn — visas alltid, ej bara delta)
  mandat2022: number | null // 2022 års mandat i församlingen
  ny: boolean // partiet fanns inte i 2022 (i detta område) → "ny" i 2022-kolumnen
  overSparr: boolean
}

export interface AreaResult {
  rows: PartyRow[] // HELA partiuppsättningen, sorterad på röster fallande
  giltiga: number
  sparr: number
  totalMandat: number | null
  totalMandat2022: number | null
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
      andel2022: null,
      mandat2022: null,
      ny: false,
      overSparr: andel >= sparr,
    }
  })
  rows.sort((a, b) => b.roster - a.roster)
  return { rows, giltiga, sparr, totalMandat: null, totalMandat2022: null }
}

export interface OvrigaRow {
  count: number
  roster: number
  andel: number
  mandat: number | null
  andel2022: number | null
  mandat2022: number | null
}
export interface DisplayRows {
  shown: PartyRow[]
  ovriga: OvrigaRow | null
  sparrIndex: number // insättningsposition i `shown` för spärr-linjen (= shown.length om alla visade är över spärren → linjen ritas före Övriga)
}

// Render-tid: dela i visade (≥ tröskel) + en sammanslagen Övriga-rad. Ett parti
// visas individuellt om det når tröskeln i ENDERA året (annars försvinner ett
// parti som var stort 2022 men står på 0 % innan 2026 kommit in).
const displayAndel = (r: PartyRow) => Math.max(r.andel, r.andel2022 ?? 0)
export function collapseForDisplay(area: AreaResult, threshold = DISPLAY_THRESHOLD): DisplayRows {
  const shown = area.rows.filter((r) => displayAndel(r) >= threshold)
  const rest = area.rows.filter((r) => displayAndel(r) < threshold)
  const sum = (rs: PartyRow[], pick: (r: PartyRow) => number | null) =>
    rs.every((r) => pick(r) == null) ? null : rs.reduce((a, r) => a + (pick(r) ?? 0), 0)
  const ovriga: OvrigaRow | null = rest.length
    ? {
        count: rest.length,
        roster: rest.reduce((a, r) => a + r.roster, 0),
        andel: rest.reduce((a, r) => a + r.andel, 0),
        mandat: sum(rest, (r) => r.mandat),
        andel2022: sum(rest, (r) => r.andel2022),
        mandat2022: sum(rest, (r) => r.mandat2022),
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
    else if (level === 'distrikt' && vd === code) out.push(vd)
    else if (level === 'region' && vd.slice(0, 2) === code) out.push(vd)
    else if (level === 'kommun' && vd.slice(0, 4) === code) out.push(vd)
    else if (level === 'valkrets' && meta.get(vd)?.[VK_COL[valtyp]] === code) out.push(vd)
  }
  return out
}

// --- Mandat (increment 2) ------------------------------------------------------
// Använder den VERIFIERADE proportionella metoden per församling (samma som
// verify-mandate-rf/kf + replay): RD nationellt (349), RF per region, KF per
// kommun. 2026 års platsantal/spärr kommer från seatConfig2026 (genererad ur
// Valmyndighetens fasta-fil). Summerar över församlingar för riksaggregat.

// Förgruppera distrikt per län/kommun-kod EN gång (O(1)-uppslag per församling).
export interface AreaGroups {
  all: string[]
  byLan: Map<string, string[]>
  byKommun: Map<string, string[]>
}
export function buildGroups(allCodes: string[]): AreaGroups {
  const byLan = new Map<string, string[]>()
  const byKommun = new Map<string, string[]>()
  for (const vd of allCodes) {
    const lan = vd.slice(0, 2)
    const kommun = vd.slice(0, 4)
    ;(byLan.get(lan) ?? byLan.set(lan, []).get(lan)!).push(vd)
    ;(byKommun.get(kommun) ?? byKommun.set(kommun, []).get(kommun)!).push(vd)
  }
  return { all: allCodes, byLan, byKommun }
}

// --- Uppsamlingsröster (sena röster, onsdagsräkningen) -------------------------
// Vägs in i ORGAN-aggregaten (KF-kommun, RF-region, RD-riket) så slutgiltiga totaler
// matchar val.se. Nyckeln är organ-koden: RD → '' (riket, EN hink), RF → lankod
// (2 siffror), KF → kommunkod (4 siffror). Håller distrikt/valkrets/karta geografiska.
export type UppsamlingVotes = Map<string, PartyVotes>

// Slå ihop bas-röster med ev. extra (uppsamling). Utan extra → oförändrad bas
// (referenslika return är OK — callers muterar aldrig). Default-fallet gör hela
// mandat-/aggregatvägen till en NO-OP när ingen uppsamling skickas in (2022-facit-testerna).
export function mergeVotes(base: PartyVotes, extra?: PartyVotes | null): PartyVotes {
  if (!extra) return base
  const out: PartyVotes = { ...base }
  for (const [p, v] of Object.entries(extra)) out[p] = (out[p] ?? 0) + v
  return out
}

// Extra uppsamlingsröster att lägga till DISPLAY-aggregatet (röster/andel i panelen).
// Endast de tre valbara organ-nivåerna har en total som ska matcha val.se; övriga
// nivåer (valkrets/distrikt) förblir rent geografiska (barnen summerar då inte till
// föräldern — medvetet, se docs).
export function uppsamlingForArea(
  valtyp: Valtyp,
  level: Level,
  areaCode: string | null,
  uppsamling: UppsamlingVotes | null | undefined,
): PartyVotes | null {
  if (!uppsamling) return null
  if (valtyp === 'RD' && level === 'riket') return uppsamling.get('') ?? null
  if (valtyp === 'RF' && level === 'region' && areaCode) return uppsamling.get(areaCode) ?? null
  if (valtyp === 'KF' && level === 'kommun' && areaCode) return uppsamling.get(areaCode) ?? null
  return null
}

// Proportionell mandatfördelning (jämkad uddatalsmetod 1,2) bland partier ≥ spärr.
export function proportionalSeats(votes: PartyVotes, seats: number, threshold: number): Record<string, number> {
  const total = Object.values(votes).reduce((a, b) => a + b, 0)
  if (total === 0 || seats === 0) return {}
  const qual = Object.fromEntries(Object.entries(votes).filter(([, v]) => v / total >= threshold))
  return modifiedSainteLague(qual, seats, 1.2)
}

export interface MandateResult {
  seatsByParty: Record<string, number>
  totalMandat: number
}

// Mandat för (valtyp, nivå, område). null där mandat inte gäller (t.ex. riksdags-
// mandat på kommunnivå, eller regionval för Gotland som saknar regionfullmäktige).
export function computeMandate(
  valtyp: Valtyp,
  level: Level,
  areaCode: string | null,
  aggregate: (codes: Iterable<string>) => PartyVotes,
  groups: AreaGroups,
  uppsamling?: UppsamlingVotes | null, // undefined → NO-OP (2022-facit-testerna oförändrade)
): MandateResult | null {
  const acc: Record<string, number> = {}
  const add = (seats: Record<string, number>) => {
    for (const [p, s] of Object.entries(seats)) acc[p] = (acc[p] ?? 0) + s
  }
  const emptyIfNone = (codes: string[] | undefined) => codes ?? []
  // Röster för EN församling = geografiskt aggregat + församlingens uppsamlingsröster
  // (organ-koden: RD '', RF lankod, KF kommunkod). mergeVotes utan extra → oförändrat.
  const votesFor = (codes: string[] | undefined, organKey: string) =>
    mergeVotes(aggregate(emptyIfNone(codes)), uppsamling?.get(organKey))

  if (valtyp === 'RD') {
    if (level !== 'riket') return null
    // ⚠️ KÄND FÖRENKLING: en enda nationell jämkad uddatalsomgång på hela 349,
    // bara 4 %-spärren — implementerar INTE 12 %-i-en-valkrets-undantaget (§ eller
    // fasta valkretsmandat/utjämningsmandat-uppdelningen). Den KORREKTA, redan
    // 2022-facit-verifierade metoden finns i lib/mandate.ts (computeAssembly,
    // se dess docstring + scripts/verify-mandate.ts) men är inte kopplad in här —
    // kräver fasta mandat PER VALKRETS (SEAT_CONFIG_2026.RD saknar detta, se
    // build-seat-config.mjs) + röster grupperade per RD-valkrets i denna funktion,
    // ingetdera finns idag. Bedömning inför 2026 (diskuterad med användaren 11 sep):
    // inget parti är nära scenariot (<4 % riks men >12 % i en enskild valkrets) →
    // risken bedöms försumbar, medvetet oåtgärdat.
    add(proportionalSeats(votesFor(groups.all, ''), SEAT_CONFIG_2026.RD.totalSeats, SEAT_CONFIG_2026.RD.threshold))
  } else if (valtyp === 'RF') {
    if (level === 'region') {
      const seats = SEAT_CONFIG_2026.RF[areaCode ?? '']
      if (!seats) return null
      add(proportionalSeats(votesFor(groups.byLan.get(areaCode!), areaCode!), seats, 0.03))
    } else if (level === 'riket') {
      for (const [lan, seats] of Object.entries(SEAT_CONFIG_2026.RF))
        add(proportionalSeats(votesFor(groups.byLan.get(lan), lan), seats, 0.03))
    } else return null
  } else {
    // KF
    if (level === 'kommun') {
      const cfg = SEAT_CONFIG_2026.KF[areaCode ?? '']
      if (!cfg) return null
      add(proportionalSeats(votesFor(groups.byKommun.get(areaCode!), areaCode!), cfg.seats, cfg.threshold))
    } else if (level === 'riket' || level === 'region') {
      const prefix = level === 'region' ? areaCode ?? '' : ''
      for (const [code, cfg] of Object.entries(SEAT_CONFIG_2026.KF)) {
        if (prefix && !code.startsWith(prefix)) continue
        add(proportionalSeats(votesFor(groups.byKommun.get(code), code), cfg.seats, cfg.threshold))
      }
    } else return null
  }

  const totalMandat = Object.values(acc).reduce((a, b) => a + b, 0)
  return totalMandat === 0 ? null : { seatsByParty: acc, totalMandat }
}

export interface FixedValkretsMandate {
  seatsByParty: Record<string, number> // parti -> fasta valkretsmandat i DENNA valkrets
  totalFixed: number // valkretsens andel av valområdets fasta mandat
}

// Delad kärna FÖR RF/KF (RD har sin egen, se computeRdValkretsMandate nedan — den PLACERAR
// numera utjämningen också). Kör computeAssembly på ETT valområdes (region/kommun) egna
// valkretsar och plockar bara ut steg B (fixedByConstituencyParty) för `areaCode` — steg
// C/D (den riktiga slutfördelningen, redan korrekt beräknad av computeMandate för HELA
// valområdet) ignoreras medvetet här, se computeFixedRegionOrKommunValkretsMandate.
// totalSeats i configen påverkar aldrig steg B, bara C/D → 0 duger, den läses aldrig.
function fixedByValkrets(
  votesByConstituency: ConstituencyVotes,
  fixedSeatsByConstituency: Record<string, number>,
  areaCode: string,
  nationalThreshold: number,
  constituencyThreshold: number,
): FixedValkretsMandate | null {
  const totalFixed = fixedSeatsByConstituency[areaCode]
  if (!totalFixed) return null
  const result = computeAssembly(votesByConstituency, {
    totalSeats: 0,
    firstDivisor: 1.2,
    nationalThreshold,
    constituencyThreshold,
    fixedSeatsByConstituency,
  })
  return { seatsByParty: result.fixedByConstituencyParty[areaCode] ?? {}, totalFixed }
}

export interface RdValkretsMandate {
  seatsByParty: Record<string, number> // parti -> TOTALT mandat i denna valkrets (fasta + placerad utjämning)
  fixedSeatsByParty: Record<string, number> // parti -> bara de fasta, för "N av M är fasta"-visning
  totalFixed: number // = SEAT_CONFIG_2026.RD.valkrets[kod]
  totalSeats: number // fasta + utjämning som landade här — den RIKTIGA slutsiffran
}

// RD, valkretsnivå — den RIKTIGA slutgiltiga mandatfördelningen per valkrets, LIVE på
// inkomna röster: fasta valkretsmandat (steg B) PLUS utjämningsmandaten geografiskt
// PLACERADE (jämförelsetal per valkrets, se placeLevelingSeats i mandate.ts) — inte bara
// en "minst"-golvsiffra längre (tillagd 12 sep, ersätter den tidigare fasta-bara versionen).
// Verifierad EXAKT mot Valmyndighetens 2022-facit på valkretsnivå: 232/232 (valkrets,parti)
// -par, 0 avvikelser (scripts/verify-mandate-leveling.ts). ALLA 29 valkretsar deltar i
// röstunderlaget (kvalificering + placering är rikstäckande, kan inte göras per valkrets
// isolerat). Ingen uppsamling vägs in — sena röster har ingen valkrets-nyckel att slå in på.
export function computeRdValkretsMandate(
  areaCode: string,
  vkToDistricts: Map<string, string[]>,
  aggregate: (codes: Iterable<string>) => PartyVotes,
): RdValkretsMandate | null {
  const totalFixed = SEAT_CONFIG_2026.RD.valkrets[areaCode]
  if (!totalFixed) return null
  const votesByConstituency: ConstituencyVotes = {}
  for (const [vk, districts] of vkToDistricts) votesByConstituency[vk] = aggregate(districts)
  const result = computeAssembly(votesByConstituency, {
    totalSeats: SEAT_CONFIG_2026.RD.totalSeats,
    firstDivisor: 1.2,
    nationalThreshold: SEAT_CONFIG_2026.RD.threshold,
    constituencyThreshold: 0.12,
    fixedSeatsByConstituency: SEAT_CONFIG_2026.RD.valkrets,
  })
  const placed = placeLevelingSeats(votesByConstituency, result.fixedByConstituencyParty, result.levelingByParty)
  const fixedHere = result.fixedByConstituencyParty[areaCode] ?? {}
  const placedHere = placed[areaCode] ?? {}
  const seatsByParty: Record<string, number> = {}
  for (const p of new Set([...Object.keys(fixedHere), ...Object.keys(placedHere)])) {
    seatsByParty[p] = (fixedHere[p] ?? 0) + (placedHere[p] ?? 0)
  }
  const totalSeats = Object.values(seatsByParty).reduce((a, b) => a + b, 0)
  return { seatsByParty, fixedSeatsByParty: fixedHere, totalFixed, totalSeats }
}

// RF/KF, valkretsnivå — samma princip som RD (se ovan), men bara för de 11 delade
// regionerna resp. 17 delade kommunerna (SEAT_CONFIG_2026.RF_VALKRETS/KF_VALKRETS —
// övriga saknar en egen valkrets-nivå, hierarchy.ts hoppar över den). Två SKILLNADER
// mot RD: (1) röstunderlaget är bara det EGNA valområdets valkretsar (regionen/
// kommunen), inte hela riket — RF/KF-spärren är region-/kommunvid, inte nationell;
// (2) ingen 12 %-i-en-valkrets-kvalificering (bara RD har den, Vallag) →
// constituencyThreshold = Infinity. `prefix` filtrerar vkToDistricts (RF-valkretskod
// är länsprefixad 4 siffror, KF-valkretskod kommunprefixad 6) till bara den egna
// regionens/kommunens valkretsar.
export function computeFixedRegionOrKommunValkretsMandate(
  valtyp: 'RF' | 'KF',
  prefix: string,
  areaCode: string,
  vkToDistricts: Map<string, string[]>,
  aggregate: (codes: Iterable<string>) => PartyVotes,
  threshold: number,
): FixedValkretsMandate | null {
  const votesByConstituency: ConstituencyVotes = {}
  for (const [vk, districts] of vkToDistricts) {
    if (vk.startsWith(prefix)) votesByConstituency[vk] = aggregate(districts)
  }
  const config = valtyp === 'RF' ? SEAT_CONFIG_2026.RF_VALKRETS : SEAT_CONFIG_2026.KF_VALKRETS
  return fixedByValkrets(votesByConstituency, config, areaCode, threshold, Infinity)
}

// Slå in mandat i partiraderna (behåller andel/sortering).
export function applyMandate(area: AreaResult, mandate: MandateResult | null): AreaResult {
  if (!mandate) return area
  return {
    ...area,
    totalMandat: mandate.totalMandat,
    rows: area.rows.map((r) => ({ ...r, mandat: mandate.seatsByParty[r.partikod] ?? 0 })),
  }
}

// --- ±2022 (increment 3) -------------------------------------------------------
// 2022 års andel + mandat per LÖV-församling (RD riket, RF per region, KF per
// kommun), nycklat på områdeskod + partinamn (beteckning). Genereras av
// scripts/build-comparison-2022.ts → public/comparison-2022.json.
export interface AreaComparison {
  andel: Record<string, number> // partinamn → andel 2022 (0..1)
  mandat: Record<string, number> // partinamn → mandat 2022
}
export interface Comparison2022 {
  RD: AreaComparison // riket
  RD_byValkrets?: Record<string, AreaComparison> // RD per valkrets (andel + FAKTISKA 2022-mandat ur facit)
  RD_valkretsNamn?: Record<string, string> // valkretskod → namn (för väljare/breadcrumb)
  RD_byKommun?: Record<string, AreaComparison> // RD-andel per kommun (mandat tomt — riksmandat per valkrets)
  RF: Record<string, AreaComparison> // per region
  RF_byValkrets?: Record<string, AreaComparison> // RF-andel per valkrets (mandat tomt — organet är regionen)
  RF_valkretsNamn?: Record<string, string> // RF-valkretskod (län-prefixad, 4 siffror) → namn
  KF: Record<string, AreaComparison>
  KF_byValkrets?: Record<string, AreaComparison> // KF-andel per valkrets (mandat tomt — organet är kommunen)
  KF_valkretsNamn?: Record<string, string> // KF-valkretskod (kommun-prefixad, 6 siffror) → namn
}

// Vilken 2022-jämförelse gäller för (valtyp, nivå, område)? RD joinar på riket +
// geografisk nedbrytning (län/kommun, andel); RF per region; KF per kommun.
// Övriga aggregat (RF/KF-riket, KF-region) och valkrets → null (visar "–").
export function comparisonFor(
  c: Comparison2022,
  valtyp: Valtyp,
  level: Level,
  areaCode: string | null,
): AreaComparison | null {
  if (valtyp === 'RD') {
    if (level === 'riket') return c.RD
    if (level === 'valkrets' && areaCode) return c.RD_byValkrets?.[areaCode] ?? null
    if (level === 'kommun' && areaCode) return c.RD_byKommun?.[areaCode] ?? null
    return null
  }
  if (valtyp === 'RF') {
    if (level === 'region' && areaCode) return c.RF[areaCode] ?? null
    if (level === 'valkrets' && areaCode) return c.RF_byValkrets?.[areaCode] ?? null
    return null
  }
  if (level === 'kommun' && areaCode) return c.KF[areaCode] ?? null
  if (level === 'valkrets' && areaCode) return c.KF_byValkrets?.[areaCode] ?? null
  return null
}

// Fyll 2022 års andel + mandat som EGNA kolumner (visas alltid, bredvid 2026 —
// ingen switch). Join på beteckning. Två saker gör att 2022 syns även utan 2026:
//   1) Raduppsättningen blir UNIONEN — 2022-partier utan 2026-röster sås in som
//      egna rader (annars är tabellen tom innan 2026 kommit in).
//   2) Spärr-linjen följer det LIVE året: 2026 när röster finns, annars 2022 (så
//      ett parti på 4,1 % 2022 men 3,5 % nu hamnar under linjen, inte över).
export function applyComparison(
  area: AreaResult,
  valtyp: Valtyp,
  level: Level,
  areaCode: string | null,
  comparison: Comparison2022 | null,
  party: Map<string, PartyMeta>,
  districtLeaf?: AreaComparison | null, // 2022 för ett enskilt distrikt (DB-hämtat), används vid level==='distrikt'
): AreaResult {
  // Distriktsnivå har ingen statisk löv-fil (2026-distrikt ≠ 2022-distrikt) — 2022
  // hämtas per distrikt ur district_result_2022 och skickas in här.
  const c =
    level === 'distrikt'
      ? districtLeaf ?? null
      : comparison
        ? comparisonFor(comparison, valtyp, level, areaCode)
        : null
  if (!c) return area

  // Reverse-lookup partinamn → 2026-partimeta (färg/förkortning för insådda 2022-rader).
  const byName = new Map<string, { partikod: string; forkortning: string | null; farg: string | null }>()
  for (const [partikod, m] of party) if (m.beteckning) byName.set(m.beteckning, { partikod, forkortning: m.forkortning, farg: m.farg })

  const live = area.giltiga > 0
  const over = (andel: number, andel2022: number | null) => (live ? andel : andel2022 ?? 0) >= area.sparr

  const covered = new Set<string>()
  const rows: PartyRow[] = area.rows.map((r) => {
    const namn = party.get(r.partikod)?.beteckning ?? null
    if (namn) covered.add(namn)
    const a2022 = namn != null ? c.andel[namn] : undefined
    if (a2022 === undefined) {
      return { ...r, ny: true, andel2022: null, mandat2022: null, deltaAndel: null, deltaMandat: null, overSparr: over(r.andel, null) }
    }
    const m2022 = c.mandat[namn!] ?? null
    return {
      ...r,
      ny: false,
      andel2022: a2022,
      mandat2022: m2022,
      deltaAndel: (r.andel - a2022) * 100,
      deltaMandat: r.mandat != null ? r.mandat - (m2022 ?? 0) : null,
      overSparr: over(r.andel, a2022),
    }
  })

  // Så in 2022-partier utan 2026-rad (innan 2026 kommit in → alla partier hit).
  for (const [namn, a2022] of Object.entries(c.andel)) {
    if (covered.has(namn)) continue
    const meta = byName.get(namn)
    rows.push({
      partikod: meta?.partikod ?? namn,
      forkortning: meta?.forkortning ?? null,
      farg: meta?.farg ?? null,
      roster: 0,
      andel: 0,
      deltaAndel: null,
      mandat: area.totalMandat != null ? 0 : null,
      deltaMandat: null,
      andel2022: a2022,
      mandat2022: c.mandat[namn] ?? null,
      ny: false,
      overSparr: over(0, a2022),
    })
  }

  // Sortera på 2026-röster, med 2022-andel som utslag → 2022-ordning när tomt.
  rows.sort((a, b) => b.roster - a.roster || (b.andel2022 ?? 0) - (a.andel2022 ?? 0))

  const has2022 = rows.some((r) => r.mandat2022 != null)
  return { ...area, rows, totalMandat2022: has2022 ? rows.reduce((a, r) => a + (r.mandat2022 ?? 0), 0) : null }
}
