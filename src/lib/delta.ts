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

// Kompakt variant för mobilens resultatremsa, där differensen står i en smal kolumn UNDER
// sitt värde. Tvåsiffriga svängningar är sällsynta och tappar sin decimal ("−12" i stället
// för "−12,4") — det håller differensen smalare än värdet ovanför i alla lägen, så
// jämförelseraden aldrig kan bli det som avgör hur många partier som får plats.
// Tröskeln testas på det AVRUNDADE värdet, annars skulle 9,96 bli "+10,0" (fem tecken).
export const formatDeltaCompact = (d: number | null) => {
  if (d == null) return '–'
  if (d === 0) return '±0'
  const abs = Math.round(Math.abs(d) * 10) / 10
  const tecken = d > 0 ? '+' : '−'
  return abs >= 10 ? `${tecken}${Math.round(abs)}` : `${tecken}${abs.toFixed(1).replace('.', ',')}`
}
