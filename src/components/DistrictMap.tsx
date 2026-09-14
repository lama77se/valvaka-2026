import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

type StyleSpecification = maplibregl.StyleSpecification
import {
  DISTRICT_ID_PROPERTY,
  GEOMETRY_URL,
  KOMMUN_BOUNDARIES_URL,
  REGION_BOUNDARIES_URL,
  SWEDEN_BOUNDS,
  VALKRETS_RD_BOUNDARIES_URL,
} from '@/lib/geometry'
import { deriveSlutligState, GROUP_LEVEL_LABEL, VALTYPER, VALTYP_LABEL, type ColorMode, type ColorScheme, type DistrictOutcome, type Valtyp } from '@/lib/results'
import { SlutligBar } from '@/components/SlutligBar'
import { RIKET_BLOCKS } from '@/lib/soffa'
import { applyComparison, buildRows, collapseForDisplay, districtsInArea, sparrFor, type Level } from '@/lib/aggregate'
import { ancestorsOf } from '@/lib/hierarchy'
import { defaultAreaFor, useResults } from '@/components/ResultsProvider'
import { ValtypSelector } from '@/components/ValtypSelector'
import { ColorSchemeSelector } from '@/components/ColorSchemeSelector'
import { PlaceLabels } from '@/components/PlaceLabels'

// Färg för distrikt som rapporterat men vars vinnarparti saknar märkesfärg
// (lokalt parti utan hex i `party.color`). Orapporterade får null → UNREPORTED_FILL.
// Exporterade så partilegenden speglar exakt samma färger (en sanningskälla).
export const REPORTED_NEUTRAL = '#64748b'
export const UNREPORTED_FILL = '#334155'

// Kartfärgläge 'block' (RD-only, se ColorScheme/RIKET_BLOCKS): block A (V+S+MP+C) röd,
// block B (L+KD+M+SD) blå — Lars beslut (handover). Kulörerna är MEDVETET inte S:s eller
// M:s egna brandfärger (partyRef-hex) — annars kunde en användare läsa blockfärgen som
// "det här distriktets vinnare är S" resp. "M" i vanligt läge; blocken ska läsas som en
// egen, distinkt kategori. Exporterade så en ev. blocklegend kan spegla exakt samma hex.
export const BLOCK_COLOR_A = '#e11d48' // röd (rose-600) — inte S:s '#dc2626'-liknande ton
export const BLOCK_COLOR_B = '#2563eb' // blå (blue-600) — inte M:s '#1e40af'-liknande ton
// Baskulör vid 0 % i colorScheme 'party' — mörk, nära bakgrunden (INTE vit, se handover:
// "matchar mörka temat"). Egen konstant (skild från UNREPORTED_FILL, '#334155'): 0 %-
// rapporterat MEN 0 röster på just det valda partiet ska ändå skilja sig visuellt från
// "inget rapporterat alls" — se applyDistrict/buildPartyFillColorExpr.
export const PARTY_INTENSITY_BASE = '#0f172a'

interface BlockOutcome {
  winner: 'a' | 'b' | null
  share: number
  margin: number
  total: number
}

const hhmmss = () => new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// Upplösta gränser för kartfärgläget "grupp" (se ColorMode) — en per valtyp, eftersom
// gruppnivån skiljer (RD valkrets, RF region, KF kommun). Byggs av
// scripts/build-group-boundaries.mjs; se lib/geometry.ts.
const GROUP_BOUNDARIES_URL: Record<Valtyp, string> = {
  RD: VALKRETS_RD_BOUNDARIES_URL,
  RF: REGION_BOUNDARIES_URL,
  KF: KOMMUN_BOUNDARIES_URL,
}
// Samma "en nivå under riket" som ovan, men som en aggregat-Level (för
// applyComparison/districtsInArea) — RD: valkrets, RF: region, KF: kommun.
const GROUP_LEVEL: Record<Valtyp, Level> = { RD: 'valkrets', RF: 'region', KF: 'kommun' }

// Tom bakgrundsstil utan extern basemap: inga API-nycklar, inga externa tiles.
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } },
  ],
}

// riksdagsvalkrets/region kompletterar kommun (redan fanns) — de tre grupp-namnen
// (RD/RF/KF) som hoverBody väljer mellan i kartfärgläget "grupp" (se GROUP_LEVEL_LABEL).
type HoverInfo = { kod: string; namn: string; kommun: string; lan: string; riksdagsvalkrets: string; region: string }

// variant='mobile' → kartan renderas i en flik: den interna valtyp-väljaren, HUD:en och
// testdata-bannern släcks (den persistenta mobil-chromen äger dem), och `active` styr när
// fliken är synlig så kartan kan resiza:s efter att ha varit dold. Desktop anropar utan
// props → variant='desktop', active=true → oförändrat beteende.
export function DistrictMap({ variant = 'desktop', active = true, onOpenResult }: { variant?: 'desktop' | 'mobile'; active?: boolean; onOpenResult?: () => void } = {}) {
  // Delad state (karta + tabell). Kartan äger inte längre data — den läser storarna
  // och prenumererar på per-distrikt-ändringar via providern.
  const {
    valtyp,
    selectedArea,
    setSelectedArea,
    colorMode,
    colorScheme,
    selectedParty,
    storesRef,
    partyRef,
    metaRef,
    allCodesRef,
    groupsRef,
    comparisonRef,
    totalByValtyp,
    uppsamlingRegistryRef,
    uppsamlingRegistryReportedRef,
    subscribeChanges,
    snapshotVersion,
    realtimeConnected,
    pollError,
    dataset,
    kommuner,
    regioner,
    valkretsar,
    areaIndexRef,
    districtAndel2022Ref,
    ensureDistrictWinners2022,
    revision,
  } = useResults()

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  // Vilka feature-id:n som faktiskt har feature-state hover=true just nu — i
  // "grupp"-läget är det HELA gruppen (se groupDistrictsFor), annars bara hoveredIdRef.
  const hoveredGroupRef = useRef<string[]>([])
  const tooltipRef = useRef<HTMLDivElement>(null) // hover-rutan (positioneras vid pekaren via DOM)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  // Mobilens tapp-sheet: svep-neråt-i-handtaget för att stänga (best practice för bottom
  // sheets, jfr iOS/Android) — inte bara stäng-knappen. Draget följer fingret 1:1 (ingen
  // transition) tills release; över tröskeln stängs sheeten, annars fjädrar den tillbaka.
  // Bara handtaget är draggbart (inte hela sheeten) så det inte krockar med scroll i
  // innehållet eller klick på "Visa i Resultat".
  const [sheetDragY, setSheetDragY] = useState(0)
  const [sheetDragging, setSheetDragging] = useState(false)
  const sheetDragStartY = useRef(0)
  const SHEET_CLOSE_THRESHOLD = 80
  const onSheetHandleDown = (e: React.PointerEvent) => {
    sheetDragStartY.current = e.clientY
    setSheetDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onSheetHandleMove = (e: React.PointerEvent) => {
    if (!sheetDragging) return
    setSheetDragY(Math.max(0, e.clientY - sheetDragStartY.current))
  }
  const onSheetHandleUp = () => {
    if (sheetDragY > SHEET_CLOSE_THRESHOLD) setHover(null)
    setSheetDragging(false)
    setSheetDragY(0)
  }

  const pendingRef = useRef<Set<string>>(new Set())
  // Distrikt som INTE själva rapporterat men fick feature-state satt ändå, för att
  // 'grupp'-läget expanderar målningen till hela gruppen (se districtsToRepaint).
  // Måste kommas ihåg mellan repaint-cykler: byter man TILLBAKA till 'distrikt' (eller
  // stänger av 'party') räcker det inte att bara måla om pendingRef/den nya uträknade
  // mängden — dessa distrikt har redan ett explicit (icke-null) 'color' i feature-state
  // och skulle annars sitta kvar färgade för alltid (coalesce faller aldrig till grå).
  const groupPaintedRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number | null>(null)
  const sourceReadyRef = useRef(false)
  const activeValtypRef = useRef<Valtyp>(valtyp) // speglar `valtyp` för closures
  const colorModeRef = useRef<ColorMode>(colorMode) // speglar `colorMode` för closures
  // Kartfärgläge-METRIK (se ColorScheme) — speglar samma sätt som colorModeRef.
  const colorSchemeRef = useRef<ColorScheme>(colorScheme)
  const selectedPartyRef = useRef<string | null>(selectedParty)
  // 'grupp'-läget cachar gruppens (valkrets/region/kommun) sammanlagda vinnare per
  // distrikt — räknas om i scheduleFlush, inte per requestApply (en ändring i EN
  // distrikt kan byta hela gruppens vinnare, alla dess syskon måste då om-målas).
  const groupWinnersRef = useRef<Map<string, DistrictOutcome> | null>(null)
  // Samma sak för colorScheme 'block' — egen cache (annan form: block a/b, inte parti).
  const groupBlockWinnersRef = useRef<Map<string, BlockOutcome> | null>(null)
  // colorScheme 'party': delad per REPAINT-CYKEL (inte per distrikt) — se
  // recomputePartyShares. Skalan är DYNAMISK (mot max-distriktet denna cykel), så varje
  // distrikts intensitet beror på ALLA andras andelar, inte bara sin egen.
  const partyShareRef = useRef<Map<string, { share: number; total: number }>>(new Map())
  const partyMaxRef = useRef(0)
  // Bro mellan recolorActive (definierad utanför 'load') och updateBoundaryVisibility
  // (definierad inuti 'load', kräver att lagren finns) — satt en gång vid 'load'.
  const updateBoundaryVisibilityRef = useRef<(() => void) | null>(null)
  const variantRef = useRef(variant) // stabil åtkomst i map-event-closures (mount-en gång)
  const recolorRef = useRef<(() => void) | null>(null)
  const refitRef = useRef<(() => void) | null>(null) // re-fit mot nuvarande urval vid resize

  // Fokus/zoom-läge: distrikt-bboxar för fitBounds. Varje områdesval (kartklick,
  // dropdown, breadcrumb, drill) zoomar in på området och dimmar allt utanför.
  const boundsRef = useRef<Record<string, [number, number, number, number]>>({})
  const [boundsReady, setBoundsReady] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  // Laddningsindikator för förstagångsbesöket: BLANK_STYLE ritar bara den tomma mörka
  // bakgrunden tills geometrikällan (GEOMETRY_URL, ~1 MB brotli i prod) hämtats/parsats
  // OCH bitit (mapReady, satt strax efter). Utan denna ser besökaren bara en tom karta i
  // några sekunder. ~250 ms fördröjning innan den visas — en varm cache/snabb uppkoppling
  // hinner då bli klar utan att spinnern hinner flimra till.
  const [showMapLoading, setShowMapLoading] = useState(false)
  useEffect(() => {
    if (mapReady) {
      setShowMapLoading(false)
      return
    }
    const t = setTimeout(() => setShowMapLoading(true), 250)
    return () => clearTimeout(t)
  }, [mapReady])

  const [reportedCount, setReportedCount] = useState(0)
  // Riksomfattande slutlig-räkning (handover 14 sep, Val ANALYSIS) — synkas i LOCKSTEG med
  // reportedCount ovan (samma call sites, samma store), egen useState av samma skäl (undvik
  // att läsa ur en ref direkt i render — matchar det etablerade mönstret här).
  const [slutligDoneCount, setSlutligDoneCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null) // HH:MM:SS för senaste dataändring

  // Valtyp-medveten hierarki för hover-rutan (rad 2): det hovrade distriktets FÖRÄLDRAR
  // enligt aktiv valtyp — RD: Valkrets · Kommun, RF: Region · Valkrets, KF: Kommun · Valkrets
  // (område) — med Riket och lövet (distriktet självt) bortsläppta. ancestorsOf droppar
  // mellannivåer som inte delar (oindelad KF-kommun → bara Kommun; en-vk-region → Region;
  // RD-valkrets som ÄR en kommun → bara Valkrets). Samma kedja som panelens breadcrumb.
  const regionName = useMemo(() => new Map(regioner.map((r) => [r.code, r.name])), [regioner])
  const kommunName = useMemo(() => new Map(kommuner.map((k) => [k.code, k.name])), [kommuner])
  const valkretsName = useMemo(() => new Map(valkretsar.map((v) => [v.code, v.name])), [valkretsar])
  const hierarchyLabel = useMemo(() => {
    if (!hover) return ''
    const chain = ancestorsOf(valtyp, { level: 'distrikt', code: hover.kod }, areaIndexRef.current?.[valtyp])
    return chain
      .filter((n) => n.level !== 'riket' && n.level !== 'distrikt')
      .map((n) =>
        n.level === 'region' ? regionName.get(n.code ?? '')
        : n.level === 'kommun' ? kommunName.get(n.code ?? '')
        : valkretsName.get(n.code ?? ''),
      )
      .filter(Boolean)
      .join(' · ')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, valtyp, regionName, kommunName, valkretsName])

  // Hover-rutans mini-resultattabell för det hovrade distriktet (aktiv valtyp): parti per
  // rad, störst→minst, 2026-andel + ±procentenheter mot 2022 (2022-andelen visas ej separat).
  // Samma byggstenar som panelen (buildRows → applyComparison → collapseForDisplay). 2022 per
  // distrikt lat-laddas per kommun (ensureDistrictWinners2022, effekt nedan) → revision-bump
  // fyller i deltat. Saknas 2022 för distriktet → has2022=false → note "ej jämförbart".
  // Kartfärgläget "grupp": distrikten som delar det hovrade/tappade distriktets grupp
  // (RD valkrets via areaIndexRef, RF/RF-prefix via groupsRef — samma index som
  // computeGroupWinners i map-mount-effekten) resp. gruppens EGEN 2022-jämförelsekod.
  // 'grupp' → hela ARTIKELN visar gruppens resultat, inte bara det klickade distriktet.
  const groupDistrictsFor = (vd: string): string[] => {
    if (valtyp === 'RD') {
      const vk = areaIndexRef.current?.RD.districtToVk.get(vd)
      return (vk && areaIndexRef.current?.RD.vkToDistricts.get(vk)) || [vd]
    }
    const key = valtyp === 'RF' ? vd.slice(0, 2) : vd.slice(0, 4)
    const map = valtyp === 'RF' ? groupsRef.current?.byLan : groupsRef.current?.byKommun
    return map?.get(key) ?? [vd]
  }
  const groupAreaCodeFor = (vd: string): string | null =>
    valtyp === 'RD' ? (areaIndexRef.current?.RD.districtToVk.get(vd) ?? null)
      : valtyp === 'RF' ? vd.slice(0, 2)
        : vd.slice(0, 4)

  const hoverRows = useMemo(() => {
    if (!hover) return null
    const grouped = colorMode === 'grupp'
    const codes = grouped ? groupDistrictsFor(hover.kod) : [hover.kod]
    const votes = storesRef.current[valtyp].aggregate(codes)
    // hover.kod är alltid en 8-siffrig valdistriktskod (både i grupp- och distrikt-läge
    // — KF:s "grupp" ÄR kommunen, samma 4-siffriga prefix) → sparrFor('distrikt', ...)
    // ger rätt kommuns tröskel oavsett läge (RD/RF struntar i level, se sparrFor).
    const area = buildRows(votes, partyRef.current, sparrFor(valtyp, 'distrikt', hover.kod))
    // Grupp: samma 2022-jämförelse som region-/kommun-/valkrets-panelerna redan
    // använder (comparisonFor täcker RD-valkrets, RF-region, KF-kommun — se
    // aggregate.ts). Distrikt: den lat-laddade per-distrikt-facit-raden (oförändrat).
    const withCmp = grouped
      ? applyComparison(area, valtyp, GROUP_LEVEL[valtyp], groupAreaCodeFor(hover.kod), comparisonRef.current, partyRef.current)
      : applyComparison(
          area, valtyp, 'distrikt', hover.kod, null, partyRef.current,
          (() => {
            const a2022 = districtAndel2022Ref.current?.get(`${valtyp}:${hover.kod}`)
            return a2022 && Object.keys(a2022).length ? { andel: a2022, mandat: {} as Record<string, number> } : null
          })(),
        )
    return {
      display: collapseForDisplay(withCmp),
      giltiga: withCmp.giltiga,
      has2022: withCmp.rows.some((r) => r.andel2022 != null),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, valtyp, revision, colorMode])

  // Lat-ladda 2022-siffrorna för det hovrade distriktets kommun (deduppat i providern).
  // Bara distrikt-läget behöver detta — gruppläget använder redan-laddad comparisonRef
  // (statisk fil, samma som region-/kommun-panelerna) synkront i hoverRows ovan.
  useEffect(() => {
    if (hover?.kod && colorMode === 'distrikt') ensureDistrictWinners2022(valtyp, hover.kod.slice(0, 4))
  }, [hover?.kod, valtyp, colorMode, ensureDistrictWinners2022])

  // Mobil-fliken döljs med `hidden` (display:none) när man är på en annan flik. MapLibre
  // mäter då containern till 0 → måste resiza:s när fliken blir synlig igen. Om urvalet
  // ändrades MEDAN fliken var dold (t.ex. "Hela Sverige"-knappen i MobileChrome, som är
  // synlig och klickbar från Resultat-fliken) räknade fokuseffekten ut fitBounds mot den
  // dolda 0×0-containern → fel (för utzoomad) kamera. resize() ensam rättar bara
  // canvasens upplösning, inte den redan felaktiga zoomen — måste refit:a på nytt (utan
  // animation, som vid fönsterresize) efter resize för att landa på rätt zoom/centrering.
  // På desktop är active alltid true (ändras aldrig) → körs en gång vid mount som en no-op.
  useEffect(() => {
    if (active) {
      mapRef.current?.resize()
      refitRef.current?.()
    } else setHover(null) // lämnar Karta-fliken → stäng ev. öppen tapp-sheet
  }, [active])

  // Mobil: tapp-sheeten (hover-state) är HELT separat från selectedArea (ResultsProvider)
  // — "Hela Sverige"-knappen (MobileChrome) och andra externa återställningar till
  // valtypens toppnivå (t.ex. valtyp-byte) rör bara selectedArea, aldrig hover. Utan
  // detta hängde sheeten kvar med ett gammalt distrikts/gruppens resultat trots att
  // kartan redan zoomat ut och deselectat — stäng den när urvalet går tillbaka till
  // toppnivån (samma atDefault-check som "Hela Sverige"-knappens egen synlighet).
  useEffect(() => {
    if (variant !== 'mobile' || !hover) return
    const def = defaultAreaFor(valtyp)
    if (selectedArea.level === def.level && selectedArea.code === def.code) setHover(null)
  }, [selectedArea, valtyp, variant, hover])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BLANK_STYLE,
      bounds: SWEDEN_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    let removed = false // vakt: rAF/sourcedata får inte röra en borttagen karta
    if (import.meta.env.DEV) {
      ;(window as unknown as { __map?: maplibregl.Map }).__map = map
    }
    // Bottom-right, förskjuten vänster om resultatpanelen via CSS (annars hamnar
    // zoom-knapparna under panelen och blockerar områdesväljaren).
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    map.on('error', (e) => {
      console.error('[DistrictMap] maplibre error:', e.error ?? e)
    })

    // Vinnare ur en röstsumma per parti — samma logik som ResultStore.outcome, men
    // från ett redan hopslaget Record (gruppens aggregat, inte ETT distrikts).
    const EMPTY_OUTCOME: DistrictOutcome = { winner: null, share: 0, margin: 0, total: 0 }
    const outcomeFromVotes = (votes: Record<string, number>): DistrictOutcome => {
      let total = 0, top = -1, second = -1, winner: string | null = null
      for (const [p, v] of Object.entries(votes)) {
        total += v
        if (v > top) { second = top; top = v; winner = p } else if (v > second) second = v
      }
      return { winner, share: total > 0 ? top / total : 0, margin: total > 0 ? (top - Math.max(second, 0)) / total : 0, total }
    }
    // Kartfärgläge 'block' (RD-only): samma form som outcomeFromVotes, men summerar
    // röster per BLOCK (RIKET_BLOCKS, join-nyckel FORKORTNING — inte partikod, se
    // MandatBars.blockSum som gör samma översättning) i stället för per parti.
    // RIKET_BLOCKS.a/b.parties är alltid explicita listor (aldrig 'rest', till skillnad
    // från region-/kommunstyre-blocken i soffa.ts) — cast:as en gång utanför loopen.
    const blockAParties = RIKET_BLOCKS.a.parties as string[]
    const blockBParties = RIKET_BLOCKS.b.parties as string[]
    const outcomeForBlocks = (votes: Record<string, number>): BlockOutcome => {
      let a = 0, b = 0, total = 0
      for (const [pk, v] of Object.entries(votes)) {
        total += v
        const fork = partyRef.current.get(pk)?.forkortning
        if (fork && blockAParties.includes(fork)) a += v
        else if (fork && blockBParties.includes(fork)) b += v
      }
      const winner: BlockOutcome['winner'] = a === b ? null : a > b ? 'a' : 'b'
      const top = Math.max(a, b)
      const second = Math.min(a, b)
      return { winner, share: total > 0 ? top / total : 0, margin: total > 0 ? (top - second) / total : 0, total }
    }
    // Kartfärgläge 'party': ETT partis (forkortning) andel av det totala röstetalet.
    const partyShareFromVotes = (votes: Record<string, number>, forkortning: string): { share: number; total: number } => {
      let total = 0, target = 0
      for (const [pk, v] of Object.entries(votes)) {
        total += v
        if (partyRef.current.get(pk)?.forkortning === forkortning) target += v
      }
      return { share: total > 0 ? target / total : 0, total }
    }
    // Grupperingsindexet (distrikt-lista per grupp) för en valtyp — redan förberäknat
    // (areaIndexRef.RD.vkToDistricts för valkrets; groupsRef.byLan/byKommun — samma
    // index som mandaträkningen — för region/kommun). Delas av computeGroupWinners
    // (röstsumma per grupp) och groupDistrictsFor (hover-highlightens utbredning).
    const groupDistrictMapFor = (vt: Valtyp): Map<string, string[]> =>
      vt === 'RD' ? areaIndexRef.current.RD.vkToDistricts
        : vt === 'RF' ? groupsRef.current.byLan
          : groupsRef.current.byKommun
    // Kartfärgläge 'grupp': varje distrikt får sin GRUPPS (en nivå under riket —
    // RD valkrets, RF region, KF kommun) sammanlagda vinnare i stället för sin egen.
    // → bara röstsumman räknas om här, O(alla distrikt) totalt, inte O(grupper × alla).
    const computeGroupWinners = (vt: Valtyp): Map<string, DistrictOutcome> => {
      const store = storesRef.current[vt]
      const result = new Map<string, DistrictOutcome>()
      for (const districts of groupDistrictMapFor(vt).values()) {
        const outcome = outcomeFromVotes(store.aggregate(districts))
        for (const vd of districts) result.set(vd, outcome)
      }
      return result
    }
    // Samma sak för colorScheme 'block' (RD-only) — se outcomeForBlocks ovan.
    const computeGroupBlockWinners = (vt: Valtyp): Map<string, BlockOutcome> => {
      const store = storesRef.current[vt]
      const result = new Map<string, BlockOutcome>()
      for (const districts of groupDistrictMapFor(vt).values()) {
        const outcome = outcomeForBlocks(store.aggregate(districts))
        for (const vd of districts) result.set(vd, outcome)
      }
      return result
    }
    // Samma sak för colorScheme 'party' — röstandel för VALT parti per grupp i stället
    // för per distrikt (granularitets-togglen gäller alla tre metrikerna, se ColorScheme).
    const computeGroupPartyShares = (vt: Valtyp, forkortning: string): Map<string, { share: number; total: number }> => {
      const store = storesRef.current[vt]
      const result = new Map<string, { share: number; total: number }>()
      for (const districts of groupDistrictMapFor(vt).values()) {
        const s = partyShareFromVotes(store.aggregate(districts), forkortning)
        for (const vd of districts) result.set(vd, s)
      }
      return result
    }
    // I 'grupp'-läge ska HELA gruppen (valkrets/region/kommun) färgas så fort NÅGOT
    // distrikt i den rapporterat — inte bara de enskilda distrikt som själva har data.
    // computeGroupWinners/-BlockWinners/computeGroupPartyShares sätter redan samma
    // utfall för ALLA medlemsdistrikt (se ovan), men om repaint-loopen bara går igenom
    // storesRef.current[vt].districts() (de som FAKTISKT rapporterat) får resten av
    // gruppen aldrig sitt feature-state satt → förblir grå trots att aggregatet redan
    // finns. Denna funktion ger rätt mängd att gå igenom beroende på läge.
    const districtsToRepaint = (vt: Valtyp): Iterable<string> => {
      const store = storesRef.current[vt]
      if (colorModeRef.current !== 'grupp') return store.districts()
      const expanded = new Set<string>()
      for (const districts of groupDistrictMapFor(vt).values()) {
        if (districts.some((vd) => store.has(vd))) for (const vd of districts) expanded.add(vd)
      }
      return expanded
    }
    // Distrikten som delar vd:s grupp (aktiv valtyp) — används för att låta hover-
    // highlighten (feature-state 'hover') täcka HELA gruppen i stället för bara det
    // enskilda polygon-fältet pekaren råkar stå på. O(1): RD via districtToVk-
    // uppslaget, RF/KF är ett rent prefix (län/kommun) av valdistriktskoden.
    const groupDistrictsFor = (vd: string): string[] => {
      const vt = activeValtypRef.current
      if (vt === 'RD') {
        const vk = areaIndexRef.current.RD.districtToVk.get(vd)
        return (vk && areaIndexRef.current.RD.vkToDistricts.get(vk)) || [vd]
      }
      const key = vt === 'RF' ? vd.slice(0, 2) : vd.slice(0, 4)
      return groupDistrictMapFor(vt).get(key) ?? [vd]
    }
    // vd:s gruppKOD (aktiv valtyp) — används av klick-hanteraren i "grupp"-läget så
    // ett klick väljer HELA gruppen (valkrets/region/kommun), inte bara det klickade
    // enskilda distriktet (annars zoomar/visar panelen fel område, se click-handlern
    // nedan). Samma O(1)-uppslag som groupDistrictsFor.
    const groupAreaCodeFor = (vd: string): string | null => {
      const vt = activeValtypRef.current
      if (vt === 'RD') return areaIndexRef.current.RD.districtToVk.get(vd) ?? null
      return vt === 'RF' ? vd.slice(0, 2) : vd.slice(0, 4)
    }

    // --- Applicera ett distrikts resultat FÖR DEN AKTIVA VALTYPEN --------------
    const applyDistrict = (vd: string) => {
      if (removed) return
      const scheme = colorSchemeRef.current
      if (scheme === 'party' && selectedPartyRef.current) {
        // Se recomputePartyShares — partyShareRef/partyMaxRef räknas om för HELA
        // repaint-cykeln innan applyDistrict anropas (dynamisk skala, se ColorScheme).
        const s = partyShareRef.current.get(vd)
        const total = s?.total ?? 0
        const max = partyMaxRef.current
        const intensity = total > 0 && max > 0 ? Math.min(1, s!.share / max) : 0
        map.setFeatureState({ source: 'districts', id: vd }, { reported: total > 0, partyIntensity: total > 0 ? intensity : null, margin: 0 })
        return
      }
      if (scheme === 'block') {
        const o =
          colorModeRef.current === 'grupp'
            ? (groupBlockWinnersRef.current?.get(vd) ?? { winner: null, share: 0, margin: 0, total: 0 })
            : outcomeForBlocks(storesRef.current[activeValtypRef.current].aggregate([vd]))
        const color = o.winner === 'a' ? BLOCK_COLOR_A : o.winner === 'b' ? BLOCK_COLOR_B : null
        map.setFeatureState({ source: 'districts', id: vd }, { reported: o.total > 0, color: o.total > 0 ? color : null, margin: o.margin })
        return
      }
      const o =
        colorModeRef.current === 'grupp'
          ? (groupWinnersRef.current?.get(vd) ?? EMPTY_OUTCOME)
          : storesRef.current[activeValtypRef.current].outcome(vd)
      const color = (o.winner && partyRef.current.get(o.winner)?.farg) || REPORTED_NEUTRAL
      map.setFeatureState(
        { source: 'districts', id: vd },
        // Orapporterat i denna valtyp → color null så coalesce faller till grått
        // (annars sitter förra valtypens färg kvar — feature-state persisterar).
        { reported: o.total > 0, color: o.total > 0 ? color : null, margin: o.margin },
      )
    }

    // colorScheme 'party': körs en gång PER REPAINT-CYKEL (inte per distrikt, till
    // skillnad från block/largest) — skalan är DYNAMISK mot max-distriktet just nu
    // (handover: "partiandelar går sällan över ~40-50 % ens i starka fästen; fast
    // skala 0–100 % skulle göra kartan blek"), så EN ändring i valfritt distrikt kan
    // ändra vilket distrikt som är "max" och därmed alla andras normaliserade intensitet.
    const recomputePartyShares = () => {
      const party = selectedPartyRef.current
      if (!party) return
      const vt = activeValtypRef.current
      const store = storesRef.current[vt]
      const shares =
        colorModeRef.current === 'grupp'
          ? computeGroupPartyShares(vt, party)
          : new Map([...store.districts()].map((vd) => [vd, partyShareFromVotes(store.aggregate([vd]), party)]))
      let max = 0
      for (const s of shares.values()) if (s.total > 0 && s.share > max) max = s.share
      partyShareRef.current = shares
      partyMaxRef.current = max
    }

    // rAF-koalescerad repaint (many events/tick → one paint), ingen fördröjande timer.
    const scheduleFlush = () => {
      if (rafRef.current != null || removed) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (removed) return
        let toPaint: Set<string>
        if (colorSchemeRef.current === 'party' && selectedPartyRef.current && pendingRef.current.size > 0) {
          // Samma skäl som 'grupp'-grenen nedan: en ändring var som helst kan ändra
          // den dynamiska maxskalan → måla om ALLA, inte bara pendingRef-posterna.
          // districtsToRepaint expanderar till HELA gruppen om colorMode='grupp' (se
          // dess kommentar) — annars bara de som faktiskt rapporterat, som förut.
          recomputePartyShares()
          toPaint = new Set()
          for (const vt of VALTYPER) for (const vd of districtsToRepaint(vt)) toPaint.add(vd)
        } else if (colorModeRef.current === 'grupp' && pendingRef.current.size > 0) {
          // En ändring i ETT distrikt kan byta hela gruppens vinnare → måla om ALLA
          // (samma unions-iteration som recolorActive), inte bara pendingRef-posterna.
          if (colorSchemeRef.current === 'block') groupBlockWinnersRef.current = computeGroupBlockWinners(activeValtypRef.current)
          else groupWinnersRef.current = computeGroupWinners(activeValtypRef.current)
          toPaint = new Set()
          for (const vt of VALTYPER) for (const vd of districtsToRepaint(vt)) toPaint.add(vd)
        } else {
          toPaint = new Set(pendingRef.current)
        }
        // Rensa kvarvarande grupp-målad yta från en TIDIGARE cykel som inte längre ska
        // vara målad i detta läge (t.ex. bytte tillbaka från 'grupp' till 'distrikt', eller
        // stängde av 'party') — dessa distrikt har redan ett explicit (icke-null) 'color' i
        // feature-state sedan förra cykeln och skulle annars sitta kvar färgade för alltid
        // (coalesce faller aldrig till grå av sig själv). applyDistrict räknar om dem enligt
        // det NU aktiva läget, vilket korrekt nollställer dem om de inte längre ska vara med.
        for (const vd of groupPaintedRef.current) toPaint.add(vd)
        groupPaintedRef.current = colorModeRef.current === 'grupp' ? new Set(toPaint) : new Set()
        for (const vd of toPaint) applyDistrict(vd)
        pendingRef.current.clear()
        const n = storesRef.current[activeValtypRef.current].reportedCount
        setReportedCount(n)
        setSlutligDoneCount(storesRef.current[activeValtypRef.current].slutligDoneCount)
        setLastUpdated(hhmmss())
        ;(window as unknown as { __reportedCount?: number }).__reportedCount = n
      })
    }
    const requestApply = (vd: string) => {
      pendingRef.current.add(vd)
      if (sourceReadyRef.current) scheduleFlush()
    }
    // fill-color-uttrycket för colorScheme 'largest'/'block' (BÅDA delar samma
    // pipeline — bara VAD applyDistrict skriver till feature-state 'color' skiljer,
    // se ovan). Extraherad konstant: samma uttryck sätts både vid addLayer (nedan)
    // och när man växlar TILLBAKA hit från 'party' (som byter hela uttrycket, se
    // applyFillColorExpression) — en sanningskälla i stället för två literaler.
    // any: MapLibres exakta expression-typ (DataDrivenPropertyValueSpecification, från
    // @maplibre/maplibre-gl-style-spec) exporteras inte av maplibre-gl:s egna .d.ts —
    // samma pragmatiska cast som resten av style-uttrycken i denna fil implicit fick via
    // kontextuell typning inline (addLayer-literalen), tills de extraherades hit.
    const DEFAULT_FILL_COLOR_EXPR: any = [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      '#38bdf8',
      // Utanför valt område (fokusläge) → dämpad grå, oavsett resultatfärg (men syns).
      ['boolean', ['feature-state', 'dimmed'], false],
      '#475569',
      ['coalesce', ['feature-state', 'color'], UNREPORTED_FILL],
    ]
    // colorScheme 'party': EGET fill-color-uttrygg (inte bara ett annat feature-state-
    // värde på samma uttryck som ovan) — en sekventiell choropleth (interpolate) mot
    // det valda partiets EGNA färg, läser 'partyIntensity' (redan normaliserad 0..1 mot
    // den dynamiska maxskalan, se recomputePartyShares/applyDistrict) i stället för
    // 'color'. 'reported'-grenen behövs EXPLICIT här (till skillnad från ovan, där
    // coalesce räcker) — annars skulle ett orapporterat distrikt (ingen feature-state
    // alls) tolkas som "intensitet 0" (PARTY_INTENSITY_BASE) och se identiskt ut som
    // "rapporterat, 0 röster på det valda partiet" — två helt olika saker.
    const buildPartyFillColorExpr = (partyColor: string): any => [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      '#38bdf8',
      ['boolean', ['feature-state', 'dimmed'], false],
      '#475569',
      ['!', ['boolean', ['feature-state', 'reported'], false]],
      UNREPORTED_FILL,
      ['interpolate', ['linear'], ['coalesce', ['feature-state', 'partyIntensity'], 0], 0, PARTY_INTENSITY_BASE, 1, partyColor],
    ]
    // Växlar fill-color-UTTRYCKET (inte bara feature-state-värden) mellan default
    // (largest/block) och party-intensity-varianten — anropas vid varje recolorActive,
    // dvs vid mount, valtyp-/colorMode-/colorScheme-/selectedParty-byte. Partiets FÄRG
    // slås upp via forkortning (stabil över valtyper, se selectedPartyRef-kommentaren).
    const applyFillColorExpression = () => {
      if (colorSchemeRef.current === 'party' && selectedPartyRef.current) {
        let partyColor: string | null = null
        for (const meta of partyRef.current.values()) {
          if (meta.forkortning === selectedPartyRef.current && meta.farg) {
            partyColor = meta.farg
            break
          }
        }
        map.setPaintProperty('district-fill', 'fill-color', buildPartyFillColorExpr(partyColor ?? REPORTED_NEUTRAL))
      } else {
        map.setPaintProperty('district-fill', 'fill-color', DEFAULT_FILL_COLOR_EXPR)
      }
    }

    // Färga om ALLA distrikt som har resultat i NÅGON valtyp, från aktiv valtyp.
    // Måste iterera unionen — annars behåller distrikt som fanns i förra valtypen
    // men saknas i den nya sin gamla färg (feature-state-fällan vid växling).
    const recolorActive = () => {
      updateBoundaryVisibilityRef.current?.()
      if (!sourceReadyRef.current || removed) return
      applyFillColorExpression()
      for (const vt of VALTYPER)
        for (const vd of storesRef.current[vt].districts()) pendingRef.current.add(vd)
      scheduleFlush()
    }
    recolorRef.current = recolorActive

    map.on('load', () => {
      map.addSource('districts', {
        type: 'geojson',
        data: GEOMETRY_URL,
        promoteId: DISTRICT_ID_PROPERTY,
      })

      map.addLayer({
        id: 'district-fill',
        type: 'fill',
        source: 'districts',
        paint: {
          'fill-color': DEFAULT_FILL_COLOR_EXPR,
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.92,
            // Dimmat (utanför fokus) tonas ned men förblir synligt (pale) så omgivningen syns.
            ['boolean', ['feature-state', 'dimmed'], false],
            0.3,
            ['boolean', ['feature-state', 'reported'], false],
            0.92,
            0.5,
          ],
        },
      })
      map.addLayer({
        id: 'district-line',
        type: 'line',
        source: 'districts',
        paint: {
          // Fokusområdets distrikt får en ljus, tydligare kant → gränsen mot omgivningen
          // framträder. Utanför fokus: svag delning (så pale-omgivningen syns strukturerad).
          // Utan fokus (nationell vy): nästan osynlig, som förr.
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'focused'], false],
            '#e2e8f0',
            ['boolean', ['feature-state', 'dimmed'], false],
            '#334155',
            '#0f172a',
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'focused'], false],
            1.1,
            0.3,
          ],
        },
      })

      // Upplösta gruppgränser (kartfärgläget "grupp") — en källa/lager PER valtyp
      // (gruppnivån skiljer sig, se GROUP_BOUNDARIES_URL). Dolda by default; en enda
      // synlig åt gången (aktiv valtyp), styrt av updateBoundaryVisibility nedan.
      for (const vt of VALTYPER) {
        map.addSource(`group-boundaries-${vt}`, { type: 'geojson', data: GROUP_BOUNDARIES_URL[vt] })
        map.addLayer({
          id: `group-line-${vt}`,
          type: 'line',
          source: `group-boundaries-${vt}`,
          layout: { visibility: 'none' },
          paint: { 'line-color': '#e2e8f0', 'line-width': 1.3 },
        })
      }
      // Växla mellan distriktens FINA gränser (default) och EN valtyps upplösta
      // gruppgräns (kartfärgläget "grupp") — annars syns distriktszickzacket kvar
      // som en förvirrande mosaik inuti varje färgad grupp.
      const updateBoundaryVisibility = () => {
        const grouped = colorModeRef.current === 'grupp'
        map.setLayoutProperty('district-line', 'visibility', grouped ? 'none' : 'visible')
        for (const vt of VALTYPER) {
          map.setLayoutProperty(`group-line-${vt}`, 'visibility', grouped && vt === activeValtypRef.current ? 'visible' : 'none')
        }
      }
      updateBoundaryVisibilityRef.current = updateBoundaryVisibility
      updateBoundaryVisibility()

      // Källan redo → setFeatureState biter; applicera hittills laddade resultat.
      map.on('sourcedata', (e) => {
        if (e.sourceId !== 'districts' || !map.isSourceLoaded('districts')) return
        if (sourceReadyRef.current) return
        sourceReadyRef.current = true
        recolorActive()
        setMapReady(true) // källan biter nu → fokus/zoom-effekten får köra
      })

      // I "grupp"-läget (Valkrets/Region/Kommun) highlightas HELA gruppens polygoner,
      // inte bara det enskilda fältet pekaren råkar stå på — annars ser highlighten
      // (och därmed vad man tror man pekar på) ut att gälla ett enda litet valdistrikt
      // trots att hover-rutan visar hela gruppens resultat (se hoverRows/hoverBody).
      const setHovered = (id: string | null) => {
        if (hoveredIdRef.current === id) return
        for (const prevId of hoveredGroupRef.current) {
          map.setFeatureState({ source: 'districts', id: prevId }, { hover: false })
        }
        hoveredIdRef.current = id
        const ids = id === null ? [] : colorModeRef.current === 'grupp' ? groupDistrictsFor(id) : [id]
        hoveredGroupRef.current = ids
        for (const newId of ids) {
          map.setFeatureState({ source: 'districts', id: newId }, { hover: true })
        }
      }

      // Placera hover-rutan vid pekaren: default ovanför-till-höger (täcker aldrig
      // distriktet man pekar på), flippa vänster nära panelen och nedåt nära toppen.
      // Ren DOM-positionering (transform) → ingen React-render per musrörelse.
      const positionTooltip = (px: number, py: number) => {
        const el = tooltipRef.current
        if (!el) return
        const pad = 14
        const panelW = document.querySelector('aside')?.clientWidth ?? 0
        const usableW = window.innerWidth - panelW
        const w = el.offsetWidth || 220
        const h = el.offsetHeight || 84
        let x = px + pad
        let y = py - h - pad
        if (x + w > usableW - 8) x = px - pad - w // flippa vänster nära panelen
        if (y < 8) y = py + pad // flippa nedåt nära toppen
        if (x < 8) x = 8
        el.style.transform = `translate(${x}px, ${y}px)`
      }

      // Hover-rutan är musdriven → bara desktop. På touch finns ingen mouseleave, så en
      // hover-highlight skulle fastna; mobilen använder i stället tapp→sheet (nedan).
      if (variantRef.current !== 'mobile') {
        map.on('mousemove', 'district-fill', (e) => {
          const f = e.features?.[0]
          if (!f) return
          map.getCanvas().style.cursor = 'pointer'
          positionTooltip(e.point.x, e.point.y) // följ pekaren varje rörelse
          const id = String(f.id)
          if (id === hoveredIdRef.current) return
          setHovered(id)
          const p = f.properties ?? {}
          setHover({
            kod: id,
            namn: p.Valdistriktsnamn ?? '',
            kommun: p.Kommun ?? '',
            lan: p['Län'] ?? '',
            riksdagsvalkrets: p['Riksdagsvalkrets'] ?? '',
            region: p['Region'] ?? '',
          })
        })
        map.on('mouseleave', 'district-fill', () => {
          map.getCanvas().style.cursor = ''
          setHovered(null)
          setHover(null)
        })
      }

      // Klick/tapp på ett distrikt → zooma in (via fokuseffekten) och visa distriktets
      // fullständiga partibrytning i tabellen. Minsta kartdelen = minsta tabellnivån.
      // Mandat och ±2022 saknas på distriktsnivå (inget organ fördelas) → "–". Distriktet
      // är samma kod i alla tre valen. Mobil: tappet öppnar dessutom en bottom-sheet med
      // distriktets mini-resultat (samma hoverRows-pipeline, matar `hover`).
      map.on('click', 'district-fill', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const id = String(f.id)
        // "grupp"-läget: klick väljer HELA gruppen (valkrets/region/kommun) — annars
        // zoomar fokuseffekten (körs på selectedArea.level==='distrikt' → hela
        // KOMMUNEN) och panelen visar fel/för snävt område jämfört med vad kartan
        // faktiskt highlightar/färglägger vid hovring (se groupDistrictsFor ovan).
        setSelectedArea(
          colorModeRef.current === 'grupp'
            ? { level: GROUP_LEVEL[activeValtypRef.current], code: groupAreaCodeFor(id) }
            : { level: 'distrikt', code: id },
        )
        if (variantRef.current === 'mobile') {
          const p = f.properties ?? {}
          setHover({
            kod: id,
            namn: p.Valdistriktsnamn ?? '',
            kommun: p.Kommun ?? '',
            lan: p['Län'] ?? '',
            riksdagsvalkrets: p['Riksdagsvalkrets'] ?? '',
            region: p['Region'] ?? '',
          })
        }
      })
    })

    // Per-distrikt-notis från providern (Realtime). Kartan bryr sig bara om aktiv
    // valtyp; store.set har redan skett i providern → vi bara begär ompaint.
    const unsubscribe = subscribeChanges((vd, vt) => {
      if (vt === activeValtypRef.current) requestApply(vd)
    })

    setReportedCount(storesRef.current[activeValtypRef.current].reportedCount)
    setSlutligDoneCount(storesRef.current[activeValtypRef.current].slutligDoneCount)

    return () => {
      unsubscribe()
      removed = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      recolorRef.current = null
      updateBoundaryVisibilityRef.current = null
      map.remove()
      mapRef.current = null
    }
    // Mount-en-gång: areaIndexRef/groupsRef läses via .current i computeGroupWinners
    // (samma refs-inte-deps-mönster som storesRef/partyRef ovan — de är refar, inte
    // reaktiv state, och ska inte trigga en ny karta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeChanges, storesRef, partyRef, setSelectedArea])

  // Bulkladdning (referens/snapshot) klar → full ompaint + färsk räknare.
  useEffect(() => {
    recolorRef.current?.()
    const n = storesRef.current[activeValtypRef.current].reportedCount
    setReportedCount(n)
    setSlutligDoneCount(storesRef.current[activeValtypRef.current].slutligDoneCount)
    if (n > 0) setLastUpdated(hhmmss())
  }, [snapshotVersion, storesRef])

  // Valtyp-växling: uppdatera aktiv valtyp och färga om kartan från dess store.
  useEffect(() => {
    activeValtypRef.current = valtyp
    if (import.meta.env.DEV) {
      ;(window as unknown as { __valtyp?: Valtyp }).__valtyp = valtyp
    }
    setReportedCount(storesRef.current[valtyp].reportedCount)
    setSlutligDoneCount(storesRef.current[valtyp].slutligDoneCount)
    recolorRef.current?.()
    // Hover-rutans mini-tabell räknar om via hoverRows (nyckel: valtyp + revision).
  }, [valtyp, storesRef])

  // Kartfärgläge-växling (Valdistrikt ⇄ Valkrets/Region/Kommun) — måla om direkt,
  // samma väg som valtyp-bytet ovan (gruppnivån följer valtypen, se GROUP_LEVEL_LABEL).
  useEffect(() => {
    colorModeRef.current = colorMode
    recolorRef.current?.()
  }, [colorMode])

  // Kartfärgläge-METRIK-växling (Största parti ⇄ Block ⇄ Parti-intensitet) — samma väg
  // som ovan. recolorActive() sköter BÅDE fill-color-uttrycks-swappen (applyFillColor-
  // Expression, vid behov för 'party') och den faktiska ompaintningen i ett svep.
  useEffect(() => {
    colorSchemeRef.current = colorScheme
    selectedPartyRef.current = selectedParty
    recolorRef.current?.()
  }, [colorScheme, selectedParty])

  // Ladda distrikt-bboxarna en gång (samma mönster som comparison-2022.json).
  useEffect(() => {
    let alive = true
    fetch('/district-bounds.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data) {
          boundsRef.current = data
          setBoundsReady(true)
        }
      })
      .catch((err) => console.error('[DistrictMap] district-bounds.json:', err))
    return () => {
      alive = false
    }
  }, [])

  // Fokusläge: när ett område väljs (kartklick, väljare, breadcrumb, avgångstavla)
  // zoomas kartan till området och allt utanför gråas ut. Toppnivå (code == null:
  // Riket resp. RF/KF-prompt) → zooma ut till hela Sverige + avdimma allt.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !boundsReady) return
    const { level, code } = selectedArea
    const codes =
      level !== 'riket' && code != null
        ? districtsInArea(allCodesRef.current, level, code, valtyp, metaRef.current)
        : []
    const on = codes.length > 0 // äkta fokus (undvik att gråa ut allt vid tomt urval)
    const inSet = new Set(codes)
    // Dimma varje distrikt utanför fokus; markera fokusdistrikten (ljus kant). Vid Riket/
    // tomt urval (on=false) blir båda false för alla → nationell vy oförändrad.
    for (const vd of allCodesRef.current) {
      map.setFeatureState({ source: 'districts', id: vd }, {
        dimmed: on && !inSet.has(vd),
        focused: on && inSet.has(vd),
      })
    }
    // Ram att zooma till: ett distrikt zoomas till HELA sin kommun (samma 4-siffriga
    // prefix) så kommunen syns runt det markerade distriktet — inte bara distriktet
    // självt (annars blir det för snävt). Övriga nivåer zoomar till sitt fokusområde.
    const boxCodes =
      level === 'distrikt' && code
        ? districtsInArea(allCodesRef.current, 'kommun', code.slice(0, 4), valtyp, metaRef.current)
        : codes
    // Målramen (geografisk) beräknas EN gång — den ändras inte av fönsterstorleken. Bara
    // paddingen gör det (panel/tavlor-bredd), så den räknas om inuti runFit → en resize
    // re-fit:ar mot samma urval men mot den nya ytan.
    let box: [number, number, number, number] | null = null
    if (on) {
      const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const vd of boxCodes) {
        const b = boundsRef.current[vd]
        if (!b) continue
        if (b[0] < bb[0]) bb[0] = b[0]
        if (b[1] < bb[1]) bb[1] = b[1]
        if (b[2] > bb[2]) bb[2] = b[2]
        if (b[3] > bb[3]) bb[3] = b[3]
      }
      if (Number.isFinite(bb[0])) box = bb
    }
    // Panelen (höger, --panel-w) OCH avgångstavlorna (vänster) ligger ÖVER kartan. fitBounds
    // centrerar i HELA behållaren → reservera BÅDA som padding så Sverige/området hamnar i det
    // rena fältet mellan dem (samma mittlinje som valtyp-väljaren ovanför), inte under någotdera.
    // De symmetriska 24 px-glappen tar ut varandra i mittpunkten → kartan och väljaren delar
    // exakt mittlinje. Topp-paddingen (150) ger väljaren ett eget luftigt fält ovanför kartan.
    const runFit = (duration: number) => {
      const m = mapRef.current
      if (!m) return
      // Mobil: inga sido-overlays över kartan → symmetrisk padding (ingen 150-topp som på
      // desktop, där den reserverade väljarfältet). Extra bottenpadding när ett distrikt är
      // valt så det inte hamnar under tapp-sheeten. Desktop: reservera panel + tavlor.
      let pad: { top: number; right: number; bottom: number; left: number }
      if (variant === 'mobile') {
        pad = { top: 24, right: 24, bottom: selectedArea.level === 'distrikt' ? 240 : 40, left: 24 }
      } else {
        const panelW = document.querySelector('aside')?.clientWidth ?? 0
        const boardsRight = document.getElementById('left-boards')?.getBoundingClientRect().right ?? 0
        // Väljarraden hoppar upp (top-14 → top-4, se dataset?.test nedan i JSX:en) när
        // testdata-bannern släcks — annars reserverar fitBounds ett tomt fält ovanför
        // väljaren i stället för att kartan faktiskt får den frigjorda ytan.
        pad = { top: dataset?.test ? 150 : 110, right: panelW + 24, bottom: 48, left: Math.round(boardsRight) + 24 }
      }
      // maxZoom kapar bara mycket små kommuner — annars fit:ar vi områdets egen utsträckning.
      if (on && box && level === 'distrikt') {
        // Tapp på ett distrikt (karta eller avgångstavla) ska INTE zooma ut: fitBounds till
        // hela kommunen zoomar annars ut varje gång man redan tittar närmare in än vad
        // kommunen kräver — vi vill bara zooma IN vid behov, aldrig ut.
        //
        // cameraForBounds().center är dock BARA korrekt ihopparat med DESS EGEN uträknade
        // zoom: asymmetrisk padding (panel/tavlor/tapp-sheet) bakas in som ett pixel→grad-
        // offset som skalas efter den zoomen internt (se maplibre-gl:s cameraForBoxAndBearing
        // — offsetet divideras med zoomScale(zoom)). Att återanvända samma center men tvinga
        // fram en ANNAN (högre) zoom skalar det offsetet exponentiellt fel → kartan "gled"
        // iväg upp/ner och det tappade distriktet kunde hamna helt utanför vyn vid djup
        // inzoomning (även en distriktsbox har samma problem: glesbygdsdistrikt kan vara så
        // stora att DERAS egen fit-zoom också ligger under den man redan tittar på).
        //
        // Fix: räkna alltid ut center själv, EXAKT för zoomen vi faktiskt landar på — genom
        // att hoppa dit temporärt (project/unproject, inga andra listeners hinner rita om
        // något innan vi hoppar tillbaka, allt sker synkront) i stället för att lita på
        // cameraForBounds egna, zoom-bundna offset.
        const currentZoom = m.getZoom()
        const kommunZoom = m.cameraForBounds(box, { padding: pad, maxZoom: 11 })?.zoom ?? currentZoom
        const targetZoom = Math.max(currentZoom, kommunZoom)
        const districtBox = boundsRef.current[code ?? '']
        // Zoomar vi in för att visa hela kommunen: centrera på kommunen. Redan djupare
        // inzoomad än så: centrera i stället på det TAPPADE DISTRIKTET så det stannar i vy.
        const targetBox = targetZoom > currentZoom || !districtBox ? box : districtBox
        const point: [number, number] = [(targetBox[0] + targetBox[2]) / 2, (targetBox[1] + targetBox[3]) / 2]
        const orig = { center: m.getCenter(), zoom: currentZoom, bearing: m.getBearing() }
        m.jumpTo({ center: point, zoom: targetZoom })
        const w = m.getContainer().clientWidth
        const h = m.getContainer().clientHeight
        const desiredX = pad.left + (w - pad.left - pad.right) / 2
        const desiredY = pad.top + (h - pad.top - pad.bottom) / 2
        const corrected = m.unproject([w - desiredX, h - desiredY])
        m.jumpTo(orig)
        m.easeTo({ center: corrected, zoom: targetZoom, duration })
      } else if (on && box) {
        m.fitBounds(box, { padding: pad, maxZoom: 10, duration })
      } else if (code == null) {
        m.fitBounds(SWEDEN_BOUNDS, { padding: pad, duration })
      }
    }
    runFit(on ? 700 : 600)
    // Fönsterstorleksändring re-fit:ar mot nuvarande urval (utan animation — se resize-effekt).
    refitRef.current = () => runFit(0)
    // snapshotVersion: distrikts-metadatan (allCodesRef/metaRef) laddas async och bumpar den när
    // klar. Utan detta missar en initial URL-vy (t.ex. ?omrade=kommun:2184) sin inzoomning om
    // effekten kör innan metadatan finns — selectedArea ändras aldrig sen, så den kör aldrig om.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea, valtyp, mapReady, boundsReady, snapshotVersion, dataset?.test])

  // Fönsterstorleksändring: MapLibre resizar canvasen (trackResize) men BEHÅLLER zoom →
  // Sverige/området "fastnar" i den gamla storleken tills man laddar om eller zoomar. Re-fit:a
  // strypt mot nuvarande urval med aktuell padding (som nu speglar den nya fönsterbredden).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        mapRef.current?.resize()
        refitRef.current?.()
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (t) clearTimeout(t)
    }
  }, [])

  // Uppsamlingsdistrikten (handover 13 sep) räknas med i BÅDE täljare och nämnare, som
  // val.se/SVT — "X av 6312 valdistrikt" blir t.ex. RD:s riktiga "X av 6626" (6312
  // geografiska + 314 uppsamling). Se ReportingStatus.tsx för samma mönster/motivering.
  const uppRegistry = uppsamlingRegistryRef.current[valtyp]
  const uppReportedSet = uppsamlingRegistryReportedRef.current[valtyp]
  const total = totalByValtyp[valtyp] + uppRegistry.length
  const reportedCombined = reportedCount + uppRegistry.reduce((n, e) => n + (uppReportedSet.has(e.kod) ? 1 : 0), 0)
  const reportedPct = total > 0 ? Math.round((reportedCombined / total) * 100) : 0
  // Slutresultat-läge PER VALTYP (handover 14 sep, Val ANALYSIS: EGEN, samtidig bar i
  // stället för bara en badge — se SlutligBar nedan). RIKSOMFATTANDE, precis som denna
  // HUD:s befintliga rapporteringstal (samma val vid klargörande fråga: samma skopning som
  // den redan riksomfattande rapporteringsbaren i just DENNA HUD, till skillnad från
  // ResultPanel/MandatBars som är områdesskopade). RD kan vara preliminär medan RF/KF
  // sluträknas. Denominatorn (reportedCount) är GEOGRAFISK ENDAST — uppsamlingsdistrikt
  // saknar egen slutlig-spårning (se areaView.ts för samma princip områdesskopat).
  const { state: slutligState, pct: slutligPct } = deriveSlutligState(slutligDoneCount, reportedCount)

  // Distriktets mini-resultat (namn + hierarki + andel/±2022) — delas av desktop-hover-rutan
  // och mobilens tapp-sheet så det bara finns EN presentation av samma hoverRows.
  // Kartfärgläget "grupp": rubriken/tabellen ska visa GRUPPENS namn/resultat, inte
  // det enskilda klickade distriktets — annars läser man "Högadal" som rubrik ovanför
  // en tabell som egentligen summerar hela valkretsen (missvisande).
  const groupName = (h: HoverInfo): string =>
    valtyp === 'RD' ? h.riksdagsvalkrets : valtyp === 'RF' ? h.region : h.kommun

  const hoverBody = () =>
    hover && (
      <>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-semibold">
            {(colorMode === 'grupp' ? groupName(hover) : hover.namn) || '—'}
          </div>
          <span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-sky-200">
            {colorMode === 'grupp' ? `${VALTYP_LABEL[valtyp]} · ${GROUP_LEVEL_LABEL[valtyp]}` : VALTYP_LABEL[valtyp]}
          </span>
        </div>
        {/* Kartfärgläget "grupp": ancestry-raden ("Norrbottens län · Arvidsjaur") är
            det HOVRADE DISTRIKTETS kedja, inte gruppens — visar den ändå läser man
            lätt in att resultatet gäller just "Arvidsjaur", fast tabellen summerar
            hela valkretsen (rubriken ovan). Släck raden i grupp-läget i stället för
            att visa en missvisande underrubrik. */}
        {colorMode !== 'grupp' && <div className="text-slate-400">{hierarchyLabel || hover.kommun}</div>}
        {hoverRows && hoverRows.giltiga > 0 ? (
          <div className="mt-1.5 text-xs">
            <div className="mb-0.5 flex items-center text-[10px] uppercase tracking-wide text-slate-500">
              <span className="flex-1">Andel</span>
              {hoverRows.has2022 && <span>± mot 2022</span>}
            </div>
            {hoverRows.display.shown.map((r) => (
              <div key={r.partikod} className="flex items-center gap-1.5 leading-5">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: r.farg ?? REPORTED_NEUTRAL }} />
                <span className="w-9 shrink-0 font-semibold">{r.forkortning ?? '—'}</span>
                <span className="flex-1 tabular-nums">{(r.andel * 100).toFixed(1)} %</span>
                {r.deltaAndel != null && (
                  <span className={`tabular-nums ${r.deltaAndel >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {r.deltaAndel >= 0 ? '+' : ''}{r.deltaAndel.toFixed(1)}
                  </span>
                )}
              </div>
            ))}
            {hoverRows.display.ovriga && (
              <div className="flex items-center gap-1.5 leading-5 text-slate-400">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-slate-600" />
                <span className="w-9 shrink-0">Övr.</span>
                <span className="flex-1 tabular-nums">{(hoverRows.display.ovriga.andel * 100).toFixed(1)} %</span>
              </div>
            )}
            <div className="mt-1 border-t border-slate-700 pt-1 text-slate-400">
              {hoverRows.giltiga.toLocaleString('sv-SE')} röster
              {!hoverRows.has2022 && ' · distrikt ej jämförbart med 2022'}
            </div>
          </div>
        ) : (
          <div className="mt-1 text-xs text-slate-500">Ej räknat än ({VALTYP_LABEL[valtyp]})</div>
        )}
      </>
    )

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* Laddningsindikator (förstagångsbesök, tom cache) — se showMapLoading-effekten
          ovan. Gäller BÅDA variant='desktop'/'mobile' (samma komponent). z-40: ska synas
          ovanpå ALLT annat overlay (banner z-30, väljare) tills kartan är redo — enda
          gången den är relevant är precis vid mount, innan något annat hunnit rendera
          över den ändå, men explicit z-index kostar inget och gör ordningen robust mot
          framtida omordningar i JSX:en nedan. */}
      {showMapLoading && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-900/85 px-4 py-3 shadow-lg backdrop-blur">
            <svg className="h-4 w-4 animate-spin text-slate-300" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="text-sm text-slate-200">Laddar karta…</span>
          </div>
        </div>
      )}

      {/* Ortnamn-overlay — se PlaceLabels.tsx. Renderas ovanpå kartan (senare i DOM-
          ordningen än containerRef-diven, ingen z-index behövs) men UNDER de andra
          overlayen nedan (banner/väljare/tooltip, renderade ännu senare) — pointer-
          events: none, rör aldrig klick-/hover-hanteringen på distrikten. */}
      <PlaceLabels map={mapRef.current} ready={mapReady} />

      {/* Provenance-banner: dataset.test → antingen GENERALREPETITIONENS testdata (source
          'genrep2026') eller mellanläget efter valnatts-cutover men innan Valmyndigheten
          publicerat något (source 'reset', se reset-results.mjs) — två olika texter, annars
          läser man fel efter en tidig cutover ("generalrepetition" trots att källan redan är
          skarp, bara tom). Data-styrd så den försvinner av sig själv när skarp data flödar
          (source blir 'val2026', test=false). Mobil: chromen äger bannern → släck den här. */}
      {variant !== 'mobile' && dataset?.test && (
        // Centrerad över den SYNLIGA kartan (samma uträkning som valtyp-väljaren), inte
        // skärmens mitt som ligger en bit in under panelen.
        <div className="pointer-events-none absolute left-[calc((1rem_+_var(--boards-w)_+_100%_-_var(--panel-w))/2)] top-0 z-30 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-b-md border border-t-0 border-amber-500/60 bg-amber-500/15 px-4 py-1.5 text-sm font-semibold text-amber-200 shadow-lg backdrop-blur">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            {dataset.source === 'genrep2026' ? (
              <span>
                Generalrep · <span className="font-bold">testdata</span> — inte skarpa valresultat
                <span className="ml-1 font-normal text-amber-200/70">(Valmyndighetens generalrepetition inför valet 13 sep)</span>
              </span>
            ) : (
              <span>
                <span className="font-bold">Väntar på valnatten</span> — inga resultat inrapporterade än
              </span>
            )}
          </div>
        </div>
      )}

      {/* Valtyp-väljare + rapporteringsgrad — en karta, tre val. Trycks ned när
          generalrep-bannern visas så de inte krockar. Mobil: chromen äger valtyp +
          rapportering och breadcrumben äger "Hela Sverige" → hela blocket släcks här. */}
      {/* Centrerad i det RENA fältet mellan avgångstavlorna (vänster) och resultatpanelen
          (höger): mittpunkten av [tavlornas högerkant, panelens vänsterkant] =
          (1rem + --boards-w + 100% − --panel-w) / 2. Samma mittlinje som kartan (fitBounds
          reserverar båda), inte skärmens mitt (som ligger en bit in under panelen). */}
      {variant !== 'mobile' && (
      <div className={`absolute left-[calc((1rem_+_var(--boards-w)_+_100%_-_var(--panel-w))/2)] ${dataset?.test ? 'top-14' : 'top-4'} -translate-x-1/2 space-y-2`}>
        {/* Snabb väg tillbaka till hela Sverige — visas bara när man zoomat in på ett
            område (distrikt eller vald nivå). Nollställer till valtypens toppnivå
            (RD → Riket, RF/KF → prompt) vilket via fokuseffekten zoomar ut + avdimmar. */}
        {(selectedArea.level === 'distrikt' || selectedArea.code != null) && (
          <button
            type="button"
            onClick={() => setSelectedArea(defaultAreaFor(valtyp))}
            title="Zooma ut till hela Sverige"
            className="mx-auto flex w-fit items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-sm font-medium text-slate-100 shadow-lg transition-colors hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
            Hela Sverige
          </button>
        )}
        <ValtypSelector showColorMode />
        <ColorSchemeSelector />
        {total > 0 && (
          <div className="mx-auto w-fit space-y-1">
          <div className="pointer-events-none mx-auto flex w-fit items-center gap-2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900/90 px-4 py-1.5 text-sm text-slate-100 shadow-lg">
            <span>
              <span className="font-mono text-base font-semibold tabular-nums">{reportedCombined}</span>
              <span className="text-slate-400"> av {total.toLocaleString('sv-SE')}</span>
              <span className="ml-2 text-xs text-sky-300">{reportedPct}%</span>
              {/* whitespace-nowrap på badgen ovan → pillen bara växer, ingen radbrytnings-
                  risk (till skillnad från ResultPanel.tsx:s smala undertext-bar). */}
              {uppRegistry.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-500" title="Uppsamlingsdistrikt: sena/olösta röster utan egen geometri, ingår i både täljare och nämnare (som val.se/SVT)">
                  (varav {uppRegistry.length.toLocaleString('sv-SE')} uppsamling)
                </span>
              )}
            </span>
            {/* Egen liten avdelare mot Live-gruppen — samma rad nu (rymdes gott om
                bredd över, se rad-1 vs rad-2 innan), i stället för en egen rad. */}
            <span className="text-slate-700">·</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? 'animate-pulse bg-emerald-400' : pollError ? 'bg-amber-400' : 'bg-slate-500'}`}
              title={realtimeConnected ? 'Live — senaste uppdatering lyckades nyss' : pollError ?? 'Pausad (fliken i bakgrunden)'}
            />
            <span className={`text-xs ${pollError && !realtimeConnected ? 'text-amber-300' : 'text-slate-400'}`}>
              {realtimeConnected ? 'Live' : pollError ?? 'Pausad'}
            </span>
            {/* Klockslaget lyftes fram: större (text-sm) + ljusare (slate-300) + tabular så
                siffrorna inte hoppar. "Live"-prickens tooltip förklarar redan att det är
                en uppdateringstid, så ordet självt är överflödigt i den synliga texten. */}
            {lastUpdated && (
              <span className="text-xs text-slate-500">
                · <span className="text-sm font-medium tabular-nums text-slate-300">{lastUpdated}</span>
              </span>
            )}
          </div>
          {/* Sluträkningsgrad — EGEN, samtidig bar (handover 14 sep), riksomfattande som
              rapporteringstalen ovan (samma HUD, samma skopning — se klargörande fråga till
              Lars). Ersätter den tidigare kompakta tag-chippen (Preliminärt/Sluträknas/
              Slutgiltigt) med en riktig progress-bar, prominent placerad direkt under.
              box-/textClassName matchar EXAKT raden ovanför (samma HUD-badge-stil:
              rounded-md/border-slate-700/bg-slate-900/90/shadow-lg/text-sm/text-slate-100)
              i stället för SlutligBar:s egen, mycket ljusare/mindre generiska standardstil
              — Lars påpekade avvikelsen i local dev. */}
          <SlutligBar
            state={slutligState}
            pct={slutligPct}
            done={slutligDoneCount}
            total={reportedCount}
            boxClassName="mx-auto w-fit rounded-md border border-slate-700 bg-slate-900/90 shadow-lg"
            textClassName="px-4 py-1.5 text-sm text-slate-100"
          />
          </div>
        )}
      </div>
      )}

      {/* Desktop: hover-ruta som följer pekaren (musdriven). Mobil renderar i stället en
          tapp-sheet nedan (touch har ingen hover) → gate:a den här till desktop. */}
      {variant !== 'mobile' && (
        <div
          ref={tooltipRef}
          className={`pointer-events-none absolute left-0 top-0 max-w-xs rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 shadow-lg ${hover ? '' : 'hidden'}`}
        >
          {hoverBody()}
        </div>
      )}

      {/* Mobil: tapp på ett distrikt öppnar en bottom-sheet med samma mini-resultat.
          Grab-handle (svepbar, se ovan) + stäng-knapp + genväg till Resultat-fliken. */}
      {variant === 'mobile' && hover && (
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900/95 px-4 pb-4 pt-3 text-sm text-slate-100 shadow-2xl backdrop-blur"
          style={{
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
            transform: sheetDragY ? `translateY(${sheetDragY}px)` : undefined,
            transition: sheetDragging ? 'none' : 'transform 0.2s ease-out',
          }}
        >
          <div
            className="-mx-4 -mt-3 mb-1 flex touch-none cursor-grab justify-center px-4 pb-3 pt-3 active:cursor-grabbing"
            onPointerDown={onSheetHandleDown}
            onPointerMove={onSheetHandleMove}
            onPointerUp={onSheetHandleUp}
            onPointerCancel={onSheetHandleUp}
          >
            <div className="h-1 w-10 rounded-full bg-slate-600" />
          </div>
          <button
            type="button"
            onClick={() => setHover(null)}
            aria-label="Stäng"
            className="absolute right-2.5 top-2.5 rounded p-1 text-slate-400 transition-colors hover:text-slate-100"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          {hoverBody()}
          {onOpenResult && (
            <button
              type="button"
              onClick={onOpenResult}
              className="mt-3 flex w-full items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 py-2 text-sm font-medium text-sky-300 transition-colors hover:bg-slate-800"
            >
              Visa i Resultat
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
