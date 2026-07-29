import { DistrictMap } from '@/components/DistrictMap'
import { ResultPanel } from '@/components/ResultPanel'

function App() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b1020] text-slate-100">
      <DistrictMap />
      <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-lg border border-slate-700 bg-slate-900/85 p-4 shadow-lg backdrop-blur">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
          Presentation — resultattabell
        </p>
        <h1 className="text-xl font-bold tracking-tight">Valvaka 2026</h1>
        <p className="mt-1 text-sm text-slate-400">
          Röster och andel per parti på alla nivåer. Mandat och jämförelse mot 2022
          kommer i nästa steg.
        </p>
      </div>

      {/* Resultattabell — höger panel (layout provisorisk) */}
      <aside className="absolute right-0 top-0 h-full w-[380px] border-l border-slate-800 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <ResultPanel />
      </aside>
    </main>
  )
}

export default App
