// ±-differens mot förra valet — EN källa för både resultattabellen och mobilens
// resultatremsa, så siffra och färg alltid betyder samma sak i hela appen.
//
// Format: "+0,4" / "−0,2" (äkta minustecken U+2212, samma bredd som plus i tabellsiffror)
// / "±0,0" när det står stilla / "–" när jämförelsen saknas (nytt parti, ojämförbart).
export const formatDelta = (d: number | null) =>
  d == null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(1).replace('.', ',')}`

// Heltalsvariant (mandat): "±0" i stället för "±0,0".
export const formatDeltaInt = (d: number | null) => (d == null ? '–' : d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`)

// Grönt när partiet växer, rött när det backar, dämpat när det står stilla eller
// saknar jämförelse. Noll är medvetet neutralt, inte grönt.
export const deltaColor = (d: number | null) =>
  d == null || d === 0 ? 'text-slate-500' : d > 0 ? 'text-emerald-400' : 'text-rose-400'
