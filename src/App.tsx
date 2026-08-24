import { Analytics } from '@vercel/analytics/react'
import { DistrictMap } from '@/components/DistrictMap'
import { ResultPanel } from '@/components/ResultPanel'
import { ResultsProvider } from '@/components/ResultsProvider'
import { DepartureBoard } from '@/components/DepartureBoard'
import { PartyLegend } from '@/components/PartyLegend'
import { VALTYPER } from '@/lib/results'

function App() {
  return (
    <ResultsProvider>
      <main className="relative h-screen w-screen overflow-hidden bg-[#0b1020] text-slate-100">
        <DistrictMap />
        <div className="absolute left-4 top-4 flex max-w-[248px] flex-col gap-3">
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
            <p className="pr-7 text-xs font-medium uppercase tracking-widest text-slate-400">
              Valresultat i realtid
            </p>
            <h1 className="text-xl font-bold tracking-tight">Valvaka 2026</h1>
            <p className="mt-1 text-sm text-slate-400">
              Röster, andel och mandat per parti på alla nivåer — jämfört mot 2022,
              uppdaterat live per valdistrikt.
            </p>
            {/* Källhänvisning — Valmyndighetens villkor: all data är fri att använda
                förutsatt att Valmyndigheten anges som källa. */}
            <p
              className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-slate-500"
              title="All data är fri att använda, förutsatt att du anger Valmyndigheten som källa. Publiceras vartefter uppgifterna blir tillgängliga och datafilerna sammanställts."
            >
              Data från <span className="font-medium text-slate-400">Valmyndigheten</span>
            </p>
          </div>
          <PartyLegend />
        </div>

        {/* Tre avgångstavlor — RD/RF/KF, alltid synliga (nedre vänster). Live-ticker
            över inrapporterade distrikt + rapporteringsgrad per val. */}
        <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col gap-2">
          {VALTYPER.map((vt) => (
            <DepartureBoard key={vt} valtyp={vt} />
          ))}
        </div>

        {/* Resultattabell — höger panel. Bredden styrs av --panel-w (index.css), delad med
            kartkontrollernas offset så zoom-knapparna aldrig hamnar under panelen. */}
        <aside className="absolute right-0 top-0 h-full w-[var(--panel-w)] border-l border-slate-800 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
          <ResultPanel />
        </aside>
        {/* Vercel Web Analytics — sidvisningar/besök. Vite/React-varianten (ej /next).
            Samlar in data först i produktion på Vercel; no-op lokalt. */}
        <Analytics />
      </main>
    </ResultsProvider>
  )
}

export default App
