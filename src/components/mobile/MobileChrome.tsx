// Persistent toppchrome för mobil-layouten. Äger det som måste finnas kvar OVANFÖR
// flikarna så orienteringen aldrig tappas vid flikbyte:
//   • testdata-banner (genrep vs skarpt) — samma data-styrning som desktop.
//   • valtyp-väljaren (Riksdag/Region/Kommun) — styr ALLA flikar, får inte bo i en flik.
//   • områdesrad — visar valt område + snabb återställning till valtypens toppnivå;
//     tapp öppnar Resultat-fliken (där drill-down-listan bor). Full väljare = fas 2.
//   • kompakt rapporteringsstatus (X av Y · %) + live-indikator.
import { useResults, defaultAreaFor } from '@/components/ResultsProvider'
import { ValtypSelector } from '@/components/ValtypSelector'
import { VALTYP_LABEL } from '@/lib/results'

function TestdataBanner() {
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-[12px] font-semibold text-amber-200">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      <span>Generalrep · <span className="font-bold">testdata</span> — inte skarpa valresultat</span>
    </div>
  )
}

// Kompakt rapporteringsstatus, härledd ur providerns store (inte kartans lokala state,
// så den funkar även innan Karta-fliken öppnats). Bumpas av revision/snapshotVersion.
function ReportingStatus() {
  const { valtyp, totalByValtyp, storesRef, realtimeConnected, revision, snapshotVersion } = useResults()
  void revision
  void snapshotVersion
  const store = storesRef.current[valtyp]
  const reported = store.reportedCount
  const total = totalByValtyp[valtyp]
  if (total === 0) return null
  const pct = Math.round((reported / total) * 100)
  const prog = store.slutligProgress()
  const tone =
    prog.state === 'preliminar' ? 'bg-amber-500/15 text-amber-300'
    : prog.state === 'slutlig' ? 'bg-emerald-500/15 text-emerald-300'
    : 'bg-sky-500/15 text-sky-300'
  const label =
    prog.state === 'preliminar' ? 'Prel.'
    : prog.state === 'slutlig' ? 'Slutgiltigt'
    : `${prog.pct} %`
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300">
      <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
      <span className="tabular-nums">
        <span className="font-semibold text-slate-100">{reported.toLocaleString('sv-SE')}</span>
        <span className="text-slate-500"> / {total.toLocaleString('sv-SE')}</span>
        <span className="ml-1 text-sky-300">{pct}%</span>
      </span>
      <span
        className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`}
        title={realtimeConnected ? 'Live' : 'Offline'}
      />
    </div>
  )
}

// Områdesnamn (samma härledning som panelens breadcrumb-rubrik). RF/KF-default (code=null)
// = "välj"-läge → visa en uppmaning i stället för ett namn.
function useAreaName(): string {
  const { selectedArea, kommuner, regioner, valkretsar, distriktNamnRef } = useResults()
  const { level, code } = selectedArea
  if (level === 'riket') return 'Riket'
  if (code == null)
    return level === 'region' ? 'Välj region' : level === 'kommun' ? 'Välj kommun' : 'Välj valkrets'
  if (level === 'distrikt') return distriktNamnRef.current.get(code) ?? code
  if (level === 'valkrets') return valkretsar.find((v) => v.code === code)?.name ?? code
  if (level === 'region') return regioner.find((r) => r.code === code)?.name ?? code
  return kommuner.find((k) => k.code === code)?.name ?? code
}

export function MobileChrome({ onOpenArea }: { onOpenArea: () => void }) {
  const { dataset, valtyp, selectedArea, setSelectedArea } = useResults()
  const areaName = useAreaName()
  const def = defaultAreaFor(valtyp)
  const atDefault = selectedArea.level === def.level && selectedArea.code === def.code

  return (
    <header
      className="shrink-0 border-b border-slate-800 bg-slate-950/95 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {dataset?.test && <TestdataBanner />}
      <div className="px-3 pt-2">
        <ValtypSelector fill />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onOpenArea}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          title={`${VALTYP_LABEL[valtyp]} — ${areaName}. Tryck för resultat/områden.`}
        >
          <span className="truncate text-sm font-semibold text-slate-100">{areaName}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        {!atDefault && (
          <button
            type="button"
            onClick={() => setSelectedArea(def)}
            aria-label="Återställ till hela Sverige"
            title="Hela Sverige"
            className="shrink-0 rounded-md border border-slate-700 bg-slate-900/90 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            Hela Sverige
          </button>
        )}
        <ReportingStatus />
      </div>
    </header>
  )
}
