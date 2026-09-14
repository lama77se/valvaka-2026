// Slutgiltig-räkningens progress-bar — SAMMA visuella mönster som den befintliga
// rapporteringsbaren (fylld/dimmad remsa bakom en textrad), men färgkodad efter
// SlutligState (amber/sky/emerald, samma toner som slutligTag) i stället för alltid grön.
// Handover 14 sep (Val ANALYSIS): dagens ENDA statustext/-badge byts mot TVÅ separata,
// samtidiga barer — denna komponent är den NYA (sluträkningsgrad), rapporteringsbaren
// (redan i ResultTable.tsx) lämnas orörd. Delad mellan alla ytor som visar statusen
// (ResultTable/MandatBars — områdesskopat; DistrictMap/DepartureBoard/ReportingStatus —
// riksomfattande, se respektive fil för vilket `done`/`total` som skickas in).
import { slutligTag, type SlutligState } from '@/lib/results'

const FILL_TONE: Record<SlutligState, string> = {
  preliminar: 'bg-amber-500/35',
  slutraknas: 'bg-sky-500/35',
  slutlig: 'bg-emerald-500/35',
}

export function SlutligBar({
  state,
  pct,
  done,
  total,
  compact = false,
  short = false,
}: {
  state: SlutligState
  pct: number
  done: number
  total: number
  compact?: boolean
  // Extremt trångt utrymme (ReportingStatus.tsx:s en-rads-header, Dashboard-headern/PR
  // #151 och mobil-chromen) — bara "Z %" i en smal, fast bredd i stället för hela
  // "X av Y slutgiltigt räknade"-frasen. Fulla talen finns ändå i tooltipen (`title`).
  short?: boolean
}) {
  if (total === 0) return null
  const { title } = slutligTag({ state, pct })
  const fullTitle = `${title} (${done.toLocaleString('sv-SE')} av ${total.toLocaleString('sv-SE')})`
  const label = short
    ? `${pct} %`
    : compact
      ? `${done.toLocaleString('sv-SE')}/${total.toLocaleString('sv-SE')} slutgiltigt (${pct} %)`
      : `${done.toLocaleString('sv-SE')} av ${total.toLocaleString('sv-SE')} slutgiltigt räknade (${pct} %)`
  return (
    <div className={`relative shrink-0 overflow-hidden rounded border border-slate-800 bg-slate-800/40 ${short ? 'w-14' : ''}`} title={fullTitle}>
      <div
        className={`absolute inset-y-0 left-0 transition-[width] duration-500 ${FILL_TONE[state]}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        aria-hidden
      />
      <p className={`relative whitespace-nowrap px-2 py-1 text-slate-300 ${compact || short ? 'text-[11px]' : 'text-xs'} ${short ? 'text-center' : ''}`}>
        {label}
      </p>
    </div>
  )
}
