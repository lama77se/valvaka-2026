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
import {
  VALTYPER,
  VALTYP_LABEL,
  VALTYP_VK_COLUMN,
  ResultStore,
  type Valtyp,
} from '@/lib/results'

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
type Party = { color: string | null; forkortning: string | null }

const emptyCounts = (): Record<Valtyp, number> => ({ RD: 0, RF: 0, KF: 0 })

export function DistrictMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  // Referensdata (Fas 2): district_comparison laddas EN gång och joinas synkront.
  const comparisonRef = useRef<Map<string, string>>(new Map())
  const [jamforbarhet, setJamforbarhet] = useState<string | null>(null)

  // Resultat (Fas 5–6): partifärger + EN ResultStore per valtyp (samma geometri,
  // olika resultatlager). Kartan färgas från den valda valtypen.
  const partyRef = useRef<Map<string, Party>>(new Map())
  const storesRef = useRef<Record<Valtyp, ResultStore>>(null!)
  if (!storesRef.current) {
    storesRef.current = { RD: new ResultStore(), RF: new ResultStore(), KF: new ResultStore() }
  }
  const pendingRef = useRef<Set<string>>(new Set())
  const rafRef = useRef<number | null>(null)
  const sourceReadyRef = useRef(false)
  const activeValtypRef = useRef<Valtyp>('RD') // speglar `valtyp`-state för closures
  const recolorRef = useRef<(() => void) | null>(null)

  const [valtyp, setValtyp] = useState<Valtyp>('RD')
  const [hoverResult, setHoverResult] = useState<HoverResult | null>(null)
  const [reportedCount, setReportedCount] = useState(0)
  const [totalByValtyp, setTotalByValtyp] = useState<Record<Valtyp, number>>(emptyCounts)

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

  // Ladda partifärger en gång (riksdagspartier har hex, lokala partier null).
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

    // --- Fas 6: applicera ett distrikts resultat FÖR DEN AKTIVA VALTYPEN --------
    const applyDistrict = (vd: string) => {
      const o = storesRef.current[activeValtypRef.current].outcome(vd)
      const color = (o.winner && partyRef.current.get(o.winner)?.color) || REPORTED_NEUTRAL
      map.setFeatureState(
        { source: 'districts', id: vd },
        // Orapporterat i denna valtyp → color null så coalesce faller till grått
        // (annars sitter förra valtypens färg kvar — feature-state persisterar).
        { reported: o.total > 0, color: o.total > 0 ? color : null, margin: o.margin },
      )
    }

    // rAF-koalescerad repaint (many events/tick → one paint), ingen fördröjande timer.
    const scheduleFlush = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
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
      if (!sourceReadyRef.current) return
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
        setJamforbarhet(comparisonRef.current.get(id) ?? null)
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
    })

    // --- Realtime: prenumerera på ALLA valtyper (inget filter), routa till rätt
    // store. Instant växling utan om-prenumeration. Prenumerera FÖRE snapshot. ---
    const channel = supabase
      .channel('result-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'result' },
        (payload) => {
          const row = payload.new as {
            valtyp?: string
            valdistriktskod?: string
            partikod?: string
            roster?: number
          }
          if (!row?.valtyp || !row.valdistriktskod || !row.partikod) return
          if (import.meta.env.DEV) {
            const w = window as unknown as { __eventCount?: number }
            w.__eventCount = (w.__eventCount ?? 0) + 1 // last-test-mätning (Fas 7)
          }
          const store = storesRef.current[row.valtyp as Valtyp]
          if (!store) return
          store.set(row.valdistriktskod, row.partikod, row.roster ?? 0)
          if (row.valtyp === activeValtypRef.current) requestApply(row.valdistriktskod)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ;(window as unknown as { __realtimeReady?: boolean }).__realtimeReady = true
        }
      })

    ;(async () => {
      // Per-valtyp nämnare: distrikt som deltar i valtypen (vk_<valtyp> ej null).
      // Härled ur data — anta inte 6312 för alla tre (t.ex. Gotlands regionval).
      const counts = emptyCounts()
      for (const vt of VALTYPER) {
        const { count } = await supabase
          .from('district')
          .select('*', { count: 'exact', head: true })
          .not(VALTYP_VK_COLUMN[vt], 'is', null)
        counts[vt] = count ?? 0
      }
      setTotalByValtyp(counts)

      // Snapshot av redan inrapporterade resultat (alla valtyper, paginerat).
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('result')
          .select('valtyp,valdistriktskod,partikod,roster')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const r of data) storesRef.current[r.valtyp as Valtyp]?.set(r.valdistriktskod, r.partikod, r.roster)
        if (data.length < PAGE) break
      }
      recolorActive()
      setReportedCount(storesRef.current[activeValtypRef.current].reportedCount)
    })()

    return () => {
      supabase.removeChannel(channel)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      recolorRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

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
  }, [valtyp])

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
