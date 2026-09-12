// Dashboard-vyns rutnät — 2×2, en AreaSummary per ruta, state i ResultsProvider
// (dashboardBoxes/setDashboardBox) så det överlever att detta rutnät avmonteras
// (toggla till Karta och tillbaka). Fyller HELA ytan under App.tsx:s vy-växlare
// (beslutat: avgångstavlorna döljs också i Dashboard-läge, se App.tsx).
import { useResults } from '@/components/ResultsProvider'
import { AreaSummary } from '@/components/AreaSummary'
import { defaultAreaFor } from '@/lib/area'
import type { Valtyp } from '@/lib/results'

export function DashboardGrid() {
  const { dashboardBoxes, setDashboardBox } = useResults()
  return (
    <div className="absolute inset-0 top-11 grid grid-cols-2 grid-rows-2 gap-3 bg-[#0b1020] p-3">
      {dashboardBoxes.map((box, i) => (
        <div
          key={i}
          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950/85 p-3 shadow-2xl backdrop-blur"
        >
          <AreaSummary
            valtyp={box.valtyp}
            area={box.area}
            onValtypChange={(v: Valtyp) => setDashboardBox(i, { valtyp: v, area: defaultAreaFor(v) })}
            onAreaChange={(a) => setDashboardBox(i, { valtyp: box.valtyp, area: a })}
          />
        </div>
      ))}
    </div>
  )
}
