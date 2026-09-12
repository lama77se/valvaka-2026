// Regressionstest: RD:s valkretsnivå-mandat (aggregate.ts valkretsMandate, samma kärna som
// computeRdValkretsMandate anropar live) mot Valmyndighetens RIKTIGA 2022-facit, LÄST UR
// DEN RÅA rostfordelning-JSON:en — till skillnad från scripts/verify-mandate-leveling.ts,
// som testar samma placerings-algoritm men mot en REDAN AGGREGERAD Valmyndighets-xlsx
// (roster-rd-2022.xlsx) där uppsamlingsdistriktens röster redan är osynligt inbakade i sin
// valkrets. Den filen bevisar ALGORITMEN (232/232 exakt) men testar aldrig den faktiska
// LIVE-koden, som bygger votesByConstituency ur `district`-tabellen (utesluter uppsamlings-
// distrikt helt, ingen FK/geometri för dem) — se aggregate.ts UppsamlingBuckets-docstring.
//
// Källa: samma live 2022-resultatarkiv som RF/KF-skriptet (resultat.val.se/resultatfiler/
// val2022/s/rd/…), nedladdat en gång manuellt till scratch (7,8 MB zip):
//   data/raw/mandat2022/val2022-rd/00.zip
//
//   npx tsx scripts/verify-mandate-leveling-rd-uppsamling.ts
//
// Resultat (12 sep): ALLA 314 RD-uppsamlingsdistrikt i slutlig-filen har kretskod (220 640
// röster, ~3,4 % av riket — inte alls "ingen valkrets-nyckel", som tidigare antaget). UTAN
// kretskod-attribuering (tidigare live-beteende, uppsamling alltid organ-vitt/extraVotes):
// 161/166 (valkrets,parti)-par exakt — Stockholm/Östergötland/Skåne västra/VG västra fel.
// MED (nuvarande kod): 166/166 exakt.
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { valkretsMandate } from '../src/lib/aggregate.ts'
import type { ConstituencyVotes, PartyVotes } from '../src/lib/mandate.ts'

interface RostVd {
  valdistriktskod: string
  valdistriktstyp?: string
  kretskod?: string
  rostfordelning?: { rosterPaverkaMandat?: { partiRoster?: { partikod: string; antalRoster: number }[] } }
}
interface RostFile { valdistrikt: RostVd[] }
interface PartiMandat { partikod: string; antalMandat: number; antalFastaMandat: number }
interface ValkretsEntry { namnValkrets: string; kod: string; mandatfordelning?: { partiLista: PartiMandat[] } | null }
interface MandatFile { valomrade: { valkretsLista?: ValkretsEntry[] | null } }

const zipPath = 'data/raw/mandat2022/val2022-rd/00.zip'
const unz = unzipSync(new Uint8Array(readFileSync(zipPath)))
const names = Object.keys(unz)
const dec = new TextDecoder()
const rost: RostFile = JSON.parse(dec.decode(unz[names.find((n) => /rostfordelning.*\.json$/i.test(n))!]))
const mandat: MandatFile = JSON.parse(dec.decode(unz[names.find((n) => /mandatfordelning.*\.json$/i.test(n))!]))

// Samma "kolla kretskod FÖRST, oavsett valdistriktstyp"-princip som RF/KF-skriptet — normala
// distrikt har alltid sin egen valkrets som kretskod (no-op mot att aggregera geografiskt),
// uppsamlingsdistrikt bara NÄR Valmyndigheten löst dem (bekräftat: samtliga 314 i denna fil).
function buildVotes(attributeUppsamling: boolean): { byVk: ConstituencyVotes; extra: PartyVotes } {
  const byVk: ConstituencyVotes = {}
  const extra: PartyVotes = {}
  for (const vd of rost.valdistrikt) {
    const pr = vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []
    const isUpp = vd.valdistriktstyp === 'uppsamlingsdistrikt'
    if ((isUpp && !attributeUppsamling) || !vd.kretskod) {
      for (const p of pr) extra[p.partikod] = (extra[p.partikod] ?? 0) + p.antalRoster
      continue
    }
    const pv = byVk[vd.kretskod] ?? (byVk[vd.kretskod] = {})
    for (const p of pr) pv[p.partikod] = (pv[p.partikod] ?? 0) + p.antalRoster
  }
  return { byVk, extra }
}

const fixedSeatsByConstituency: Record<string, number> = {}
for (const vk of mandat.valomrade.valkretsLista ?? []) {
  fixedSeatsByConstituency[vk.kod] = vk.mandatfordelning!.partiLista.reduce((a, p) => a + p.antalFastaMandat, 0)
}
const totalFixed = Object.values(fixedSeatsByConstituency).reduce((a, b) => a + b, 0)

function runTest(label: string, attributeUppsamling: boolean): boolean {
  const { byVk: votesByConstituency, extra } = buildVotes(attributeUppsamling)
  let checkedPairs = 0
  let wrong = 0
  const wrongDetails: string[] = []
  for (const vk of mandat.valomrade.valkretsLista ?? []) {
    const ours = valkretsMandate(votesByConstituency, fixedSeatsByConstituency, vk.kod, 349, 0.04, 0.12, extra)
    for (const p of vk.mandatfordelning!.partiLista) {
      checkedPairs++
      const got = ours?.seatsByParty[p.partikod] ?? 0
      if (got !== p.antalMandat) {
        wrong++
        wrongDetails.push(`${vk.namnValkrets}/${p.partikod}: ours=${got} facit=${p.antalMandat}`)
      }
    }
  }
  console.log(`\n--- ${label} ---`)
  console.log(`${checkedPairs - wrong}/${checkedPairs} (valkrets,parti) matchar exakt`)
  if (wrong > 0) console.log(wrongDetails.join('\n'))
  return wrong === 0
}

console.log('total fasta (facit):', totalFixed, '(förväntat 310)')
runTest('UTAN kretskod-attribuering (tidigare live-beteende, dokumenterar bara gapet)', false)
const fixedOk = runTest('MED kretskod-attribuering (nuvarande kod)', true) && totalFixed === 310

console.log(fixedOk ? '\n✅ MED kretskod-attribuering matchar facit EXAKT' : '\n❌ se FEL ovan — även med attribuering')
process.exit(fixedOk ? 0 : 1)
