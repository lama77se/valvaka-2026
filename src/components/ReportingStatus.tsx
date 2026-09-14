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
import { uppsamlingSuffix } from '@/lib/aggregate'
import { deriveSlutligState, type SlutligState, type Valtyp } from '@/lib/results'

// Samma hue-familj som SlutligBar:s fyllningsfärg (amber/sky/emerald) — för procent-
// spannen (båda lägena), färgkodad efter SlutligState i stället för alltid sky.
const SLUTLIG_PCT_TONE: Record<SlutligState, string> = {
  preliminar: 'text-amber-300',
  slutraknas: 'text-sky-300',
  slutlig: 'text-emerald-300',
}
// "Slut"-badgens bakgrund (mobil-läget, se nedan) — samma tre toner.
const SLUT_BADGE_TONE: Record<SlutligState, string> = {
  preliminar: 'bg-amber-500/15 text-amber-300',
  slutraknas: 'bg-sky-500/15 text-sky-300',
  slutlig: 'bg-emerald-500/15 text-emerald-300',
}
const BADGE_BASE = 'shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide'

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
  const uppReportedCount = uppRegistry.reduce((n, e) => n + (uppReportedSet.has(e.kod) ? 1 : 0), 0)
  const reported = store.reportedCount + uppReportedCount
  const total = totalByValtyp[valtyp] + uppRegistry.length
  if (total === 0) return null
  const pct = Math.round((reported / total) * 100)
  // "Bara uppsamling kvar" (handover 14 sep, Lars) — se uppsamlingSuffix (aggregate.ts).
  const upp = uppsamlingSuffix(reported, total, uppRegistry.length, uppReportedCount)
  // Slutgiltig-räkningens EGEN, samtidiga progress (handover 14 sep, Val ANALYSIS) —
  // ersätter den tidigare enda tone/label-chippen (Prel./X %/Slutgiltigt). Riksomfattande,
  // geografiskt (ingen uppsamling — se DistrictMap.tsx/areaView.ts för samma princip).
  const { state: slutligState, pct: slutligPct } = deriveSlutligState(store.slutligDoneCount, store.reportedCount)
  // Döljer den PRELIMINÄRA raden/badgen helt vid 100 % + pågående sluträkning (handover
  // 14 sep, Lars uppföljning: "om PREL 100% och SLUT t.ex. 4%, visa bara SLUT 4%").
  const hidePrel = pct >= 100 && slutligState !== 'preliminar'

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
    // Rad 2 får den SYNLIGA valtyp-etiketten + Live-pricken när rad 1 döljs (hidePrel) —
    // annars den osynliga platshållaren (bara för lodrät linjering mot rad 1:s etikett).
    const row2Label = hidePrel
      ? valtypProp && <span className="font-semibold uppercase tracking-wide text-slate-400">{valtypProp}</span>
      : valtypProp && <span aria-hidden className="font-semibold uppercase tracking-wide text-transparent">{valtypProp}</span>
    return (
      <div className="flex shrink-0 flex-col gap-0.5 text-sm text-slate-300">
        {!hidePrel && (
          <div className="flex items-center gap-1.5">
            {valtypProp && <span className="font-semibold uppercase tracking-wide text-slate-400">{valtypProp}</span>}
            <span className="tabular-nums">
              <span className="font-semibold text-slate-100">{reported.toLocaleString('sv-SE')}</span>
              <span className="text-slate-500"> / {total.toLocaleString('sv-SE')}</span>
              <span className="ml-1 text-sky-300">{pct}%</span>
              {uppRegistry.length > 0 && (
                <span className="ml-1 text-slate-500">
                  {upp.onlyUppLeft
                    ? `(endast ${upp.uppRemaining.toLocaleString('sv-SE')} uppsamling återstår)`
                    : `(varav ${uppRegistry.length.toLocaleString('sv-SE')} uppsamling)`}
                </span>
              )}
            </span>
            {liveDot}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {row2Label}
          <span className="tabular-nums">
            <span className="font-semibold text-slate-100">{store.slutligDoneCount.toLocaleString('sv-SE')}</span>
            <span className="text-slate-500"> / {store.reportedCount.toLocaleString('sv-SE')} slutgiltigt</span>
            <span className={`ml-1 ${SLUTLIG_PCT_TONE[slutligState]}`}>{slutligPct}%</span>
          </span>
          {hidePrel && liveDot}
        </div>
      </div>
    )
  }

  // Mobil (kompakt, `!large`): TVÅ badge+procent-par, SAMMA layout på båda ("Prel"/"Slut"
  // + en siffra) — Lars, local dev 14 sep: den tidigare ihoppressade "Z %"-badgen (utan
  // egen etikett) var inkonsekvent mot rapporteringstalets fulla "X / Y Z %"-format. Men
  // FULLA "X / Y Z %" på BÅDA (försökt först) klämde ut breadcrumb-områdesnamnet i
  // MobileChrome.tsx (samma rad, `flex-1 truncate` — "Hudiksvall" blev "H…") eftersom
  // raden delar utrymme med bredkrumen + "Hela Sverige"-knappen, till skillnad från
  // Dashboard-headerns EGEN, dedikerade rad (`large` ovan). Kompromiss: bara procenten
  // efter varje badge här — de fulla talen finns ändå i tooltipen (title på "Prel").
  return (
    <div className="flex shrink-0 items-center gap-1 text-[11px] text-slate-300">
      {valtypProp && <span className="font-semibold uppercase tracking-wide text-slate-400">{valtypProp}</span>}
      {/* "Prel"-badgen döljs vid 100 % + pågående sluträkning (hidePrel) — se samma
          resonemang i `large`-grenen ovan. */}
      {!hidePrel && (
        <>
          <span
            className={`${BADGE_BASE} bg-slate-700/50 text-slate-300`}
            title={`${reported.toLocaleString('sv-SE')} / ${total.toLocaleString('sv-SE')} rapporterade${
              upp.onlyUppLeft
                ? ` (endast ${upp.uppRemaining.toLocaleString('sv-SE')} uppsamlingsdistrikt återstår)`
                : uppRegistry.length > 0
                  ? ` (varav ${uppRegistry.length.toLocaleString('sv-SE')} uppsamlingsdistrikt)`
                  : ''
            }`}
          >
            Prel
          </span>
          <span className="tabular-nums text-sky-300">{pct}%</span>
        </>
      )}
      <span
        className={`${BADGE_BASE} ${SLUT_BADGE_TONE[slutligState]}`}
        title={`${store.slutligDoneCount.toLocaleString('sv-SE')} / ${store.reportedCount.toLocaleString('sv-SE')} slutgiltigt räknade`}
      >
        Slut
      </span>
      <span className={`tabular-nums ${SLUTLIG_PCT_TONE[slutligState]}`}>{slutligPct}%</span>
      {liveDot}
    </div>
  )
}
