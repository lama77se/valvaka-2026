import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

type StyleSpecification = maplibregl.StyleSpecification
import {
  DISTRICT_ID_PROPERTY,
  GEOMETRY_URL,
  SWEDEN_BOUNDS,
} from '@/lib/geometry'
import { VALTYPER, VALTYP_LABEL, type Valtyp } from '@/lib/results'
import { SPARR, applyComparison, buildRows, collapseForDisplay, districtsInArea } from '@/lib/aggregate'
import { ancestorsOf } from '@/lib/hierarchy'
import { defaultAreaFor, useResults } from '@/components/ResultsProvider'
import { ValtypSelector } from '@/components/ValtypSelector'

// Färg för distrikt som rapporterat men vars vinnarparti saknar märkesfärg
// (lokalt parti utan hex i `party.color`). Orapporterade får null → UNREPORTED_FILL.
// Exporterade så partilegenden speglar exakt samma färger (en sanningskälla).
export const REPORTED_NEUTRAL = '#64748b'
export const UNREPORTED_FILL = '#334155'

const hhmmss = () => new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// Tom bakgrundsstil utan extern basemap: inga API-nycklar, inga externa tiles.
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } },
  ],
}

type HoverInfo = { kod: string; namn: string; kommun: string; lan: string }

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
    storesRef,
    partyRef,
    metaRef,
    allCodesRef,
    totalByValtyp,
    subscribeChanges,
    snapshotVersion,
    realtimeConnected,
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
  const tooltipRef = useRef<HTMLDivElement>(null) // hover-rutan (positioneras vid pekaren via DOM)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const pendingRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number | null>(null)
  const sourceReadyRef = useRef(false)
  const activeValtypRef = useRef<Valtyp>(valtyp) // speglar `valtyp` för closures
  const variantRef = useRef(variant) // stabil åtkomst i map-event-closures (mount-en gång)
  const recolorRef = useRef<(() => void) | null>(null)
  const refitRef = useRef<(() => void) | null>(null) // re-fit mot nuvarande urval vid resize

  // Fokus/zoom-läge: distrikt-bboxar för fitBounds. Varje områdesval (kartklick,
  // dropdown, breadcrumb, drill) zoomar in på området och dimmar allt utanför.
  const boundsRef = useRef<Record<string, [number, number, number, number]>>({})
  const [boundsReady, setBoundsReady] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const [reportedCount, setReportedCount] = useState(0)
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
  const hoverRows = useMemo(() => {
    if (!hover) return null
    const votes = storesRef.current[valtyp].aggregate([hover.kod])
    const area = buildRows(votes, partyRef.current, SPARR[valtyp])
    const a2022 = districtAndel2022Ref.current?.get(hover.kod)
    const leaf = a2022 && Object.keys(a2022).length ? { andel: a2022, mandat: {} as Record<string, number> } : null
    const withCmp = applyComparison(area, valtyp, 'distrikt', hover.kod, null, partyRef.current, leaf)
    return {
      display: collapseForDisplay(withCmp),
      giltiga: withCmp.giltiga,
      has2022: withCmp.rows.some((r) => r.andel2022 != null),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, valtyp, revision])

  // Lat-ladda 2022-siffrorna för det hovrade distriktets kommun (deduppat i providern).
  useEffect(() => {
    if (hover?.kod) ensureDistrictWinners2022(valtyp, hover.kod.slice(0, 4))
  }, [hover?.kod, valtyp, ensureDistrictWinners2022])

  // Mobil-fliken döljs med `hidden` (display:none) när man är på en annan flik. MapLibre
  // mäter då containern till 0 → måste resiza:s när fliken blir synlig igen. På desktop är
  // active alltid true (ändras aldrig) → körs en gång vid mount som en no-op.
  useEffect(() => {
    if (active) mapRef.current?.resize()
    else setHover(null) // lämnar Karta-fliken → stäng ev. öppen tapp-sheet
  }, [active])

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

    // --- Applicera ett distrikts resultat FÖR DEN AKTIVA VALTYPEN --------------
    const applyDistrict = (vd: string) => {
      if (removed) return
      const o = storesRef.current[activeValtypRef.current].outcome(vd)
      const color = (o.winner && partyRef.current.get(o.winner)?.farg) || REPORTED_NEUTRAL
      map.setFeatureState(
        { source: 'districts', id: vd },
        // Orapporterat i denna valtyp → color null så coalesce faller till grått
        // (annars sitter förra valtypens färg kvar — feature-state persisterar).
        { reported: o.total > 0, color: o.total > 0 ? color : null, margin: o.margin },
      )
    }

    // rAF-koalescerad repaint (many events/tick → one paint), ingen fördröjande timer.
    const scheduleFlush = () => {
      if (rafRef.current != null || removed) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (removed) return
        for (const vd of pendingRef.current) applyDistrict(vd)
        pendingRef.current.clear()
        const n = storesRef.current[activeValtypRef.current].reportedCount
        setReportedCount(n)
        setLastUpdated(hhmmss())
        ;(window as unknown as { __reportedCount?: number }).__reportedCount = n
      })
    }
    const requestApply = (vd: string) => {
      pendingRef.current.add(vd)
      if (sourceReadyRef.current) scheduleFlush()
    }
    // Färga om ALLA distrikt som har resultat i NÅGON valtyp, från aktiv valtyp.
    // Måste iterera unionen — annars behåller distrikt som fanns i förra valtypen
    // men saknas i den nya sin gamla färg (feature-state-fällan vid växling).
    const recolorActive = () => {
      if (!sourceReadyRef.current || removed) return
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
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            '#38bdf8',
            // Utanför valt område (fokusläge) → dämpad grå, oavsett resultatfärg (men syns).
            ['boolean', ['feature-state', 'dimmed'], false],
            '#475569',
            ['coalesce', ['feature-state', 'color'], UNREPORTED_FILL],
          ],
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

      // Källan redo → setFeatureState biter; applicera hittills laddade resultat.
      map.on('sourcedata', (e) => {
        if (e.sourceId !== 'districts' || !map.isSourceLoaded('districts')) return
        if (sourceReadyRef.current) return
        sourceReadyRef.current = true
        recolorActive()
        setMapReady(true) // källan biter nu → fokus/zoom-effekten får köra
      })

      const setHovered = (id: string | null) => {
        if (hoveredIdRef.current === id) return
        if (hoveredIdRef.current !== null) {
          map.setFeatureState(
            { source: 'districts', id: hoveredIdRef.current },
            { hover: false },
          )
        }
        hoveredIdRef.current = id
        if (id !== null) {
          map.setFeatureState({ source: 'districts', id }, { hover: true })
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
        setSelectedArea({ level: 'distrikt', code: String(f.id) })
        if (variantRef.current === 'mobile') {
          const p = f.properties ?? {}
          setHover({ kod: String(f.id), namn: p.Valdistriktsnamn ?? '', kommun: p.Kommun ?? '', lan: p['Län'] ?? '' })
        }
      })
    })

    // Per-distrikt-notis från providern (Realtime). Kartan bryr sig bara om aktiv
    // valtyp; store.set har redan skett i providern → vi bara begär ompaint.
    const unsubscribe = subscribeChanges((vd, vt) => {
      if (vt === activeValtypRef.current) requestApply(vd)
    })

    setReportedCount(storesRef.current[activeValtypRef.current].reportedCount)

    return () => {
      unsubscribe()
      removed = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      recolorRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [subscribeChanges, storesRef, partyRef, setSelectedArea])

  // Bulkladdning (referens/snapshot) klar → full ompaint + färsk räknare.
  useEffect(() => {
    recolorRef.current?.()
    const n = storesRef.current[activeValtypRef.current].reportedCount
    setReportedCount(n)
    if (n > 0) setLastUpdated(hhmmss())
  }, [snapshotVersion, storesRef])

  // Valtyp-växling: uppdatera aktiv valtyp och färga om kartan från dess store.
  useEffect(() => {
    activeValtypRef.current = valtyp
    if (import.meta.env.DEV) {
      ;(window as unknown as { __valtyp?: Valtyp }).__valtyp = valtyp
    }
    setReportedCount(storesRef.current[valtyp].reportedCount)
    recolorRef.current?.()
    // Hover-rutans mini-tabell räknar om via hoverRows (nyckel: valtyp + revision).
  }, [valtyp, storesRef])

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
        pad = { top: 150, right: panelW + 24, bottom: 48, left: Math.round(boardsRight) + 24 }
      }
      // maxZoom kapar bara mycket små kommuner — annars fit:ar vi områdets egen utsträckning.
      if (on && box) m.fitBounds(box, { padding: pad, maxZoom: level === 'distrikt' ? 11 : 10, duration })
      else if (code == null) m.fitBounds(SWEDEN_BOUNDS, { padding: pad, duration })
    }
    runFit(on ? 700 : 600)
    // Fönsterstorleksändring re-fit:ar mot nuvarande urval (utan animation — se resize-effekt).
    refitRef.current = () => runFit(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea, valtyp, mapReady, boundsReady])

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

  const total = totalByValtyp[valtyp]
  const reportedPct = total > 0 ? Math.round((reportedCount / total) * 100) : 0
  // Slutresultat-läge PER VALTYP ur result.status i denna valtyps store: preliminärt →
  // sluträknas · X % (onsdagsräkningen pågår, distrikt för distrikt) → slutgiltigt (alla
  // distrikt slutligt räknade). RD kan vara preliminär medan RF/KF sluträknas. "X av 6312
  // valdistrikt" mäter distriktens preliminärräkning — sena röster + personröster
  // tillkommer vid sluträkningen.
  const prog = storesRef.current[valtyp].slutligProgress()
  const tagTone =
    prog.state === 'preliminar' ? 'bg-amber-500/15 text-amber-300'
    : prog.state === 'slutlig' ? 'bg-emerald-500/15 text-emerald-300'
    : 'bg-sky-500/15 text-sky-300'
  const tagLabel =
    prog.state === 'preliminar' ? 'Preliminärt'
    : prog.state === 'slutlig' ? 'Slutgiltigt'
    : `Sluträknas · ${prog.pct} %`
  const tagTitle =
    prog.state === 'preliminar'
      ? 'Preliminärt röstresultat. Slutligt resultat vid Länsstyrelsernas slutliga sammanräkning (från onsdagen efter valdagen) — personröster och sena förtids-/brev-/utlandsröster tillkommer då.'
      : prog.state === 'slutlig'
        ? 'Slutgiltigt resultat — alla valdistrikt är slutligt sammanräknade.'
        : `Sluträkningen pågår: ${prog.pct} % av valdistrikten är slutligt räknade, resten visar fortfarande preliminära siffror.`

  // Distriktets mini-resultat (namn + hierarki + andel/±2022) — delas av desktop-hover-rutan
  // och mobilens tapp-sheet så det bara finns EN presentation av samma hoverRows.
  const hoverBody = () =>
    hover && (
      <>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate font-semibold">{hover.namn || '—'}</div>
          <span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-sky-200">
            {VALTYP_LABEL[valtyp]}
          </span>
        </div>
        <div className="text-slate-400">{hierarchyLabel || hover.kommun}</div>
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

      {/* Provenance-banner: kartan färgas av GENERALREPETITIONENS testdata (inte skarpa
          valresultat) tills ingest-result byter till val2026 på valnatten. Data-styrd
          (dataset.test) så den försvinner av sig själv när skarp data börjar flöda.
          Mobil: chromen äger bannern → släck den här. */}
      {variant !== 'mobile' && dataset?.test && (
        // Centrerad över den SYNLIGA kartan (samma uträkning som valtyp-väljaren), inte
        // skärmens mitt som ligger en bit in under panelen.
        <div className="pointer-events-none absolute left-[calc((1rem_+_var(--boards-w)_+_100%_-_var(--panel-w))/2)] top-0 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-b-md border border-t-0 border-amber-500/60 bg-amber-500/15 px-4 py-1.5 text-sm font-semibold text-amber-200 shadow-lg backdrop-blur">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <span>
              Generalrep · <span className="font-bold">testdata</span> — inte skarpa valresultat
              <span className="ml-1 font-normal text-amber-200/70">(Valmyndighetens generalrepetition inför valet 13 sep)</span>
            </span>
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
        <ValtypSelector />
        {total > 0 && (
          <div className="pointer-events-none rounded-md border border-slate-700 bg-slate-900/90 px-4 py-1.5 text-center text-sm text-slate-100 shadow-lg">
            <div className="flex items-center justify-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tagTone}`}
                title={tagTitle}
              >
                {tagLabel}
              </span>
              <span>
                <span className="font-mono text-base font-semibold tabular-nums">{reportedCount}</span>
                <span className="text-slate-400"> av {total.toLocaleString('sv-SE')}</span>
                <span className="ml-2 text-xs text-sky-300">{reportedPct}%</span>
              </span>
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`}
                title={realtimeConnected ? 'Live — ansluten till realtidsflödet' : 'Ej ansluten till realtidsflödet'}
              />
              <span>{realtimeConnected ? 'Live' : 'Offline'}</span>
              {lastUpdated && <span className="text-slate-500">· uppdaterad {lastUpdated}</span>}
            </div>
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
          Grab-handle + stäng-knapp + genväg till Resultat-fliken. */}
      {variant === 'mobile' && hover && (
        <div
          className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 max-h-[55%] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900/95 px-4 pb-4 pt-3 text-sm text-slate-100 shadow-2xl backdrop-blur"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-600" />
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
