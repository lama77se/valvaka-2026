// Valtyp-väljaren (Riksdag / Region / Kommun) som EN delad, presentationslös komponent.
// Styr providerns delade `valtyp` → alla vyer (karta, panel, tavlor) följer med. På
// desktop bor väljaren kvar som en overlay inne i kartan; på mobil lyfts den ut i den
// persistenta toppchromen (så den nås från alla flikar, inte bara Karta-fliken).
import { VALTYPER, VALTYP_LABEL } from '@/lib/results'
import { useResults } from '@/components/ResultsProvider'

export function ValtypSelector({ className = '', fill = false }: { className?: string; fill?: boolean }) {
  const { valtyp, setValtyp } = useResults()
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
    </div>
  )
}
