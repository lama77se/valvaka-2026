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

// Läsbar etikett för district_comparison.jamforbarhet (Fas 2-referensdata).
const JAMFORBARHET_LABEL: Record<string, string> = {
  JA: 'Jämförbar mot 2022',
  NEJ: 'Ej jämförbar mot 2022',
  FLERA: 'Jämförs mot flera 2022-distrikt',
}

// Tom bakgrundsstil utan extern basemap: inga API-nycklar, inga externa tiles.
// Fas 1 ritar bara distrikten själva — "tom karta över alla ~6 300 distrikt".
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0f172a' } },
  ],
}

// Det hovrade distriktets egenskaper, för info-rutan (bevisar att property-join
// och feature-state-mekaniken funkar — samma väg som resultatfärgning i Fas 5).
type HoverInfo = { kod: string; namn: string; kommun: string; lan: string }

export function DistrictMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  // Referensdata från Supabase (Fas 2) för det hovrade distriktet — bevisar
  // klient→DB-uppslag på valdistriktskod i själva appen.
  const [jamforbarhet, setJamforbarhet] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BLANK_STYLE,
      bounds: SWEDEN_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      // Sverige är avlångt; lås ur onödig rotation/tilt för en ren distriktskarta.
      dragRotate: false,
      pitchWithRotate: false,
    })
    mapRef.current = map
    if (import.meta.env.DEV) {
      ;(window as unknown as { __map?: maplibregl.Map }).__map = map
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('error', (e) => {
      // Ytliggör maplibre-fel i konsolen (t.ex. GeoJSON som inte kan laddas).
      console.error('[DistrictMap] maplibre error:', e.error ?? e)
    })

    map.on('load', () => {
      map.addSource('districts', {
        type: 'geojson',
        data: GEOMETRY_URL,
        promoteId: DISTRICT_ID_PROPERTY,
      })

      // Fyllnad: neutral i Fas 1, hover-highlight via feature-state. I Fas 5
      // byts den konstanta färgen mot ett uttryck på result-värden.
      map.addLayer({
        id: 'district-fill',
        type: 'fill',
        source: 'districts',
        paint: {
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            '#38bdf8',
            '#475569',
          ],
          'fill-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'district-line',
        type: 'line',
        source: 'districts',
        paint: { 'line-color': '#cbd5e1', 'line-width': 0.4 },
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
        // mousemove spammar; uppdatera bara state (och trigga DB-uppslag) när
        // man faktiskt går in i ett nytt distrikt.
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
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Fas 2: slå upp referensdata i Supabase på valdistriktskod när man hovrar ett
  // nytt distrikt. maybeSingle → null om distriktet saknar jämförelserad.
  useEffect(() => {
    const kod = hover?.kod
    if (!kod) {
      setJamforbarhet(null)
      return
    }
    let cancelled = false
    setJamforbarhet(null)
    supabase
      .from('district_comparison')
      .select('jamforbarhet')
      .eq('valdistriktskod', kod)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setJamforbarhet(data?.jamforbarhet ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [hover?.kod])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {hover && (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 shadow-lg">
          <div className="font-semibold">{hover.namn || '—'}</div>
          <div className="text-slate-400">
            {hover.kommun} · {hover.lan} · <span className="font-mono">{hover.kod}</span>
          </div>
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
