import { useEffect } from 'react'

// Mobil-skalets höjd — mätt, inte enbart `100dvh`.
//
// Problemet: `100dvh` layoutas mot den viewport browsern TROR gäller vid layouttillfället.
// När fliken kommer tillbaka ur bakgrunden (flikväxlaren, bfcache/`pageshow`, ny flik som
// öppnats i bakgrunden och renderats innan den visades) hinner iOS Safari/Android Chrome
// layouta med den STORA viewporten — som om adressfältet vore hopfällt — trots att chromen
// faktiskt syns. Skalet blir då högre än det synliga fältet och bottom-nav:en trycks ner
// under browser-chromen. Nästa gång något råkar trigga en ny layout (rotation, scroll,
// tangentbord) rättar det till sig av sig självt — därav "ibland fel, ofta rätt".
//
// Lösningen: mät den faktiskt synliga höjden och skriv den till `--app-height`, som
// `.mobile-shell` använder (med `100dvh` som fallback innan JS hunnit köra). Vi mäter om
// vid alla lägen där browsern kan ha layoutat mot fel viewport, och en gång till efter en
// frame + ~300 ms eftersom iOS rapporterar färdiga värden först när chrome-animationen
// landat.
function measure(): number {
  const vv = window.visualViewport
  // visualViewport är sanningen om vad som syns, men krymper vid pinch-zoom (scale > 1).
  // Zoomat läge → fall tillbaka på layout-viewporten så skalet inte klipps.
  const zoomed = vv != null && Math.abs(vv.scale - 1) > 0.01
  const h = vv != null && !zoomed ? vv.height : window.innerHeight
  return Math.round(h)
}

// Låser även dokumentscrollen medan skalet är monterat: skalet fyller exakt viewporten,
// så all scroll hör hemma inuti flikarna. Utan låset kan en gummibands-drag (eller en
// felmätning) skjuta upp headern/nav:en ur bild, och pull-to-refresh laddar om appen mitt
// i valnatten.
export function useAppHeight() {
  useEffect(() => {
    const root = document.documentElement
    // Jämför mot det som FAKTISKT står i DOM:en, inte mot ett cachat senaste-värde: annars
    // kan variabeln och vår bokföring glida isär (extern skrivning, ett halvt kasserat
    // effect-par i StrictMode) och då rättas höjden aldrig igen — precis det fastlåsta
    // läget den här hooken finns för att bryta.
    const apply = () => {
      const h = measure()
      if (h <= 0) return
      if (root.style.getPropertyValue('--app-height') === `${h}px`) return
      root.style.setProperty('--app-height', `${h}px`)
    }

    // Andra passet: iOS ger stabila värden först när toolbar-/rotationsanimationen är klar.
    let raf = 0
    let timer = 0
    const applySoon = () => {
      apply()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
      clearTimeout(timer)
      timer = window.setTimeout(apply, 300)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') applySoon()
    }

    root.classList.add('app-locked')
    applySoon()

    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', applySoon)
    window.addEventListener('pageshow', applySoon)
    document.addEventListener('visibilitychange', onVisibility)
    window.visualViewport?.addEventListener('resize', apply)
    window.visualViewport?.addEventListener('scroll', apply)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', applySoon)
      window.removeEventListener('pageshow', applySoon)
      document.removeEventListener('visibilitychange', onVisibility)
      window.visualViewport?.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('scroll', apply)
      root.classList.remove('app-locked')
      root.style.removeProperty('--app-height')
    }
  }, [])
}
