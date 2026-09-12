// Källhänvisning + mandat-disclaimer, delad mellan desktop (info-kortet i vänsterspalten,
// se App.tsx) och mobil (info-knappen i MobileChrome). Valmyndighetens användarvillkor
// kräver att källan anges oavsett viewport — en delad komponent förhindrar textdrift.
export function AttributionInfo() {
  return (
    <>
      <p
        className="text-[11px] text-slate-500"
        title="All data är fri att använda, förutsatt att du anger Valmyndigheten som källa. Publiceras vartefter uppgifterna blir tillgängliga och datafilerna sammanställts."
      >
        Data från <span className="font-medium text-slate-400">Valmyndigheten</span>
      </p>
      {/* Mandat räknas fram av OSS (jämkade uddatalsmetoden på inkomna röster) — inte en
          siffra Valmyndigheten själva publicerar under natten. Tydliggör det direkt under
          källhänvisningen så det inte läses som officiellt. */}
      <p className="mt-1 text-[11px] text-slate-500">
        Mandatfördelning är matematiskt beräknad — för slutgiltig fördelning, se{' '}
        <a
          href="https://www.val.se"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto underline decoration-slate-600 hover:text-slate-300"
        >
          val.se
        </a>
        .
      </p>
    </>
  )
}
