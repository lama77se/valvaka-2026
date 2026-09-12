// Persistent toppchrome för mobil-layouten. Äger det som måste finnas kvar OVANFÖR
// flikarna så orienteringen aldrig tappas vid flikbyte:
//   • testdata-banner (genrep vs skarpt) — samma data-styrning som desktop.
//   • valtyp-väljaren (Riksdag/Region/Kommun) — styr ALLA flikar, får inte bo i en flik.
//   • områdesrad — visar valt område + snabb återställning till valtypens toppnivå;
//     tapp öppnar Resultat-fliken (där drill-down-listan bor). Full väljare = fas 2.
//   • kompakt rapporteringsstatus (X av Y · %) + live-indikator.
import { useResults, defaultAreaFor } from '@/components/ResultsProvider'
import { ValtypSelector } from '@/components/ValtypSelector'
import { TestdataBanner } from '@/components/TestdataBanner'
import { InfoButton } from '@/components/InfoButton'
import { ReportingStatus } from '@/components/ReportingStatus'
import { GROUP_LEVEL_LABEL, VALTYP_LABEL } from '@/lib/results'

// Kartfärgläget (se ColorMode/ValtypSelector showColorMode) på mobil: samma två lägen
// som desktop-ramen, men ingen plats för två extra knappar i den smala fill-raden →
// en enda liten ikon-knapp som VÄXLAR läge vid tryck (bara två lägen finns, så en
// toggle räcker — ingen meny behövs). Highlightas när "grupp" är aktivt.
function ColorModeToggle() {
  const { valtyp, colorMode, setColorMode } = useResults()
  const grouped = colorMode === 'grupp'
  return (
    <button
      type="button"
      onClick={() => setColorMode(grouped ? 'distrikt' : 'grupp')}
      aria-label={grouped ? `Färglagd per ${GROUP_LEVEL_LABEL[valtyp]} — tryck för valdistrikt` : `Färglagd per valdistrikt — tryck för ${GROUP_LEVEL_LABEL[valtyp]}`}
      title={grouped ? `Kartan är färglagd per ${GROUP_LEVEL_LABEL[valtyp].toLowerCase()} — tryck för valdistrikt` : `Kartan är färglagd per valdistrikt — tryck för ${GROUP_LEVEL_LABEL[valtyp].toLowerCase()}`}
      className={`flex shrink-0 items-center justify-center rounded-md border p-2 ${
        grouped ? 'border-sky-500 bg-sky-500/20 text-sky-300' : 'border-slate-700 bg-slate-900/90 text-slate-300'
      }`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 2 8.5 5-8.5 5-8.5-5L12 2Z" />
        <path d="m3.5 12 8.5 5 8.5-5" />
        <path d="m3.5 17 8.5 5 8.5-5" />
      </svg>
    </button>
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
      {dataset?.test && <TestdataBanner genrep={dataset.source === 'genrep2026'} />}
      <div className="flex items-center gap-1.5 px-3 pt-2">
        <ValtypSelector fill />
        <ColorModeToggle />
        <InfoButton />
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
