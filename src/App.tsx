import { DistrictMap } from '@/components/DistrictMap'

function App() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b1020] text-slate-100">
      <DistrictMap />
      <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-lg border border-slate-700 bg-slate-900/85 p-4 shadow-lg backdrop-blur">
        <p className="text-xs font-medium uppercase tracking-widest text-slate-400">
          Fas 1 — geometri
        </p>
        <h1 className="text-xl font-bold tracking-tight">Valvaka 2026</h1>
        <p className="mt-1 text-sm text-slate-400">
          Alla ~6 300 valdistrikt. Resultatfärgning kommer i senare faser.
        </p>
      </div>
    </main>
  )
}

export default App
