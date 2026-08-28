// Bottom-nav för mobil: Karta / Resultat / Tavlor. Under flikinnehållet och över
// browser-chromen (tumvänligt enhandsgrepp). Träffytor ≥ 44 px; safe-area-padding så
// hemknapps-indikatorn (iOS) inte täcker raden.
export type Tab = 'karta' | 'resultat' | 'senaste'

type Item = { id: Tab; label: string; icon: React.ReactNode }

const MapIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3ZM9 3v15M15 6v15" />
  </svg>
)
const ResultIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18M8 17V9M13 17V5M18 17v-6" />
  </svg>
)
const BoardIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" />
  </svg>
)

const ITEMS: Item[] = [
  { id: 'karta', label: 'Karta', icon: MapIcon },
  { id: 'resultat', label: 'Resultat', icon: ResultIcon },
  { id: 'senaste', label: 'Senaste', icon: BoardIcon },
]

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav
      className="flex shrink-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {ITEMS.map((it) => {
        const activeTab = tab === it.id
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-current={activeTab ? 'page' : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
              activeTab ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
