import { DistrictMap } from '@/components/DistrictMap'
import { ResultPanel } from '@/components/ResultPanel'
import { ResultsProvider } from '@/components/ResultsProvider'
import { DepartureBoard } from '@/components/DepartureBoard'
import { PartyLegend } from '@/components/PartyLegend'

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
          </div>
          <PartyLegend />
        </div>

        {/* Departure board — live-ticker över inrapporterade distrikt (nedre vänster) */}
        <DepartureBoard />

        {/* Resultattabell — höger panel (layout provisorisk) */}
        <aside className="absolute right-0 top-0 h-full w-[440px] border-l border-slate-800 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
          <ResultPanel />
        </aside>
      </main>
    </ResultsProvider>
  )
}

export default App
