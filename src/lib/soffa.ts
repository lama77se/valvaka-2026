// Politisk vänster→höger-ordning för riksdagspartierna; okända (lokala) sist.
// Driver spektrumsorteringen av segmenten i MandatBars/resultatpanelen.
export const SPECTRUM = ['V', 'S', 'MP', 'C', 'L', 'KD', 'M', 'SD']
export const spectrumRank = (f: string | null): number => {
  const i = f ? SPECTRUM.indexOf(f) : -1
  return i === -1 ? SPECTRUM.length : i
}

// Tvåblocksvyn i MandatBars (röstandel + mandat mot varandra, majoritetsmarkör) — samma
// komponent driver BÅDE riksblocken (ideologisk, V+S+MP+C mot L+KD+M+SD) och per-region-
// styret (sittande majoritet mot opposition, se `regionBlocks.ts`). `note` är en
// disclaimer som visas som (i)-tooltip: indelningen är i BÅDA fallen en kuraterad
// uppfattning (historisk/allmänt känd), INTE en officiell regel eller en prognos för
// utfallet av 2026 års val.
export interface PartyBlock {
  label: string
  // 'rest' = inte en uttrycklig partilista utan ALLT SOM BLIR ÖVER när det andra blockets
  // summa dras från totalen (giltiga röster/mandat) — så inget parti (t.ex. ett som
  // oväntat tar sig över spärren) "försvinner" mellan rutorna. Används för region-vyns
  // opposition (nuvarande styre är den uttryckliga listan; resten är allt annat).
  parties: string[] | 'rest'
}
export interface BlockConfig {
  a: PartyBlock
  b: PartyBlock
  note: string
}

export const RIKET_BLOCKS: BlockConfig = {
  a: { label: 'V+S+MP+C', parties: ['V', 'S', 'MP', 'C'] },
  b: { label: 'L+KD+M+SD', parties: ['L', 'KD', 'M', 'SD'] },
  note: 'Blockindelningen bygger på en historisk/allmänt känd uppfattning om vilka partier som samarbetar om regeringsmakten — inte en officiell regel, och den kan ändras.',
}

// Delade hjälpare för "sittande styre mot opposition"-configerna (regionBlocks.ts,
// kommunBlocks.ts) — INTE för riksblocken ovan, som är ideologiska och symmetriska.
// "NUV." markerar tydligt att indelningen gäller DAGSLÄGET (2022–2026), inte ett resultat
// av eller en prognos för 2026 års val.
export const STYRE_NOTE =
  'Uppdelningen visar det sittande styret (från perioden 2022–2026) mot oppositionen — en historisk uppfattning om vem som haft makten, inte en officiell regel eller en prognos för 2026 års val.'

export const styre = (label: string, parties: string[]): PartyBlock => ({ label: `NUV.STYRE (${label})`, parties })
export const rest = (): PartyBlock => ({ label: 'NUV.OPPOSITION', parties: 'rest' })
