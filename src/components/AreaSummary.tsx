// En Dashboard-rutas fulla innehåll — "toppen" av ResultPanel.tsx (till och med
// Summa-raden), men med EGEN, lokal valtyp+område i stället för providerns
// globala selectedArea. Helt kontrollerad (state ägs av ResultsProvider, se
// dashboardBoxes/setDashboardBox) — denna komponent har ingen egen state.
// Ingen breadcrumb, ingen "Bryt ner": varje ruta har redan en flat områdesväljare
// (AreaSelect) för att hoppa vart som helst, och Bryt ner är explicit utanför
// scope (se docs/superpowers/specs/2026-09-12-dashboard-vy-design.md). MandatBars
// körs alltid `compact` (smalare kolumn i rutnätet); samma kompakta ordval
// används för undertext/valdeltagande-etiketten (samma anda som mobilens
// `compact`-läge i ResultPanel.tsx, fast hårdkodat här — varje ruta är alltid smal).
import { VALTYP_LABEL, type Valtyp } from '@/lib/results'
import { sparrFor } from '@/lib/aggregate'
import { RIKET, type Area } from '@/lib/area'
import { ResultTable } from '@/components/ResultTable'
import { MandatBars } from '@/components/MandatBars'
import { AreaSelect } from '@/components/AreaSelect'
import { ValtypSelector } from '@/components/ValtypSelector'
import { useAreaView } from '@/components/useAreaView'

const ELECTION: Record<Valtyp, string> = { RD: 'Riksdagsvalet', RF: 'Regionvalet', KF: 'Kommunvalet' }

export function AreaSummary({
  valtyp,
  area,
  onValtypChange,
  onAreaChange,
}: {
  valtyp: Valtyp
  area: Area
  onValtypChange: (v: Valtyp) => void
  onAreaChange: (a: Area) => void
}) {
  const av = useAreaView(valtyp, area)
  const isPrompt = area.level !== 'riket' && area.code == null
  const pct = av.pct

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <ValtypSelector fill value={valtyp} onChange={onValtypChange} />
      <div className="flex items-center gap-2">
        <AreaSelect valtyp={valtyp} area={area} areaName={av.areaName} onChange={onAreaChange} />
        <span
          className="shrink-0 select-none rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-sm font-semibold text-sky-200"
          title={ELECTION[valtyp]}
        >
          {VALTYP_LABEL[valtyp]}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {isPrompt ? (
          <p className="mb-2 mt-4 text-center text-sm text-slate-400">
            Välj {valtyp === 'RF' ? 'en region' : 'en kommun'} i listan ovan.
          </p>
        ) : (
          <>
            {valtyp === 'RD' && area.level !== 'riket' && area.level !== 'valkrets' && (
              <p className="mb-3 text-xs text-slate-500">
                Riksdagsmandat räknas bara ut på riksnivå — se{' '}
                <button type="button" onClick={() => onAreaChange(RIKET)} className="underline hover:text-slate-300">
                  Riket
                </button>{' '}
                för mandatfördelning. Här visas bara röstandelen för {av.areaName}.
              </p>
            )}
            {av.giltiga > 0 && (
              <div className="mb-3 border-b border-slate-800 pb-3">
                <MandatBars
                  shown={av.display.shown}
                  ovriga={av.display.ovriga}
                  totalMandat={av.totalMandat}
                  giltiga={av.giltiga}
                  sparr={sparrFor(valtyp, area.level, area.code)}
                  reportPct={pct}
                  blocks={av.blocks}
                  compact
                />
              </div>
            )}
            <ResultTable
              title={`${ELECTION[valtyp]} — ${av.areaName}`}
              statusTag={av.statusTag}
              subtitle={`${av.reported.toLocaleString('sv-SE')}/${av.total.toLocaleString('sv-SE')} distrikt (${pct} %)`}
              turnoutLabel={
                av.turnout == null
                  ? undefined
                  : `${av.turnout.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % röstade`
              }
              turnoutTitle={av.turnoutTitle}
              reportPct={av.total > 0 ? (av.reported / av.total) * 100 : 0}
              display={av.display}
              giltiga={av.giltiga}
              sparr={sparrFor(valtyp, area.level, area.code)}
              showSparr={area.level !== 'distrikt'}
              showMandat={av.showMandat}
              totalMandat={av.totalMandat}
              totalMandat2022={av.totalMandat2022}
            />
            {av.giltiga === 0 &&
              (av.has2022 ? (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga 2026-röster inrapporterade än — <span className="text-slate-400">2022</span>-kolumnerna visar
                  förra valets slutresultat.
                </p>
              ) : (
                <p className="mt-4 text-center text-xs text-slate-500">
                  Inga resultat inrapporterade för {VALTYP_LABEL[valtyp].toLowerCase()} i {av.areaName} än.
                </p>
              ))}
          </>
        )}
      </div>
    </div>
  )
}
