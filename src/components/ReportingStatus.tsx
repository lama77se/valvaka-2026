// Kompakt rapporteringsstatus, härledd ur providerns store (inte kartans lokala state,
// så den funkar även innan Karta-fliken öppnats). Bumpas av revision/snapshotVersion.
// Rapporterar på den GLOBALT aktiva valtypen (inte per Dashboard-ruta) — den är tänkt
// som en generell "lever datapipelinen"-indikator, precis som den redan är på mobil.
//
// Delad mellan mobil (MobileChrome) och desktop Dashboard-läge (App.tsx) — extraherad
// härifrån (ursprungligen mobil-lokal) i samband med finalgranskningens fix-våg.
import { useResults } from '@/components/ResultsProvider'

export function ReportingStatus() {
  const { valtyp, totalByValtyp, storesRef, realtimeConnected, pollError, revision, snapshotVersion } = useResults()
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
        className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? 'animate-pulse bg-emerald-400' : pollError ? 'bg-amber-400' : 'bg-slate-500'}`}
        title={realtimeConnected ? 'Live' : pollError ?? 'Pausad'}
      />
    </div>
  )
}
