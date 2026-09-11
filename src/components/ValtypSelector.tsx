// Valtyp-väljaren (Riksdag / Region / Kommun) som EN delad, presentationslös komponent.
// Styr providerns delade `valtyp` → alla vyer (karta, panel, tavlor) följer med. På
// desktop bor väljaren kvar som en overlay inne i kartan; på mobil lyfts den ut i den
// persistenta toppchromen (så den nås från alla flikar, inte bara Karta-fliken).
import { GROUP_LEVEL_LABEL, VALTYPER, VALTYP_LABEL } from '@/lib/results'
import { useResults } from '@/components/ResultsProvider'

// `showColorMode` lägger till Valdistrikt/Valkrets-Region-Kommun-läget i SAMMA ram —
// bara på desktop (kartöverlägget); mobilens smala toppchrome (fill) har inte plats
// och behåller bara valtyp-knapparna.
export function ValtypSelector({ className = '', fill = false, showColorMode = false }: { className?: string; fill?: boolean; showColorMode?: boolean }) {
  const { valtyp, setValtyp, colorMode, setColorMode } = useResults()
  return (
    <div className={`flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-sm shadow-lg ${fill ? 'w-full' : 'mx-auto w-fit'} ${className}`}>
      {VALTYPER.map((vt) => (
        <button
          key={vt}
          type="button"
          onClick={() => setValtyp(vt)}
          className={`${fill ? 'flex-1' : ''} px-4 py-1.5 font-medium transition-colors ${
            vt === valtyp ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          {VALTYP_LABEL[vt]}
        </button>
      ))}
      {showColorMode && (
        <>
          {/* Tydligare "det här är en egen, kombinerbar grupp"-signal än bara en tunn
              delare: full-höjd delare + en liten dämpad lager-ikon (samma motiv som
              mobilens färgläges-knapp) — annars kan fem knappar i rad läsas som EN
              platt lista i stället för val × färgläge. Ingen egen ram → bryter inte
              den enhetliga piller-strukturen. */}
          <div className="w-px self-stretch bg-slate-600" aria-hidden="true" />
          <span className="flex shrink-0 items-center pl-2 pr-0.5 text-slate-500" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 2 8.5 5-8.5 5-8.5-5L12 2Z" />
              <path d="m3.5 12 8.5 5 8.5-5" />
              <path d="m3.5 17 8.5 5 8.5-5" />
            </svg>
          </span>
          <button
            type="button"
            onClick={() => setColorMode('distrikt')}
            title="Färglägg varje valdistrikt efter sin egen vinnare"
            className={`px-3 py-1.5 font-medium transition-colors ${
              colorMode === 'distrikt' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Valdistrikt
          </button>
          <button
            type="button"
            onClick={() => setColorMode('grupp')}
            title={`Färglägg efter ${GROUP_LEVEL_LABEL[valtyp].toLowerCase()}ens sammanlagda vinnare, oavsett enskilda valdistrikt`}
            className={`px-3 py-1.5 font-medium transition-colors ${
              colorMode === 'grupp' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {GROUP_LEVEL_LABEL[valtyp]}
          </button>
        </>
      )}
    </div>
  )
}
