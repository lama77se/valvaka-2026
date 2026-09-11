import { useEffect } from 'react'

// Mobil-skalets plats i rutan — mätt rektangel, inte `100dvh` i det vanliga flödet.
//
// Problemet: `100dvh` (och allt annat som layoutas i dokumentflödet) förhåller sig till
// LAYOUT-viewporten, som på iOS Safari/Android Chrome är den STORA viewporten — den som
// gäller när browser-chromen är hopfälld. Det synliga fältet (visual viewport) är mindre
// och kan dessutom ligga FÖRSKJUTET inuti layout-viewporten: när en flik kommer tillbaka
// efter en stund (flikväxlaren, bfcache/`pageshow`, en flik som Safari slängt och laddar
// om i bakgrunden) landar sidan ibland nedskrollad i den slacken. Då hamnar headern ovanför
// det synliga fältet — bara resultatremsan syns — och bottom-nav:en ser ut att sitta för
// högt, med browser-chromen under. Nästa layout (rotation, tangentbord, en till scroll)
// rättar det av sig självt — därav "ibland fel, ofta rätt".
//
// Lösningen: lägg skalet `position: fixed` och PINNA det på den uppmätta visual
// viewport-rektangeln — `--app-top` (förskjutningen) och `--app-height` (höjden). Fixed
// utgår från layout-viewporten, så `top: var(--app-top)` placerar skalets överkant exakt
// vid det synligas överkant oavsett hur browsern råkat scrolla eller layouta. Vi mäter om
// vid alla lägen där det kan ha glidit, plus en kort serie efterskott — iOS rapporterar
// färdiga värden först när chrome-animationen landat, och en återställd flik hinner ofta
// visas innan något event alls kommer.
type Rect = { top: number; height: number }

function measure(): Rect {
  const vv = window.visualViewport
  // visualViewport är sanningen om vad som syns, men krymper och förskjuts vid pinch-zoom
  // (scale > 1). Zoomat läge → fall tillbaka på layout-viewporten så skalet varken klipps
  // eller slåss med användarens panorering.
  const zoomed = vv != null && Math.abs(vv.scale - 1) > 0.01
  if (vv == null || zoomed) return { top: 0, height: Math.round(window.innerHeight) }
  return { top: Math.round(vv.offsetTop), height: Math.round(vv.height) }
}

// Efterskott (ms) efter varje läge där browsern kan ha layoutat mot fel viewport. Serien
// täcker både snabba fall (chrome-animationen ~300 ms) och en flik som renderas i
// bakgrunden och visas först en bit senare. Svansen förlängd (11 sep, verifierad-i-fält
// bugg): en flik Safari kastat ur minnet och laddar om från grunden (inte bfcache-`pageshow`,
// en RIKTIG remount) kan hålla `visualViewport` på ett övergångsvärde märkbart längre än
// ~1,5 s medan iOS fortfarande återställer sin egen scrollposition/chrome-animation — synligt
// som headern förskjuten ovanför bild + ett vitt fält under bottom-nav:en tills nästa
// touch/scroll råkar trigga en ommätning. Extra sena kontroller kostar inget (samma
// tröga `apply()`, no-op om inget ändrats) men täcker det långsamma fallet automatiskt
// i stället för att vänta på att användaren råkar röra skärmen.
const SETTLE_MS = [120, 320, 700, 1500, 2500, 4000, 6000, 9000]

// Låser även dokumentscrollen medan skalet är monterat: skalet fyller exakt det synliga
// fältet, så all scroll hör hemma inuti flikarna. Utan låset kan en gummibands-drag skjuta
// runt sidan i slacken ovan, och pull-to-refresh laddar om appen mitt i valnatten.
export function useAppHeight() {
  useEffect(() => {
    const root = document.documentElement
    // Jämför mot det som FAKTISKT står i DOM:en, inte mot ett cachat senaste-värde: annars
    // kan variablerna och vår bokföring glida isär (extern skrivning, ett halvt kasserat
    // effect-par i StrictMode) och då rättas geometrin aldrig igen — precis det fastlåsta
    // läget den här hooken finns för att bryta.
    const setVar = (name: string, px: number) => {
      if (root.style.getPropertyValue(name) === `${px}px`) return
      root.style.setProperty(name, `${px}px`)
    }
    const apply = () => {
      const { top, height } = measure()
      if (height <= 0) return
      setVar('--app-top', top)
      setVar('--app-height', height)
    }

    let raf = 0
    let timers: number[] = []
    const applySoon = () => {
      apply()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
      timers.forEach(clearTimeout)
      timers = SETTLE_MS.map((ms) => window.setTimeout(apply, ms))
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') applySoon()
    }

    root.classList.add('app-locked')
    applySoon()

    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', applySoon)
    window.addEventListener('pageshow', applySoon)
    window.addEventListener('focus', applySoon)
    // Sista skyddsnätet: en flik som Safari laddat om i bakgrunden kan visas utan att
    // något av ovanstående event kommer. Första beröringen rättar då till geometrin.
    window.addEventListener('touchstart', apply, { passive: true })
    // `window`-scroll (utöver visualViewport-scroll ovan): täcker "nedskrollad i slacken"-
    // fallet innan `app-locked` hunnit låsa dokumentscrollen (t.ex. mitt i en bakgrundsomladdning).
    window.addEventListener('scroll', apply, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.visualViewport?.addEventListener('resize', apply)
    window.visualViewport?.addEventListener('scroll', apply)

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', applySoon)
      window.removeEventListener('pageshow', applySoon)
      window.removeEventListener('focus', applySoon)
      window.removeEventListener('touchstart', apply)
      window.removeEventListener('scroll', apply)
      document.removeEventListener('visibilitychange', onVisibility)
      window.visualViewport?.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('scroll', apply)
      root.classList.remove('app-locked')
      root.style.removeProperty('--app-top')
      root.style.removeProperty('--app-height')
    }
  }, [])
}
