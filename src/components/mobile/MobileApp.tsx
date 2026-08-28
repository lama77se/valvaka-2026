// Mobil-layout (< 820 px): persistent chrome → flikinnehåll → bottom-nav. Flikarna
// (Karta/Resultat/Tavlor) är tre vyer mot providerns delade store, precis som desktop —
// flikbyte är därför gratis och behåller valtyp + valt område.
//
// Fas 1 återanvänder befintliga komponenter i fullbredd; touch-anpassning (tapp→sheet på
// kartan, tabell-reflow) och mobil-datalast är fas 2–3.
import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { DistrictMap } from '@/components/DistrictMap'
import { ResultPanel } from '@/components/ResultPanel'
import { DepartureBoard } from '@/components/DepartureBoard'
import { VALTYPER } from '@/lib/results'
import { MobileChrome } from './MobileChrome'
import { BottomNav, type Tab } from './BottomNav'

// Fliken lever i URL:ens hash (providern äger query-strängen och skriver om den vid
// valtyp/områdesbyte — hash lämnas orörd, så de två synkarna krockar aldrig). Delbar
// djuplänk: ?val=KF&omrade=kommun:1488#resultat.
function readTabFromHash(): Tab {
  if (typeof window === 'undefined') return 'karta'
  const h = window.location.hash.replace(/^#/, '')
  return h === 'resultat' || h === 'senaste' ? h : 'karta'
}

export function MobileApp() {
  const [tab, setTab] = useState<Tab>(readTabFromHash)

  // Kartan monteras först när Karta-fliken öppnats (en besökare som bara tittar på
  // Resultat/Tavlor betalar aldrig för 6 MB geometri + WebGL-kontext). Sen hålls den
  // monterad men döljs med `hidden` — unmount skulle re-tessellera 6 MB vid varje retur.
  const [mapMounted, setMapMounted] = useState(() => readTabFromHash() === 'karta')
  useEffect(() => {
    if (tab === 'karta') setMapMounted(true)
  }, [tab])

  useEffect(() => {
    const base = window.location.pathname + window.location.search
    window.history.replaceState(null, '', tab === 'karta' ? base : `${base}#${tab}`)
  }, [tab])

  return (
    <div className="flex h-[100dvh] flex-col bg-[#0b1020] text-slate-100">
      <MobileChrome onOpenArea={() => setTab('resultat')} />
      <main className="relative min-h-0 flex-1">
        {mapMounted && (
          <div className={`mobile-map absolute inset-0 ${tab === 'karta' ? '' : 'hidden'}`}>
            <DistrictMap variant="mobile" active={tab === 'karta'} onOpenResult={() => setTab('resultat')} />
          </div>
        )}
        {tab === 'resultat' && (
          <div className="absolute inset-0 overflow-y-auto bg-slate-950/95 p-3">
            <ResultPanel />
          </div>
        )}
        {tab === 'senaste' && (
          // Alla tre tavlorna (RD/RF/KF) som på desktop, i en flex-kolumn som fyller höjden:
          // varje tavla (fill) tar en tredjedel, i full skärmbredd (fullWidth).
          <div className="absolute inset-0 flex flex-col gap-3 p-3">
            {VALTYPER.map((vt) => (
              <DepartureBoard key={vt} valtyp={vt} fill fullWidth onRowSelect={() => setTab('resultat')} />
            ))}
          </div>
        )}
      </main>
      <BottomNav tab={tab} onChange={setTab} />
      <Analytics />
    </div>
  )
}
