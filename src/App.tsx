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
        <div className="absolute left-4 top-4 flex max-w-xs flex-col gap-3">
          <div className="pointer-events-none rounded-lg border border-slate-700 bg-slate-900/85 p-4 shadow-lg backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
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
      </main>
    </ResultsProvider>
  )
}

export default App
