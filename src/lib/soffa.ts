// Ren geometri för riksdagssoffan (parliament-arc). Ingen React/JSX → testbar i
// verify-aggregate. MandatSoffa.tsx lägger pixel/paint ovanpå detta.

// Politisk vänster→höger-ordning för riksdagspartierna; okända (lokala) sist.
export const SPECTRUM = ['V', 'S', 'MP', 'C', 'L', 'KD', 'M', 'SD']
export const spectrumRank = (f: string | null): number => {
  const i = f ? SPECTRUM.indexOf(f) : -1
  return i === -1 ? SPECTRUM.length : i
}

export const SOFFA_INNER = 0.56 // innersta radiens andel av yttre
export const SOFFA_OUTER = 1
// Aldrig fler rader än mandat: annars kan avrundningsresten bli negativ medan varje
// rad redan står på 1 plats, och rest-fördelningen nedan snurrar oändligt.
export const rowsFor = (total: number): number =>
  Math.min(Math.max(1, total), Math.max(3, Math.round(Math.sqrt(total) / 1.6)))

// Positioner för exakt `total` platser i en övre halvcirkel, i ordning vänster→höger
// (x ∈ [-1,1], y ∈ [0,1]). Summan av platser per rad justeras till exakt `total`.
export function seatPositions(total: number): { x: number; y: number }[] {
  if (total <= 0) return []
  const rows = rowsFor(total)
  const radii: number[] = []
  for (let i = 0; i < rows; i++) radii.push(rows === 1 ? SOFFA_OUTER : SOFFA_INNER + (SOFFA_OUTER - SOFFA_INNER) * (i / (rows - 1)))
  const wSum = radii.reduce((a, b) => a + b, 0)
  const counts = radii.map((r) => Math.max(1, Math.round((total * r) / wSum)))
  let diff = total - counts.reduce((a, b) => a + b, 0) // fördela avrundningsrest på ytterraderna
  for (let i = rows - 1; diff !== 0; i = i - 1 < 0 ? rows - 1 : i - 1) {
    if (diff > 0) {
      counts[i]++
      diff--
    } else if (counts[i] > 1) {
      counts[i]--
      diff++
    }
  }
  const seats: { r: number; ang: number }[] = []
  for (let i = 0; i < rows; i++) {
    const n = counts[i]
    for (let k = 0; k < n; k++) {
      const ang = n === 1 ? Math.PI / 2 : Math.PI * (k / (n - 1)) // 0 = höger, π = vänster
      seats.push({ r: radii[i], ang })
    }
  }
  seats.sort((a, b) => b.ang - a.ang) // π (vänster) → 0 (höger)
  return seats.map((s) => ({ x: Math.cos(s.ang) * s.r, y: Math.sin(s.ang) * s.r }))
}
