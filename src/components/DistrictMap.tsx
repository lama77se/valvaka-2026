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
import type { Level } from '@/lib/aggregate'
import { useResults } from '@/components/ResultsProvider'

// Kartklick drillar till valtypens nativa nivå: riksdagsval → kommun (geografisk
// nedbrytning), regionval → region (organet distriktet väljer), kommunval → kommun.
const CLICK_DRILL: Record<Valtyp, { level: Level; digits: number }> = {
  RD: { level: 'kommun', digits: 4 },
  RF: { level: 'region', digits: 2 },
  KF: { level: 'kommun', digits: 4 },
}

// Läsbar etikett för district_comparison.jamforbarhet (Fas 2-referensdata).
const JAMFORBARHET_LABEL: Record<string, string> = {
  JA: 'Jämförbar mot 2022',
  NEJ: 'Ej jämförbar mot 2022',
  FLERA: 'Jämförs mot flera 2022-distrikt',
}

// Färg för distrikt som rapporterat men vars vinnarparti saknar märkesfärg
// (lokalt parti utan hex i `party.color`). Orapporterade får null → UNREPORTED_FILL.
const REPORTED_NEUTRAL = '#64748b'
const UNREPORTED_FILL = '#334155'

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
    setSelectedArea,
    storesRef,
    partyRef,
    districtComparisonRef,
    totalByValtyp,
    subscribeChanges,
    snapshotVersion,
  } = useResults()

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [jamforbarhet, setJamforbarhet] = useState<string | null>(null)

  const pendingRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number | null>(null)
  const sourceReadyRef = useRef(false)
  const activeValtypRef = useRef<Valtyp>(valtyp) // speglar `valtyp` för closures
  const recolorRef = useRef<(() => void) | null>(null)

  const [hoverResult, setHoverResult] = useState<HoverResult | null>(null)
  const [reportedCount, setReportedCount] = useState(0)

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
            ['coalesce', ['feature-state', 'color'], UNREPORTED_FILL],
          ],
          'fill-opacity': [
            'case',
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

      map.on('mousemove', 'district-fill', (e) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'pointer'
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

      // Klick på distrikt → drilldown i tabellen (delad state) till valtypens
      // nativa nivå.
      map.on('click', 'district-fill', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const drill = CLICK_DRILL[activeValtypRef.current]
        setSelectedArea({ level: drill.level, code: String(f.id).slice(0, drill.digits) })
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
    setReportedCount(storesRef.current[activeValtypRef.current].reportedCount)
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

  const total = totalByValtyp[valtyp]
  const reportedPct = total > 0 ? Math.round((reportedCount / total) * 100) : 0

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* Valtyp-väljare + rapporteringsgrad — en karta, tre val. */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2 space-y-2">
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
            <span className="font-mono text-base font-semibold tabular-nums">{reportedCount}</span>
            <span className="text-slate-400"> av {total.toLocaleString('sv-SE')} distrikt räknade</span>
            <span className="ml-2 text-xs text-sky-300">{reportedPct}%</span>
          </div>
        )}
      </div>

      {hover && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 shadow-lg">
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
        </div>
      )}
    </div>
  )
}
