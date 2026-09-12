import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { DistrictMap } from '@/components/DistrictMap'
import { ResultPanel } from '@/components/ResultPanel'
import { ResultsProvider, useResults } from '@/components/ResultsProvider'
import { DepartureBoard } from '@/components/DepartureBoard'
import { PartyLegend } from '@/components/PartyLegend'
import { MobileApp } from '@/components/mobile/MobileApp'
import { AttributionInfo } from '@/components/AttributionInfo'
import { DashboardGrid } from '@/components/DashboardGrid'
import { TestdataBanner } from '@/components/TestdataBanner'
import { InfoButton } from '@/components/InfoButton'
import { ReportingStatus } from '@/components/ReportingStatus'
import { VALTYPER } from '@/lib/results'

// Brytpunkt = Tailwinds xl (1280 px). Desktop-layouten (svävande overlays) visas från
// xl och uppåt — det täcker alla normala kontorslaptops (1280/1366/1536 px breda). Under
// 1280 px byter vi till mobil-layouten (flikar). Desktop görs kompakt nog att rymmas i
// office-kuvertet ~1280×700 → 1536×750 (den vertikala flaskhalsen är de tre staplade
// avgångstavlorna). Mobil-grenen bor helt i <MobileApp>.
const MOBILE_QUERY = '(max-width: 1279.98px)'
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

// Desktop-layouten — fullskärmskarta med svävande overlays i kartläget, eller
// Dashboard-griden i dashboardläget (vy-växlaren högst upp styr vilket). Kartlägets
// innehåll är i övrigt oförändrat sedan förr; enda skillnaden där är att den lyfts ur
// App() till en egen komponent så mobil/desktop kan dela EN ResultsProvider (snapshot
// laddas en gång, överlever rotation över brytpunkten).
function DesktopApp() {
  const { valtyp, view, setView, dataset } = useResults()
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b1020] text-slate-100">
        {/* Vy-växlare (Karta/Dashboard) — alltid synlig, oavsett läge. Samma bredd/
            högerkant som resultatpanelen (--panel-w) så den känns som panelens
            "header", fast den styr HELA huvudytan, inte bara panelen. z-20 så den
            alltid ligger ovanpå kartan i kartläget. */}
        <div className="absolute right-0 top-0 z-20 flex h-11 w-[var(--panel-w)] items-center justify-end border-b border-l border-slate-800 bg-slate-950/90 px-4 shadow-lg backdrop-blur">
          <div className="flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-sm shadow-lg">
            <button
              type="button"
              onClick={() => setView('karta')}
              className={`px-4 py-1.5 font-medium transition-colors ${view === 'karta' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Karta
            </button>
            <button
              type="button"
              onClick={() => setView('dashboard')}
              className={`px-4 py-1.5 font-medium transition-colors ${view === 'dashboard' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              Dashboard
            </button>
          </div>
        </div>

        {/* Dashboard-lägets header-chrome — testdata-banner, rapporteringsstatus och
            källhänvisning. Kartläget visar samma info redan via DistrictMap:s egna
            interna delar (banner/attribution i vänsterspalten), så detta renderas
            BARA i Dashboard-läget för att undvika dubblering. Ryms i den vänstra,
            annars tomma delen av 44px-headerremsan (vy-växlaren upptar bara
            höger, --panel-w-breda, delen). Komponenterna delas med mobil —
            extraherade ur MobileChrome.tsx i denna fix-våg. */}
        {view === 'dashboard' && (
          <div className="absolute left-0 top-0 z-20 flex h-11 items-center gap-3 overflow-hidden px-4">
            {dataset?.test && <TestdataBanner genrep={dataset.source === 'genrep2026'} />}
            {/* En status-badge PER valtyp (inte bara den globalt aktiva) — Dashboard-vyns
                fyra rutor kan visa alla tre valen samtidigt, så en enda global indikator
                skulle inte täcka vad som faktiskt syns på skärmen. */}
            {VALTYPER.map((vt) => (
              <ReportingStatus key={vt} valtyp={vt} large />
            ))}
            <InfoButton />
          </div>
        )}

        {/* Kartläge vs Dashboard-läge byts genom att montera/avmontera hela grenen —
            varje toggle till Karta gör alltså en FULL DistrictMap-reinit (GeoJSON
            re-tessellation, viewport återställd till SWEDEN_BOUNDS, panorering/zoom
            tappas). Ett medvetet, accepterat UX-tradeoff för v1 (för riskabelt att
            ändra strax före valnatten) — kontrasta mot MobileApp.tsx:s tab-växlare,
            som håller kartan monterad och togglar `hidden` för att slippa just detta. */}
        {view === 'karta' ? (
          <>
            <DistrictMap />
            {/* Vänsterkolumn: info-kort + "Vinnande parti"-legend högst upp, avgångstavlorna
                fyller resten av höjden (flex-1) ner till nederkanten → de växer och visar fler
                rader på högre skärmar men håller sig kompakta nära brytpunkten, utan att krocka
                med legenden ovanför. */}
            <div className="pointer-events-none absolute inset-y-4 left-4 flex flex-col gap-3">
              <div className="flex w-[var(--boards-w)] flex-col gap-3">
              <div className="pointer-events-none relative rounded-lg border border-slate-700 bg-slate-900/85 p-4 shadow-lg backdrop-blur">
                {/* Källkodslänk — icon-only-länk (best practice: aria-label för
                    skärmläsare, target=_blank + rel=noopener noreferrer, pointer-events-auto
                    då kortet självt släpper klick till kartan, focus-visible-ring för
                    tangentbord). Inline SVG = ingen ikon-beroende-osäkerhet. */}
                <a
                  href="https://github.com/lama77se/valvaka-2026"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Källkod på GitHub"
                  title="Källkod på GitHub"
                  className="pointer-events-auto absolute right-3 top-3 rounded text-slate-400 outline-none transition-colors hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.76-3.65 3.95.29.25.55.73.55 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </a>
                <h1 className="pr-7 text-xl font-bold tracking-tight">Valvaka 2026</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Liveresultat på alla nivåer.
                </p>
                {/* Källhänvisning — Valmyndighetens villkor: all data är fri att använda
                    förutsatt att Valmyndigheten anges som källa. */}
                <div className="mt-2 border-t border-slate-800 pt-2">
                  <AttributionInfo />
                </div>
              </div>
              <PartyLegend />
              </div>

              {/* Tre avgångstavlor — RD/RF/KF, alltid synliga I KARTLÄGET (döljs i Dashboard-
                  läget tillsammans med kartan, se view-villkoret ovan — annars skulle de
                  visuellt överlappa och stjäla klick från översta vänstra Dashboard-rutan).
                  Fyller (flex-1) höjden under legenden ner till nederkanten → visar fler
                  rader på högre skärmar, kompakta nära brytpunkten. id:t används av kartans
                  fitBounds för att reservera vänsterkolumnen. Vald valtyp (ValtypSelector)
                  vägs upp (emphasized → 50 %), övriga två delar resten (25 % var) — bara på
                  desktop, mobilens "Senaste"-flik förblir jämn. */}
              <div id="left-boards" className="flex min-h-0 flex-1 flex-col gap-2">
                {VALTYPER.map((vt) => (
                  <DepartureBoard key={vt} valtyp={vt} fill emphasized={vt === valtyp} />
                ))}
              </div>
            </div>

            {/* Resultattabell — höger panel. Bredden styrs av --panel-w (index.css), delad med
                kartkontrollernas offset så zoom-knapparna aldrig hamnar under panelen. Skjuten
                ner (top-11) under vy-växlaren ovan; ResultPanel självt är oförändrat. */}
            <aside className="absolute right-0 top-11 h-[calc(100%-2.75rem)] w-[var(--panel-w)] border-l border-slate-800 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
              <ResultPanel />
            </aside>
          </>
        ) : (
          <DashboardGrid />
        )}

        {/* Vercel Web Analytics — sidvisningar/besök. Vite/React-varianten (ej /next).
            Samlar in data först i produktion på Vercel; no-op lokalt. */}
        <Analytics />
      </main>
  )
}

function App() {
  const isMobile = useIsMobile()
  // EN provider ovanför grenen: state (valtyp/område), Realtime-prenumerationen och
  // snapshot-laddningen skapas en gång och överlever när viewporten korsar brytpunkten
  // (rotation/resize) → ingen omladdning av ~162k rader vid layoutbytet.
  return (
    <ResultsProvider>
      {isMobile ? <MobileApp /> : <DesktopApp />}
    </ResultsProvider>
  )
}

export default App
