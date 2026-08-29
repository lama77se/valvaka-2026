// Politisk vänster→höger-ordning för riksdagspartierna; okända (lokala) sist.
// Driver spektrumsorteringen av segmenten i MandatBars/resultatpanelen.
export const SPECTRUM = ['V', 'S', 'MP', 'C', 'L', 'KD', 'M', 'SD']
export const spectrumRank = (f: string | null): number => {
  const i = f ? SPECTRUM.indexOf(f) : -1
  return i === -1 ? SPECTRUM.length : i
}
