// Ortnamn-overlay ("plupp" + text) ovanpå kartan för geografisk orientering —
// BLANK_STYLE (DistrictMap.tsx) har annars inga referenspunkter alls (ingen
// kustlinje-kontrast, inga städer). DOM/HTML-overlay, INTE MapLibres native
// symbol/text-field-lager: ett textlager kräver en glyphs-endpoint (font-glyf-
// PBF:er) som inte finns konfigurerad och skulle vara ett nytt externt beroende
// — bryter mot BLANK_STYLE:s medvetna "inga externa tiles/nycklar"-princip.
// DOM-overlay behöver ingen sådan infrastruktur.
//
// Data: en engångskurerad, statisk fil (public/place-labels.json) — namn +
// WGS84-koordinat + tier (1=störst/alltid synlig, 4=minst). Ingen val.se-källa
// (saknar ortnamn/befolkning), ingen databas/ingest-koppling — samma mönster
// som district-bounds.json (fetch:as en gång, se effekten nedan).
//
// Positioner räknas om på map.on('move') (täcker BÅDE panorering och zoom),
// rAF-koalescerat — samma PRINCIP som DistrictMap.tsx:s scheduleFlush (en
// betald omritning per frame oavsett händelsefrekvens), men en egen, oberoende
// instans (annan angelägenhet: DOM-position, inte feature-state-färg). DOM-
// noderna byggs EN gång (inte per rAF) — position/synlighet/tier-gate skrivs
// sedan direkt till elementens style, ingen React-state-churn under drag/zoom.
//
// pointer-events: none på hela lagret → klick fortsätter nå polygonerna under,
// ingen ändring i befintlig klick-/hover-hantering.
import { useEffect, useRef, useState } from 'react'
import type * as maplibregl from 'maplibre-gl'

type Place = { name: string; lat: number; lon: number; tier: number; pop: number }

// Zoom-tröskel per tier — satt empiriskt (samma princip som handover:en
// föreslår: testa i browsern, dra åt vid behov). Default "hela Sverige"-vy
// (SWEDEN_BOUNDS-fitBounds) landar på ~zoom 4.1 (desktop) — INGEN etikett ska
// synas där (användaren känner redan till Sveriges form; etiketter först när
// man zoomar in en bit). Tier 1 (de 15 största kommunerna) kommer in strax
// därefter, vid zoom 5.
const TIER_MIN_ZOOM: Record<number, number> = { 1: 5, 2: 6, 3: 7.5, 4: 9, 5: 10.5 }

// Enkel gles kollisionskoll (INTE en fullständig kollisionsmotor): två SAMTIDIGT
// synliga etiketter närmare varandra än detta (pixlar) → skippa den senare i
// prioritetsordningen (se sortNodesByPriority nedan — tier-stigande, sedan
// befolkning-fallande INOM en tier — så en större/viktigare ort alltid vinner
// mot en mindre om de skulle kollidera, oavsett var de råkar ligga i filen).
const MIN_LABEL_SPACING_PX = 42
// Marginal utanför synliga ytan innan en etikett hoppas över helt (undviker att
// uppdatera/positionera noder som ändå inte syns).
const OFFSCREEN_MARGIN_PX = 60

export function PlaceLabels({ map, ready }: { map: maplibregl.Map | null; ready: boolean }) {
  const [places, setPlaces] = useState<Place[] | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Ladda platslistan en gång (samma mönster som district-bounds.json-effekten).
  useEffect(() => {
    let alive = true
    fetch('/place-labels.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Place[] | null) => {
        if (alive && data) setPlaces(data)
      })
      .catch((err) => console.error('[PlaceLabels] place-labels.json:', err))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!map || !ready || !places || !containerRef.current) return
    const container = containerRef.current

    // Bygg DOM-noderna EN gång — se filkommentaren ovan.
    //
    // Läsbarhet: en text-shadow-halo ENSAM räcker inte överallt — när ett område
    // fokuseras (vald valkrets/kommun m.m.) ritar kartan TJOCKA, LJUSA gränslinjer
    // (#e2e8f0, district-line/group-line i DistrictMap.tsx) som ligger nästan exakt
    // i samma ljusa ton som etikettens text (text-slate-100) → halon räcker inte,
    // det blir vitt-på-vitt där en gräns råkar passera bakom en etikett. Lösning:
    // en solid, halvgenomskinlig MÖRK bakgrundschip bakom varje etikett — garanterar
    // kontrast oavsett vad som ligger under (distriktsfärg, mörk bakgrund, ELLER en
    // ljus gränslinje), i stället för att förlita sig på att skuggan "vinner".
    container.innerHTML = ''
    // Prioritetsordning för kollisionsloopen: tier-stigande (en tier 1-stad vinner
    // alltid mot en tier 2-ort), sedan befolkning-fallande INOM en tier (Stockholm
    // vinner mot Huddinge — annars avgjorde filens (alfabetiska) ordning av misstag,
    // vilket kunde gömma en viktigare ort bakom en mindre men alfabetiskt tidigare).
    const sorted = [...places].sort((a, b) => a.tier - b.tier || b.pop - a.pop)
    const nodes = sorted.map((p) => {
      const el = document.createElement('div')
      el.className =
        'absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11px] font-medium text-slate-100'
      el.style.backgroundColor = 'rgba(8, 12, 24, 0.68)'
      el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.5)'
      el.style.willChange = 'transform'
      const dot = document.createElement('span')
      dot.className = 'h-[3px] w-[3px] shrink-0 rounded-full bg-slate-200'
      const label = document.createElement('span')
      label.textContent = p.name
      el.appendChild(dot)
      el.appendChild(label)
      container.appendChild(el)
      return { place: p, el }
    })

    let rafId: number | null = null
    const update = () => {
      rafId = null
      const zoom = map.getZoom()
      const w = container.clientWidth
      const h = container.clientHeight
      const placed: { x: number; y: number }[] = []
      for (const { place: p, el } of nodes) {
        if (zoom < (TIER_MIN_ZOOM[p.tier] ?? Infinity)) {
          el.style.display = 'none'
          continue
        }
        const pt = map.project([p.lon, p.lat])
        if (pt.x < -OFFSCREEN_MARGIN_PX || pt.x > w + OFFSCREEN_MARGIN_PX || pt.y < -OFFSCREEN_MARGIN_PX || pt.y > h + OFFSCREEN_MARGIN_PX) {
          el.style.display = 'none'
          continue
        }
        const tooClose = placed.some((q) => Math.abs(q.x - pt.x) < MIN_LABEL_SPACING_PX && Math.abs(q.y - pt.y) < MIN_LABEL_SPACING_PX)
        if (tooClose) {
          el.style.display = 'none'
          continue
        }
        placed.push({ x: pt.x, y: pt.y })
        el.style.display = 'flex'
        el.style.transform = `translate(${pt.x}px, ${pt.y}px) translate(2px, -50%)`
      }
    }
    const scheduleUpdate = () => {
      if (rafId != null) return
      rafId = requestAnimationFrame(update)
    }
    scheduleUpdate()
    map.on('move', scheduleUpdate)
    map.on('resize', scheduleUpdate)
    return () => {
      map.off('move', scheduleUpdate)
      map.off('resize', scheduleUpdate)
      if (rafId != null) cancelAnimationFrame(rafId)
      container.innerHTML = ''
    }
  }, [map, ready, places])

  return <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
}
