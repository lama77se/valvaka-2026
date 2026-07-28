import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

type StyleSpecification = maplibregl.StyleSpecification
import {
  DISTRICT_ID_PROPERTY,
  GEOMETRY_URL,
  SWEDEN_BOUNDS,
} from '@/lib/geometry'
import { supabase } from '@/lib/supabase'
import { RESULT_VALTYP, ResultStore } from '@/lib/results'

// Läsbar etikett för district_comparison.jamforbarhet (Fas 2-referensdata).
const JAMFORBARHET_LABEL: Record<string, string> = {
  JA: 'Jämförbar mot 2022',
  NEJ: 'Ej jämförbar mot 2022',
  FLERA: 'Jämförs mot flera 2022-distrikt',
}

// Färg för distrikt som rapporterat men vars vinnarparti saknar märkesfärg
// (småparti utan hex i `party.color`) — samt tom-läget innan resultat kommit.
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
type HoverResult = { forkortning: string; margin: number; total: number }
type Party = { color: string | null; forkortning: string | null }

export function DistrictMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  // Referensdata (Fas 2): district_comparison laddas EN gång och joinas synkront.
  const comparisonRef = useRef<Map<string, string>>(new Map())
  const [jamforbarhet, setJamforbarhet] = useState<string | null>(null)

  // Resultat (Fas 5): partifärger, ackumulerade röster och realtidsstatus.
  const partyRef = useRef<Map<string, Party>>(new Map())
  const storeRef = useRef<ResultStore>(new ResultStore())
  const pendingRef = useRef<Set<string>>(new Set()) // distrikt som väntar på repaint
  const rafRef = useRef<number | null>(null)
  const sourceReadyRef = useRef(false) // tile-features laddade → setFeatureState biter
  const [hoverResult, setHoverResult] = useState<HoverResult | null>(null)
  const [reportedCount, setReportedCount] = useState(0)
  const [totalDistricts, setTotalDistricts] = useState(0)

  // Ladda hela district_comparison en gång (paginerat; PostgREST tak ~1000/sida).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const map = new Map<string, string>()
      const PAGE = 1000
      for (let from = 0; !cancelled; from += PAGE) {
        const { data, error } = await supabase
          .from('district_comparison')
          .select('valdistriktskod,jamforbarhet')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data) map.set(r.valdistriktskod, r.jamforbarhet)
        if (data.length < PAGE) break
      }
      if (!cancelled) comparisonRef.current = map
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Ladda partifärger en gång (8 riksdagspartier har hex, resten null).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('party').select('partikod,color,forkortning')
      if (cancelled || !data) return
      const m = new Map<string, Party>()
      for (const p of data) m.set(p.partikod, { color: p.color, forkortning: p.forkortning })
      partyRef.current = m
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
    if (import.meta.env.DEV) {
      ;(window as unknown as { __map?: maplibregl.Map }).__map = map
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('error', (e) => {
      console.error('[DistrictMap] maplibre error:', e.error ?? e)
    })

    // --- Fas 5: applicera ett distrikts resultat som feature-state ------------
    const applyDistrict = (vd: string) => {
      const o = storeRef.current.outcome(vd)
      const color = (o.winner && partyRef.current.get(o.winner)?.color) || REPORTED_NEUTRAL
      map.setFeatureState(
        { source: 'districts', id: vd },
        { reported: o.total > 0, color, margin: o.margin },
      )
    }

    // "Debounce" enligt arkitektur = rAF-koalescera setFeatureState: många events i
    // samma tick → en repaint. Ingen timer som FÖRDRÖJER (acceptans: "inom sekunder").
    const scheduleFlush = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        for (const vd of pendingRef.current) applyDistrict(vd)
        pendingRef.current.clear()
        const n = storeRef.current.reportedCount
        setReportedCount(n)
        ;(window as unknown as { __reportedCount?: number }).__reportedCount = n
      })
    }
    const requestApply = (vd: string) => {
      pendingRef.current.add(vd)
      if (sourceReadyRef.current) scheduleFlush()
    }
    // Full omfärgning (efter snapshot-hämtning ELLER när källan blir redo).
    const applyAll = () => {
      if (!sourceReadyRef.current) return
      for (const vd of storeRef.current.districts()) pendingRef.current.add(vd)
      scheduleFlush()
    }

    map.on('load', () => {
      map.addSource('districts', {
        type: 'geojson',
        data: GEOMETRY_URL,
        promoteId: DISTRICT_ID_PROPERTY,
      })

      // Fas 5-paint: fyll med vinnarpartiets färg (feature-state 'color'), grått
      // tills distriktet rapporterat. Hover-highlight ligger kvar överst.
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
          // Rapporterade distrikt lyfts fram; orapporterade dämpas.
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

      // Källan är redo när tile-features finns; DÅ biter setFeatureState. Annars
      // no-op:ar den tyst (klassisk feature-state-fälla). Applicera snapshot först här.
      map.on('sourcedata', (e) => {
        if (e.sourceId !== 'districts' || !map.isSourceLoaded('districts')) return
        if (sourceReadyRef.current) return
        sourceReadyRef.current = true
        applyAll()
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
        setJamforbarhet(comparisonRef.current.get(id) ?? null)
        const o = storeRef.current.outcome(id)
        setHoverResult(
          o.winner
            ? {
                forkortning: partyRef.current.get(o.winner)?.forkortning ?? o.winner,
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
    })

    // --- Realtime: prenumerera FÖRST, hämta snapshot sen (annars tappas events
    // i gapet). RD-filtrerat både på kanalen och i snapshot-frågan. ------------
    const channel = supabase
      .channel('result-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'result', filter: `valtyp=eq.${RESULT_VALTYP}` },
        (payload) => {
          const row = payload.new as {
            valdistriktskod?: string
            partikod?: string
            roster?: number
          }
          if (!row?.valdistriktskod || !row.partikod) return
          storeRef.current.set(row.valdistriktskod, row.partikod, row.roster ?? 0)
          requestApply(row.valdistriktskod)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ;(window as unknown as { __realtimeReady?: boolean }).__realtimeReady = true
        }
      })

    ;(async () => {
      // Y i "X av Y distrikt": totalt antal distrikt (referensdata).
      const { count } = await supabase
        .from('district')
        .select('*', { count: 'exact', head: true })
      setTotalDistricts(count ?? 0)

      // Snapshot av redan inrapporterade RD-resultat (paginerat).
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('result')
          .select('valdistriktskod,partikod,roster')
          .eq('valtyp', RESULT_VALTYP)
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data) storeRef.current.set(r.valdistriktskod, r.partikod, r.roster)
        if (data.length < PAGE) break
      }
      applyAll() // biter när källan är redo; annars kör sourcedata-handlern den.
    })()

    return () => {
      supabase.removeChannel(channel)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  const reportedPct = totalDistricts > 0 ? Math.round((reportedCount / totalDistricts) * 100) : 0

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {/* Rapporteringsgrad — den siffra som kalibrerar tilltron (arkitektur §8). */}
      {totalDistricts > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900/90 px-4 py-2 text-center text-sm text-slate-100 shadow-lg">
          <span className="font-mono text-lg font-semibold tabular-nums">{reportedCount}</span>
          <span className="text-slate-400"> av {totalDistricts.toLocaleString('sv-SE')} distrikt räknade</span>
          <span className="ml-2 text-xs text-sky-300">{reportedPct}%</span>
        </div>
      )}

      {hover && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 shadow-lg">
          <div className="font-semibold">{hover.namn || '—'}</div>
          <div className="text-slate-400">
            {hover.kommun} · {hover.lan} · <span className="font-mono">{hover.kod}</span>
          </div>
          {hoverResult ? (
            <div className="mt-1 text-xs text-emerald-300">
              Ledare: <span className="font-semibold">{hoverResult.forkortning}</span>
              <span className="ml-1 text-slate-400">
                +{Math.round(hoverResult.margin * 100)} pe · {hoverResult.total.toLocaleString('sv-SE')} röster
              </span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500">Ej räknat än</div>
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
