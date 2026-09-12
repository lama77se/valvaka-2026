// Kartfärgläge-METRIK-väljaren (Största parti / Block / Parti-intensitet) — en EGEN,
// separat väljare bredvid ValtypSelectorns granularitets-toggle (Valdistrikt/Valkrets-
// Region-Kommun): ortogonalt val, inte ett alternativ inom samma grupp (se ColorScheme
// i lib/results för den fulla motiveringen). Bara desktop (samma plats som
// `showColorMode` i ValtypSelector) — mobilens smala toppchrome har inte plats.
//
// "Block" visas bara för RD (soffa.ts/RIKET_BLOCKS är en riksideologisk indelning, inte
// giltig för RF/KF:s styre-mot-opposition-begrepp) — ResultsProvider faller automatiskt
// tillbaka till "Största parti" om valtyp byts bort från RD medan Block är valt.
import { useResults } from '@/components/ResultsProvider'

export function ColorSchemeSelector({ className = '' }: { className?: string }) {
  const { valtyp, colorScheme, setColorScheme } = useResults()
  const showBlock = valtyp === 'RD'
  return (
    <div className={`flex overflow-hidden rounded-md border border-slate-700 bg-slate-900/90 text-sm shadow-lg mx-auto w-fit ${className}`}>
      <button
        type="button"
        onClick={() => setColorScheme('largest')}
        title="Färglägg efter störst parti"
        className={`px-3 py-1.5 font-medium transition-colors ${
          colorScheme === 'largest' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        Största parti
      </button>
      {showBlock && (
        <button
          type="button"
          onClick={() => setColorScheme('block')}
          title="Färglägg efter block (V+S+MP+C mot L+KD+M+SD) — en historisk/allmänt känd uppfattning, inte en officiell regel"
          className={`px-3 py-1.5 font-medium transition-colors ${
            colorScheme === 'block' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          Block
        </button>
      )}
      <button
        type="button"
        onClick={() => setColorScheme('party')}
        title="Färglägg efter ett valt partis röstandel (klicka ett parti i legenden)"
        className={`px-3 py-1.5 font-medium transition-colors ${
          colorScheme === 'party' ? 'bg-sky-500 text-white' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        Parti
      </button>
    </div>
  )
}
