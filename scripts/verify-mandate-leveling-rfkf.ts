// Regressionstest: placeLevelingSeats för RF/KF (region/kommun-scopat, se aggregate.ts
// computeFixedRegionOrKommunValkretsMandate) mot Valmyndighetens RIKTIGA 2022-facit —
// samma metod som scripts/verify-mandate-leveling.ts bevisade för RD, generaliserad.
//
// Källa: val.se:s LIVE 2022-resultatarkiv (resultat.val.se/resultatfiler/val2022/s/…),
// INTE "rådata"-sidans historiska jämförelsefiler — de senare saknar en per-sub-valkrets
// mandatfil för RF/KF (kollat 12 sep). Arkivet är dock fortfarande uppe och de riktiga
// slutliga organ-zip:arna (samma format som resultat-ingesten redan hämtar för 2026)
// innehåller en fullständig mandatfordelning.valkretsLista[].mandatfordelning.partiLista
// PER VALKRETS — exakt det vi behöver. Nedladdade en gång manuellt (28 zip, 11 RF + 17 KF,
// de delade organen) till scratch, kopiera tillbaka om filerna saknas:
//   data/raw/mandat2022/val2022-rf/<lan>.zip   (01,03,05,06,08,10,12,14,18,19,24)
//   data/raw/mandat2022/val2022-kf/<kommun>.zip (0136,0160,0180,0182,0580,0880,1080,
//     1280,1287,1290,1383,1488,1490,1880,2281,2284,2480)
//
//   npx tsx scripts/verify-mandate-leveling-rfkf.ts
//
// Resultat (12 sep): 677 av 679 (valkrets,parti)-par matchar exakt. KF: 17/17 organ,
// 100 %. RF: 9/11 organ 100 %, 2 kvar (Kalmar/Emmaboda: M vs V; Västra Götaland/Göteborg:
// L) — INTE tie-breaking (jämförelsetalen skiljer sig klart, 1159,67 vs 1155,83, inte
// lika) och INTE en röst-/namn-/uppsamlingsbugg (allt kryssverifierat mot filens egen
// inbäddade rostfordelning, matchar exakt). Två separata buggar hittades OCH fixades
// under detta arbete (båda kvar i historiken, se git blame): (1) uppsamlingsröster utan
// egen kretskod måste vägas in i organets spärr/mål men INTE tilldelas en valkrets
// (extraVotes i computeAssembly) — utan detta gav Uppsala RF fel C/MP-totaler; (2)
// uppsamlingsdistrikt som FAKTISKT har en kretskod (Blekinge/Ronneby) ska räknas till DEN
// valkretsen, inte klumpas ihop organvitt — en förhastad generalisering av fix (1) gav
// annars fel KD/V-fasta i Ronneby. De 2 kvarvarande fallen är oförklarade efter denna
// utredning — misstänkt en verklig (ovanlig) Valmyndighets-särregel eller ett fåtal
// omräknade röster efter offentliggörandet, inte reproducerbart ur rösterna allena.
import { readFileSync, readdirSync } from 'node:fs'
import XLSX from 'xlsx'
import { unzipSync } from 'fflate'
import { computeAssembly, placeLevelingSeats, type ConstituencyVotes, type PartyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const t = (v: unknown) => String(v ?? '').trim()
// Namnen skiljer sig ibland bara i mellanslag mellan 2022-källorna (t.ex. "Nacka  Östra"
// mot "Nacka Östra") — kollapsa till enkla mellanslag innan matchning, annars missar
// namn-lookupen trots att det är SAMMA valkrets (samma klass av drift som Täby/Trelleborg/
// Borås hittades ha mellan 2022/2026-källor tidigare denna session).
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

interface RostVd {
  valdistriktskod: string
  valdistriktstyp?: string
  kretskod?: string
  rostfordelning?: { rosterPaverkaMandat?: { partiRoster?: { partikod: string; antalRoster: number }[] } }
}
interface RostFile { valdistrikt: RostVd[] }
interface PartiMandat { partikod: string; antalMandat: number }
interface ValkretsEntry { namnValkrets: string; kod: string; mandatfordelning?: { partiLista: PartiMandat[] } | null }
interface MandatFile { valomrade: { kod: string; valkretsLista?: ValkretsEntry[] | null } }

function loadOrgan(zipPath: string): { rost: RostFile; mandat: MandatFile } {
  const buf = readFileSync(zipPath)
  const unz = unzipSync(new Uint8Array(buf))
  const names = Object.keys(unz)
  const rostName = names.find((n) => /rostfordelning.*\.json$/i.test(n))!
  const mandatName = names.find((n) => /mandatfordelning.*\.json$/i.test(n))!
  const dec = new TextDecoder()
  return { rost: JSON.parse(dec.decode(unz[rostName])), mandat: JSON.parse(dec.decode(unz[mandatName])) }
}

// Uppsamlingsdistrikt (sena röster) har INTE alltid en oattribuerad valkrets — Valmyndigheten
// löser dem ner till `kretskod` när den geografiska hemvisten är känd (bekräftat: Blekinge/
// Ronnebykretsens uppsamlingsdistrikt HAR kretskod='1002' och dess röster ingår i den riktiga
// fasta-fördelningen där), men inte alltid (Uppsala RF:s uppsamling saknade kretskod helt och
// ska då vägas in ORGAN-VITT (extraVotes till computeAssembly) i stället, aldrig i en
// specifik valkrets. Avgörande fynd (12 sep): trodde först ALLA uppsamlingsdistrikt saknade
// valkrets (som RD:s gör) — en förhastad generalisering som gav Ronneby fel KD/V-fasta-mandat
// tills detta korrigerades till "kolla kretskod FÖRST, oavsett valdistriktstyp".
function buildVotes(rost: RostFile): { byVk: ConstituencyVotes; extra: PartyVotes } {
  const byVk: ConstituencyVotes = {}
  const extra: PartyVotes = {}
  for (const vd of rost.valdistrikt) {
    const pr = vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []
    if (!vd.kretskod) {
      for (const p of pr) extra[p.partikod] = (extra[p.partikod] ?? 0) + p.antalRoster
      continue
    }
    const pv = byVk[vd.kretskod] ?? (byVk[vd.kretskod] = {})
    for (const p of pr) pv[p.partikod] = (pv[p.partikod] ?? 0) + p.antalRoster
  }
  return { byVk, extra }
}

// 2022 fasta mandat + totalt mandat per valkrets-NAMN (för RF/KF, delade organ), ur
// fasta-valkretsmandat-2022.xlsx "Flik 1" — samma fil/schema som RD-skriptet, andra rader.
const wbF = XLSX.readFile(`${DIR}/fasta-valkretsmandat-2022.xlsx`)
const fRows = XLSX.utils.sheet_to_json<string[]>(wbF.Sheets['Flik 1'], { header: 1, raw: false, defval: '' }).slice(1)
const rfFastaByOrgan = new Map<string, { fastaByName: Map<string, number>; total: number }>() // lan -> ...
const kfFastaByOrgan = new Map<string, { fastaByName: Map<string, number>; total: number }>() // kommun -> ...
for (const r of fRows) {
  const vt = t(r[0])
  const name = t(r[4])
  if (!name) continue // odelat organ, ingen valkrets-rad — inte relevant här
  if (vt === 'Val till Regionfullmäktige') {
    const lan = t(r[1]).padStart(2, '0')
    const entry = rfFastaByOrgan.get(lan) ?? rfFastaByOrgan.set(lan, { fastaByName: new Map(), total: Number(t(r[10])) || 0 }).get(lan)!
    entry.fastaByName.set(norm(name), Number(t(r[9])) || 0)
  } else if (vt === 'Val till Kommunfullmäktige') {
    const kommun = t(r[2]).padStart(4, '0')
    const entry = kfFastaByOrgan.get(kommun) ?? kfFastaByOrgan.set(kommun, { fastaByName: new Map(), total: Number(t(r[10])) || 0 }).get(kommun)!
    entry.fastaByName.set(norm(name), Number(t(r[9])) || 0)
  }
}

let ok = true
let checkedPairs = 0
let checkedOrgans = 0
const log = (pass: boolean, label: string) => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : 'FEL'} ${label}`) }

function testOrgan(valtyp: 'RF' | 'KF', organKod: string, zipPath: string, fastaInfo: { fastaByName: Map<string, number>; total: number }) {
  const { rost, mandat } = loadOrgan(zipPath)
  const { byVk: votesByConstituency, extra: uppsamlingVotes } = buildVotes(rost)
  const vkList = mandat.valomrade.valkretsLista ?? []
  if (vkList.length === 0) { log(false, `${valtyp} ${organKod}: inga valkretsar i mandatfilen (oväntat för ett delat organ)`); return }
  checkedOrgans++

  const fixedSeatsByConstituency: Record<string, number> = {}
  for (const vk of vkList) {
    const fasta = fastaInfo.fastaByName.get(norm(vk.namnValkrets))
    if (fasta == null) { log(false, `${valtyp} ${organKod}/${vk.namnValkrets}: ingen fasta-mandat-matchning (namnbyte sen 2022?)`); return }
    fixedSeatsByConstituency[vk.kod] = fasta
  }

  const result = computeAssembly(
    votesByConstituency,
    {
      totalSeats: fastaInfo.total,
      firstDivisor: 1.2,
      nationalThreshold: 0.03, // RF/KF-spärr — de delade organen har alltid 3 % (kommun: lag sen 2018)
      constituencyThreshold: Infinity, // ingen 12 %-regel för RF/KF
      fixedSeatsByConstituency,
      fullyLevels: true, // Vallag 14 kap. — inget överskott, totalen ÄR nationalTarget
    },
    uppsamlingVotes, // väger in i spärr/mål (steg A/C) — aldrig i en specifik valkrets (steg B)
  )
  const placed = placeLevelingSeats(votesByConstituency, result.fixedByConstituencyParty, result.levelingByParty)

  for (const vk of vkList) {
    const facitParti = vk.mandatfordelning?.partiLista
    if (!facitParti) { log(false, `${valtyp} ${organKod}/${vk.namnValkrets}: filen saknar mandatfordelning`); continue }
    const fixedHere = result.fixedByConstituencyParty[vk.kod] ?? {}
    const placedHere = placed[vk.kod] ?? {}
    for (const p of facitParti) {
      checkedPairs++
      const ours = (fixedHere[p.partikod] ?? 0) + (placedHere[p.partikod] ?? 0)
      if (ours !== p.antalMandat) {
        ok = false
        console.log(`FEL ${valtyp} ${organKod}/${vk.namnValkrets}/${p.partikod}: ${ours} (facit ${p.antalMandat})`)
      }
    }
  }
}

const rfDir = `${DIR}/val2022-rf`
const kfDir = `${DIR}/val2022-kf`
console.log('--- RF (11 delade regioner) ---')
for (const lan of readdirSync(rfDir).filter((f) => f.endsWith('.zip')).map((f) => f.replace('.zip', ''))) {
  const info = rfFastaByOrgan.get(lan)
  if (!info) { log(false, `RF ${lan}: ingen fasta-info (odelat i 2022-filen?)`); continue }
  testOrgan('RF', lan, `${rfDir}/${lan}.zip`, info)
}
console.log('\n--- KF (17 delade kommuner) ---')
for (const kommun of readdirSync(kfDir).filter((f) => f.endsWith('.zip')).map((f) => f.replace('.zip', ''))) {
  const info = kfFastaByOrgan.get(kommun)
  if (!info) { log(false, `KF ${kommun}: ingen fasta-info (odelat i 2022-filen?)`); continue }
  testOrgan('KF', kommun, `${kfDir}/${kommun}.zip`, info)
}

console.log(`\n${checkedOrgans} organ, ${checkedPairs} (valkrets,parti)-par kontrollerade.`)
console.log(ok ? '\n✅ MATCHAR FACIT EXAKT — fasta+placerad utjämning == Valmyndighetens 2022-mandat per valkrets (RF+KF)' : '\n❌ se FEL ovan')
process.exit(ok ? 0 : 1)
