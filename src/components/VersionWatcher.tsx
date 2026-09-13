// Klientdetektering av ny deploy (kodversion) + reload — handover Val ANALYSIS. Detta är
// en PARALLELL, separat mekanism mot ResultsProvider.tsx:s generationsvakt (som bevakar
// DATASETETS identitet, dataset_meta — inte kodversionen). Rör inte den.
//
// INTE PWA/service worker: valdes bort medvetet (ny dependency, manifest, workbox-
// precache, offline-cachingrisk) — Valvaka behöver bara UX-beteendet "ny version →
// ladda om", fristående utan service worker. dist/version.json genereras vid varje
// build (vite.config.ts, writeVersionFile) med Vercels VERCEL_GIT_COMMIT_SHA.
//
// Samma idiom som den befintliga poll-/generationsvakts-loopen i ResultsProvider.tsx för
// JITTER och CACHE-BYPASS. EN skillnad, medveten: den loopen stryper pump() till synliga
// flikar (sparar Supabase-anrop) — den här pollar version.json OAVSETT synlighet (en
// ynka statisk JSON-fil kostar i praktiken inget), eftersom en flik i BAKGRUNDEN annars
// aldrig skulle upptäcka en ny version förrän användaren råkar återvända till den (se
// fall a nedan — poängen är att den ska hinna självläka INNAN dess, tyst).
// document.visibilityState AVGÖR i stället vad som händer VID en upptäckt mismatch
// (bannera kontra ladda om direkt), inte OM pollningen alls sker.
//
// VARFÖR bakgrund/synlighet-uppdelning + grace-period (inte ren tyst auto-reload för
// alla, inte bara en passiv banner): flera deploys väntas ikväll (rutinfunktioner, inte
// bara akuta fixar) — att rycka undan varje flik direkt vore för aggressivt. En ren
// passiv banner utan auto-apply räcker inte heller — en ouppmärksam/icke-teknisk
// besökare skulle aldrig märka/klicka den, och en riktig hotfix skulle då inte nå de
// som redan sitter med det trasiga läget. Kompromissen: en flik i BAKGRUNDEN just nu
// laddar om direkt (jittrat) — ingen stör en aktiv session. En SYNLIG flik får en
// banner + grace-period (auto-tillämpas ändå om ingen reagerar) — man hinner slutföra
// det man gör, men konvergerar ändå mot senaste versionen inom rimlig tid.
import { useEffect, useRef, useState } from 'react'

const POLL_MIN_MS = 45_000
const POLL_MAX_MS = 75_000
// Hur länge en SYNLIG flik får se bannern innan den auto-tillämpas ändå (samma
// jittrade reload som bakgrundsfallet) — se filkommentaren ovan för avvägningen.
const GRACE_MS = 90_000

export function VersionWatcher() {
  const [showBanner, setShowBanner] = useState(false)
  const baselineRef = useRef<string | null>(null)
  // En mismatch är upptäckt (bannern visas ELLER en bakgrunds-reload väntar) — skiljs
  // från appliedRef: pending kan vara sant en stund INNAN reload faktiskt schemaläggs
  // (grace-perioden), medan applied betyder "redan schemalagd, gör det aldrig igen".
  const pendingRef = useRef(false)
  const appliedRef = useRef(false)

  const applyReload = () => {
    if (appliedRef.current) return
    appliedRef.current = true
    // Samma jitter (0–10 s) som ResultsProvider.tsx:s generationsvakt — undviker en
    // synkron reconnect-storm mot Supabase om många flikar uppdaterar samtidigt.
    setTimeout(() => window.location.reload(), Math.random() * 10_000)
  }

  useEffect(() => {
    const checkVersion = async () => {
      if (pendingRef.current) return // redan upptäckt — inget mer att göra förrän reload
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { v?: unknown }
        const v = typeof data.v === 'string' ? data.v : null
        if (!v) return
        if (baselineRef.current === null) {
          baselineRef.current = v // baslinje vid mount — ingen "mismatch" första gången
          return
        }
        if (v === baselineRef.current) return
        pendingRef.current = true
        console.warn('[valvaka] ny version upptäckt', baselineRef.current, '→', v)
        if (document.visibilityState === 'visible') setShowBanner(true)
        else applyReload()
      } catch {
        // Tyst — ett nätverksglapp (offline-blip, CDN-hicka) ska inte krascha/spamma
        // konsolen. Nästa jittrade poll försöker igen.
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      timer = setTimeout(() => {
        void checkVersion() // pollar OAVSETT synlighet — se filkommentaren ovan
        schedule() // jittra nästa varv
      }, POLL_MIN_MS + Math.random() * (POLL_MAX_MS - POLL_MIN_MS))
    }
    void checkVersion() // baslinje direkt vid mount
    schedule()

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkVersion() // snappa färskt vid tab-fokus, som resync-loopen
      } else if (pendingRef.current) {
        // Fliken döljs MEDAN en uppdatering redan väntar (bannern visades men användaren
        // klickade inte) — tillämpa direkt, samma regel som "flik i bakgrunden".
        applyReload()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (!showBanner) return
    const t = setTimeout(applyReload, GRACE_MS)
    return () => clearTimeout(t)
  }, [showBanner])

  if (!showBanner) return null

  return (
    // bottom-20 (inte bottom-4): kartans zoom-kontroller (MapLibre NavigationControl,
    // 'bottom-right', ~76px höga) sitter i botten av kartans EGEN yta — som pga.
    // sidopanelerna inte är samma sak som fönstrets mitt/högerkant. En centrerad banner
    // i HELA fönstret (denna komponent lever utanför DistrictMap, ingen tillgång till
    // dess panel-bredd-CSS-variabler för exakt matchande centrering) hamnade annars
    // delvis bakom kontrollerna vid vanliga skrivbordsbredder — verifierat i Playwright.
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-sky-500/50 bg-sky-500/15 px-4 py-2.5 text-sm font-medium text-sky-100 shadow-lg backdrop-blur">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        <span>Ny version tillgänglig</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-400"
        >
          Ladda om
        </button>
      </div>
    </div>
  )
}
