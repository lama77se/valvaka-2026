// genrep = generalrepetitionens testdata flödar; annars mellanläget efter en valnatts-
// cutover men innan Valmyndigheten publicerat något (source 'reset') — samma
// grenlogik/motivering som desktopens banner i DistrictMap.tsx.
//
// Delad mellan mobil (MobileChrome) och desktop Dashboard-läge (App.tsx) — extraherad
// härifrån (ursprungligen mobil-lokal) i samband med finalgranskningens fix-våg.
export function TestdataBanner({ genrep }: { genrep: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-[12px] font-semibold text-amber-200">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
      {genrep ? (
        <span>Generalrep · <span className="font-bold">testdata</span> — inte skarpa valresultat</span>
      ) : (
        <span><span className="font-bold">Väntar på valnatten</span> — inga resultat inrapporterade än</span>
      )}
    </div>
  )
}
