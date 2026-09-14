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
import { deriveSlutligState, type SlutligState, type Valtyp } from '@/lib/results'
import { SlutligBar } from '@/components/SlutligBar'

// Samma hue-familj som SlutligBar:s fyllningsfärg (amber/sky/emerald) — för rad 2:s
// procent-span i `large`-läget (Dashboard-headern), som speglar rad 1:s sky-300-procent
// men färgkodad efter SlutligState i stället för alltid sky.
const SLUTLIG_PCT_TONE: Record<SlutligState, string> = {
  preliminar: 'text-amber-300',
  slutraknas: 'text-sky-300',
  slutlig: 'text-emerald-300',
}

// `large` (valfri, default false): mobilens enda instans behåller den ursprungliga
// kompakta 11px-storleken (oförändrat beteende). Dashboard-lägets tre instanser
// (App.tsx) skickar `large` — tre badges sida vid sida läses bättre i lite större
// stil, och headerraden har gott om bredd (bara valtyp-etikett + siffror + dot).
export function ReportingStatus({ valtyp: valtypProp, large = false }: { valtyp?: Valtyp; large?: boolean } = {}) {
  const {
    valtyp: activeValtyp, totalByValtyp, storesRef, uppsamlingRegistryRef, uppsamlingRegistryReportedRef,
    realtimeConnected, pollError, revision, snapshotVersion,
  } = useResults()
  void revision
  void snapshotVersion
  const valtyp = valtypProp ?? activeValtyp
  const store = storesRef.current[valtyp]
  // Uppsamlingsdistrikten (handover 13 sep) räknas med i nämnaren, som val.se/SVT — annars
  // visar vi t.ex. RD "X av 6312" i stället för deras "X av 6626" (6312 geografiska + 314
  // uppsamling). Se uppsamlingsdistrikt_registry/aggregate.ts.
  const uppRegistry = uppsamlingRegistryRef.current[valtyp]
  const uppReportedSet = uppsamlingRegistryReportedRef.current[valtyp]
  const reported = store.reportedCount + uppRegistry.reduce((n, e) => n + (uppReportedSet.has(e.kod) ? 1 : 0), 0)
  const total = totalByValtyp[valtyp] + uppRegistry.length
  if (total === 0) return null
  const pct = Math.round((reported / total) * 100)
  // Slutgiltig-räkningens EGEN, samtidiga progress (handover 14 sep, Val ANALYSIS) —
  // ersätter den tidigare enda tone/label-chippen (Prel./X %/Slutgiltigt). Riksomfattande,
  // geografiskt (ingen uppsamling — se DistrictMap.tsx/areaView.ts för samma princip).
  const { state: slutligState, pct: slutligPct } = deriveSlutligState(store.slutligDoneCount, store.reportedCount)

  const liveDot = (
    <span
      className={`rounded-full ${large ? 'h-2 w-2' : 'h-1.5 w-1.5'} ${realtimeConnected ? 'animate-pulse bg-emerald-400' : pollError ? 'bg-amber-400' : 'bg-slate-500'}`}
      title={realtimeConnected ? 'Live' : pollError ?? 'Pausad'}
    />
  )

  // Dashboard-headern (PR #151, `large`): TVÅ separata rader, samma typografi på båda —
  // rad 1 (rapportering) OFÖRÄNDRAD, rad 2 (sluträkning) SPEGLAR den exakt i stället för
  // en ihoppressad enrads-badge (Lars, local dev 14 sep: "en rad för prel som den var, en
  // rad för slutgiltig, samma fonter och layout" — den tidigare `flex-wrap`-lösningen såg
  // inkonsekvent ut, för mkt text på rad 1 mot en kort "0 %" på rad 2). Headerns höjd
  // (App.tsx) och DashboardGrid.tsx:s top-offset delar samma CSS-variabel
  // (--dashboard-header-h, index.css) så de aldrig kan hamna i otakt.
  if (large) {
    return (
      <div className="flex shrink-0 flex-col gap-0.5 text-sm text-slate-300">
        <div className="flex items-center gap-1.5">
          {valtypProp && <span className="font-semibold uppercase tracking-wide text-slate-400">{valtypProp}</span>}
          <span className="tabular-nums">
            <span className="font-semibold text-slate-100">{reported.toLocaleString('sv-SE')}</span>
            <span className="text-slate-500"> / {total.toLocaleString('sv-SE')}</span>
            <span className="ml-1 text-sky-300">{pct}%</span>
            {uppRegistry.length > 0 && (
              <span className="ml-1 text-slate-500">(varav {uppRegistry.length.toLocaleString('sv-SE')} uppsamling)</span>
            )}
          </span>
          {liveDot}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Osynlig platshållare i samma bredd som valtyp-etiketten ovan → rad 2:s tal
              börjar på SAMMA x-position som rad 1:s (lodrät linjering). */}
          {valtypProp && <span aria-hidden className="font-semibold uppercase tracking-wide text-transparent">{valtypProp}</span>}
          <span className="tabular-nums">
            <span className="font-semibold text-slate-100">{store.slutligDoneCount.toLocaleString('sv-SE')}</span>
            <span className="text-slate-500"> / {store.reportedCount.toLocaleString('sv-SE')} slutgiltigt</span>
            <span className={`ml-1 ${SLUTLIG_PCT_TONE[slutligState]}`}>{slutligPct}%</span>
          </span>
        </div>
      </div>
    )
  }

  // Mobil (kompakt, `!large`): oförändrad enrads-layout + en liten SlutligBar-badge
  // (`short` — bara "Z %", fast bredd) i stället för den tidigare enda tone/label-chippen.
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300">
      {valtypProp && <span className="font-semibold uppercase tracking-wide text-slate-400">{valtypProp}</span>}
      <span
        className="tabular-nums"
        title={uppRegistry.length > 0 ? `Varav ${uppRegistry.length.toLocaleString('sv-SE')} uppsamlingsdistrikt` : undefined}
      >
        <span className="font-semibold text-slate-100">{reported.toLocaleString('sv-SE')}</span>
        <span className="text-slate-500"> / {total.toLocaleString('sv-SE')}</span>
        <span className="ml-1 text-sky-300">{pct}%</span>
      </span>
      <SlutligBar state={slutligState} pct={slutligPct} done={store.slutligDoneCount} total={store.reportedCount} short />
      {liveDot}
    </div>
  )
}
