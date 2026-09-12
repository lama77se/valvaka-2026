// Kompakt rapporteringsstatus, härledd ur providerns store (inte kartans lokala state,
// så den funkar även innan Karta-fliken öppnats). Bumpas av revision/snapshotVersion.
//
// Delad mellan mobil (MobileChrome, ett anrop utan `valtyp` → visar den GLOBALT aktiva
// valtypen, som en generell "lever datapipelinen"-indikator) och desktop Dashboard-läget
// (App.tsx, tre anrop MED explicit `valtyp` → en badge per val, eftersom Dashboard-vyn
// kan visa alla tre valen samtidigt och den globalt aktiva valtypen då inte täcker vad
// som faktiskt syns på skärmen). Extraherad härifrån (ursprungligen mobil-lokal) i
// samband med finalgranskningens fix-våg.
import { useResults } from '@/components/ResultsProvider'
import type { Valtyp } from '@/lib/results'

// `large` (valfri, default false): mobilens enda instans behåller den ursprungliga
// kompakta 11px-storleken (oförändrat beteende). Dashboard-lägets tre instanser
// (App.tsx) skickar `large` — tre badges sida vid sida läses bättre i lite större
// stil, och headerraden har gott om bredd (bara valtyp-etikett + siffror + dot).
export function ReportingStatus({ valtyp: valtypProp, large = false }: { valtyp?: Valtyp; large?: boolean } = {}) {
  const { valtyp: activeValtyp, totalByValtyp, storesRef, realtimeConnected, pollError, revision, snapshotVersion } = useResults()
  void revision
  void snapshotVersion
  const valtyp = valtypProp ?? activeValtyp
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
    <div className={`flex shrink-0 items-center gap-1.5 text-slate-300 ${large ? 'text-sm' : 'text-[11px]'}`}>
      {/* Valtyp-etikett bara när `valtyp` skickas in explicit (Dashboard-lägets tre
          instanser, sida vid sida) — mobilens enda instans (ingen prop) behöver ingen,
          den globalt aktiva valtypen syns redan i chromen intill. */}
      {valtypProp && <span className="font-semibold uppercase tracking-wide text-slate-400">{valtypProp}</span>}
      <span className={`rounded font-semibold uppercase tracking-wide ${tone} ${large ? 'px-2 py-1' : 'px-1.5 py-0.5'}`}>{label}</span>
      <span className="tabular-nums">
        <span className="font-semibold text-slate-100">{reported.toLocaleString('sv-SE')}</span>
        <span className="text-slate-500"> / {total.toLocaleString('sv-SE')}</span>
        <span className="ml-1 text-sky-300">{pct}%</span>
      </span>
      <span
        className={`rounded-full ${large ? 'h-2 w-2' : 'h-1.5 w-1.5'} ${realtimeConnected ? 'animate-pulse bg-emerald-400' : pollError ? 'bg-amber-400' : 'bg-slate-500'}`}
        title={realtimeConnected ? 'Live' : pollError ?? 'Pausad'}
      />
    </div>
  )
}
