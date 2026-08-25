import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

type StyleSpecification = maplibregl.StyleSpecification
import {
  DISTRICT_ID_PROPERTY,
  GEOMETRY_URL,
  SWEDEN_BOUNDS,
} from '@/lib/geometry'
import { VALTYPER, VALTYP_LABEL, type Valtyp } from '@/lib/results'
import { districtsInArea } from '@/lib/aggregate'
import { defaultAreaFor, useResults } from '@/components/ResultsProvider'

// Läsbar etikett för district_comparison.jamforbarhet (Fas 2-referensdata).
const JAMFORBARHET_LABEL: Record<string, string> = {
  JA: 'Jämförbar mot 2022',
  NEJ: 'Ej jämförbar mot 2022',
  FLERA: 'Jämförs mot flera 2022-distrikt',
}

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
type HoverResult = { forkortning: string; share: number; margin: number; total: number }

export function DistrictMap() {
  // Delad state (karta + tabell). Kartan äger inte längre data — den läser storarna
  // och prenumererar på per-distrikt-ändringar via providern.
  const {
    valtyp,
    setValtyp,
    selectedArea,
    setSelectedArea,
    storesRef,
    partyRef,
    metaRef,
    allCodesRef,
    districtComparisonRef,
    totalByValtyp,
    subscribeChanges,
    snapshotVersion,
    realtimeConnected,
    dataset,
  } = useResults()

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null) // hover-rutan (positioneras vid pekaren via DOM)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [jamforbarhet, setJamforbarhet] = useState<string | null>(null)

  const pendingRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number | null>(null)
  const sourceReadyRef = useRef(false)
  const activeValtypRef = useRef<Valtyp>(valtyp) // speglar `valtyp` för closures
  const recolorRef = useRef<(() => void) | null>(null)

  // Fokus/zoom-läge: distrikt-bboxar för fitBounds. Varje områdesval (kartklick,
  // dropdown, breadcrumb, drill) zoomar in på området och dimmar allt utanför.
  const boundsRef = useRef<Record<string, [number, number, number, number]>>({})
  const [boundsReady, setBoundsReady] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const [hoverResult, setHoverResult] = useState<HoverResult | null>(null)
  const [reportedCount, setReportedCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null) // HH:MM:SS för senaste dataändring

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
            // Utanför valt område (fokusläge) → grått, oavsett resultatfärg.
            ['boolean', ['feature-state', 'dimmed'], false],
            '#1e293b',
            ['coalesce', ['feature-state', 'color'], UNREPORTED_FILL],
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.92,
            // Dimmat (utanför fokus) tonas ned kraftigt så det valda området framträder.
            ['boolean', ['feature-state', 'dimmed'], false],
            0.12,
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
        paint: { 'line-color': '#0f172a', 'line-width': 0.3 },
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
        setJamforbarhet(districtComparisonRef.current.get(id) ?? null)
        const o = storesRef.current[activeValtypRef.current].outcome(id)
        setHoverResult(
          o.winner
            ? {
                forkortning: partyRef.current.get(o.winner)?.forkortning ?? o.winner,
                share: o.share,
                margin: o.margin,
                total: o.total,
              }
            : null,
        )
      })
      map.on('mouseleave', 'district-fill', () => {
        map.getCanvas().style.cursor = ''
        setHovered(null)
        setHover(null)
        setHoverResult(null)
      })

      // Klick på ett distrikt → zooma in på distriktet (via fokuseffekten) och visa
      // DET distriktets fullständiga partibrytning i tabellen (röster + andel).
      // Minsta kartdelen = minsta tabellnivån. Mandat och ±2022 saknas på distrikts-
      // nivå (inget organ fördelas; 2026-distrikt ≠ 2022-distrikt) → "–". Distriktet
      // är samma kod i alla tre valen.
      map.on('click', 'district-fill', (e) => {
        const f = e.features?.[0]
        if (!f) return
        setSelectedArea({ level: 'distrikt', code: String(f.id) })
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
  }, [subscribeChanges, storesRef, partyRef, districtComparisonRef, setSelectedArea])

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
    // Uppdatera hover-rutans resultat till den nya valtypen om man hovrar.
    if (hoveredIdRef.current) {
      const o = storesRef.current[valtyp].outcome(hoveredIdRef.current)
      setHoverResult(
        o.winner
          ? {
              forkortning: partyRef.current.get(o.winner)?.forkortning ?? o.winner,
              share: o.share,
              margin: o.margin,
              total: o.total,
            }
          : null,
      )
    }
  }, [valtyp, storesRef, partyRef])

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
    // Dimma varje distrikt utanför fokus; avdimma i fokus / alla vid Riket.
    for (const vd of allCodesRef.current) {
      map.setFeatureState({ source: 'districts', id: vd }, { dimmed: on && !inSet.has(vd) })
    }
    // Ram att zooma till: ett distrikt zoomas till HELA sin kommun (samma 4-siffriga
    // prefix) så kommunen syns runt det markerade distriktet — inte bara distriktet
    // självt (annars blir det för snävt). Övriga nivåer zoomar till sitt fokusområde.
    const boxCodes =
      level === 'distrikt' && code
        ? districtsInArea(allCodesRef.current, 'kommun', code.slice(0, 4), valtyp, metaRef.current)
        : codes
    // Resultatpanelen (aside, --panel-w) ligger ÖVER kartans högra del. fitBounds
    // centrerar i HELA behållaren → reservera panelbredden som högerpadding, annars
    // hamnar områdets högra del under panelen (och zoomen blir för djup). Topp-paddingen
    // (150) trycker ner Sverige så valtyp-väljaren får ett eget luftigt fält OVANFÖR
    // kartan i stället för att ligga ovanpå den; övriga sidor får luftig marginal.
    const panelW = document.querySelector('aside')?.clientWidth ?? 0
    const pad = { top: 150, right: panelW + 24, bottom: 48, left: 48 }
    if (on) {
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const vd of boxCodes) {
        const b = boundsRef.current[vd]
        if (!b) continue
        if (b[0] < box[0]) box[0] = b[0]
        if (b[1] < box[1]) box[1] = b[1]
        if (b[2] > box[2]) box[2] = b[2]
        if (b[3] > box[3]) box[3] = b[3]
      }
      if (Number.isFinite(box[0])) {
        // maxZoom kapar bara mycket små kommuner — annars fit:ar vi kommunens egen
        // utsträckning. Distrikt något tightare (11) än större områden (10).
        map.fitBounds(box, { padding: pad, maxZoom: level === 'distrikt' ? 11 : 10, duration: 700 })
      }
    } else if (code == null) {
      map.fitBounds(SWEDEN_BOUNDS, { padding: pad, duration: 600 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArea, valtyp, mapReady, boundsReady])

  const total = totalByValtyp[valtyp]
  const reportedPct = total > 0 ? Math.round((reportedCount / total) * 100) : 0
  // Resultatet är PRELIMINÄRT tills Länsstyrelsernas slutliga sammanräkning (rakningstill-
  // fälle byter från "preliminär" → "slutlig"). "X av 6312 valdistrikt" mäter bara distrikt
  // som rapporterat sin preliminärräkning — sena förtids-/brev-/utlandsröster + personröster
  // tillkommer vid sluträkningen. Gäller alla tre valen (dataset_meta är EN global rad).
  const preliminar = !dataset?.rakningstillfalle || dataset.rakningstillfalle.toLowerCase().startsWith('prelimin')

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* Provenance-banner: kartan färgas av GENERALREPETITIONENS testdata (inte skarpa
          valresultat) tills ingest-result byter till val2026 på valnatten. Data-styrd
          (dataset.test) så den försvinner av sig själv när skarp data börjar flöda. */}
      {dataset?.test && (
        // Centrerad över den SYNLIGA kartan (samma uträkning som valtyp-väljaren), inte
        // skärmens mitt som ligger en bit in under panelen.
        <div className="pointer-events-none absolute left-[calc((100%-var(--panel-w))/2)] top-0 z-10 -translate-x-1/2">
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
          generalrep-bannern visas så de inte krockar. */}
      {/* Centrerad över den SYNLIGA kartan = mittpunkten av ytan till vänster om
          resultatpanelen ((100vw − panelbredd) / 2), inte skärmens mitt (som ligger en
          bit in under panelen och drog väljaren för långt åt höger). */}
      <div className={`absolute left-[calc((100%-var(--panel-w))/2)] ${dataset?.test ? 'top-14' : 'top-4'} -translate-x-1/2 space-y-2`}>
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
        <div className="flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-sm shadow-lg">
          {VALTYPER.map((vt) => (
            <button
              key={vt}
              type="button"
              onClick={() => setValtyp(vt)}
              className={`px-4 py-1.5 font-medium transition-colors ${
                vt === valtyp
                  ? 'bg-sky-500 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {VALTYP_LABEL[vt]}
            </button>
          ))}
        </div>
        {total > 0 && (
          <div className="pointer-events-none rounded-md border border-slate-700 bg-slate-900/90 px-4 py-1.5 text-center text-sm text-slate-100 shadow-lg">
            <div className="flex items-center justify-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${preliminar ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}
                title={
                  preliminar
                    ? 'Preliminärt röstresultat. "X av 6312 valdistrikt" räknar distrikt som rapporterat sin preliminärräkning — sena förtids-/brev-/utlandsröster och personröster tillkommer vid Länsstyrelsernas slutliga sammanräkning (onsdag efter valdagen). Gäller riksdag, region och kommun.'
                    : 'Slutgiltigt resultat (slutlig sammanräkning).'
                }
              >
                {preliminar ? 'Preliminärt' : 'Slutgiltigt'}
              </span>
              <span>
                <span className="font-mono text-base font-semibold tabular-nums">{reportedCount}</span>
                <span className="text-slate-400"> av {total.toLocaleString('sv-SE')} valdistrikt</span>
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

      {/* Hover-ruta: ALLTID monterad (så tooltipRef finns för DOM-positioneringen),
          dold tills man hovrar. Följer pekaren via positionTooltip (transform) → den
          täcker aldrig distriktet man pekar på och krockar inte med någon fast panel. */}
      <div
        ref={tooltipRef}
        className={`pointer-events-none absolute left-0 top-0 max-w-xs rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 shadow-lg ${hover ? '' : 'hidden'}`}
      >
        {hover && (
          <>
            <div className="font-semibold">{hover.namn || '—'}</div>
            <div className="text-slate-400">
              {hover.kommun} · {hover.lan} · <span className="font-mono">{hover.kod}</span>
            </div>
            {hoverResult ? (
              <div className="mt-1 text-xs text-emerald-300">
                Ledare ({VALTYP_LABEL[valtyp]}):{' '}
                <span className="font-semibold">{hoverResult.forkortning}</span>{' '}
                <span className="font-semibold">{Math.round(hoverResult.share * 100)} %</span>
                <span className="ml-1 text-slate-400">
                  (+{Math.round(hoverResult.margin * 100)} %-enh) · {hoverResult.total.toLocaleString('sv-SE')} röster
                </span>
              </div>
            ) : (
              <div className="mt-1 text-xs text-slate-500">Ej räknat än ({VALTYP_LABEL[valtyp]})</div>
            )}
            {jamforbarhet && (
              <div className="mt-1 text-xs text-sky-300">
                {JAMFORBARHET_LABEL[jamforbarhet] ?? jamforbarhet}
                <span className="ml-1 text-slate-500">· från Supabase</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
