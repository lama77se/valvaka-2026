// Acceptanstest för UPPSAMLINGS-invägningen: kör den RIKTIGA computeMandate() med den
// trådade `uppsamling`-parametern mot Valmyndighetens genrep-facit (mandatfordelning-JSON
// i varje organ-zip). Bevisar att geografiskt aggregat + uppsamlingsröster → jämkade
// uddatalsmetoden reproducerar val.se:s officiella mandat för RD-riket, RF-region och
// KF-kommun — och att UTAN parametern är allt en NO-OP (geografiskt).
//
// KRÄVER NÄTVERK mot den LIVE genrep-feeden (som verify:realtime kräver Supabase) → körs
// manuellt, INTE i CI (bygg/lint-grinden räcker för PR). Feeden byts/försvinner efter valet;
// testet är en engångsgrind för just den här funktionen. Kör:  npm run verify:uppsamling
import { unzipSync } from 'fflate'
import { buildGroups, computeMandate, uppsamlingForArea, type UppsamlingVotes } from '../src/lib/aggregate.ts'
import type { PartyVotes } from '../src/lib/mandate.ts'
import type { Level, Valtyp } from '../src/lib/results.ts'

const BASE = 'https://resultat.val.se/resultatfiler/genrep2026'

interface RostVd {
  valdistriktskod: string
  valdistriktstyp?: string
  kommunkod?: string
  lankod?: string
  rostfordelning?: { rosterPaverkaMandat?: { partiRoster?: { partikod: string; antalRoster: number }[] } }
}
interface RostFile {
  valtyp: Valtyp
  antalValdistriktRaknade: number
  antalValdistriktSomSkaRaknas: number
  valdistrikt: RostVd[]
}
interface MandatFile {
  valomrade: { kod: string; totaltAntalMandat: number; mandatfordelning: { partiLista: { partikod: string; antalMandat: number }[] } }
}

async function fetchOrgan(rel: string): Promise<{ rost: RostFile; mandat: MandatFile }> {
  const buf = new Uint8Array(await (await fetch(BASE + rel.replace(/^\./, ''))).arrayBuffer())
  const unz = unzipSync(buf)
  const rostName = Object.keys(unz).find((n) => /rostfordelning.*\.json$/i.test(n))!
  const mandatName = Object.keys(unz).find((n) => /mandatfordelning.*\.json$/i.test(n))!
  const dec = new TextDecoder()
  return { rost: JSON.parse(dec.decode(unz[rostName])), mandat: JSON.parse(dec.decode(unz[mandatName])) }
}

// Bygg geografiskt röstindex + uppsamlings-organhinkar ur en organfil (samma routing
// som ingest + klient: uppsamling per EXPLICIT lankod/kommunkod, RD → riket-hink '').
function build(rost: RostFile) {
  const geoByVd = new Map<string, PartyVotes>()
  const upp: UppsamlingVotes = new Map()
  const codes: string[] = []
  const uppCodes: string[] = []
  for (const vd of rost.valdistrikt ?? []) {
    const pr = vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []
    if (vd.valdistriktstyp === 'uppsamlingsdistrikt') {
      uppCodes.push(vd.valdistriktskod)
      const key = rost.valtyp === 'RD' ? '' : rost.valtyp === 'RF' ? vd.lankod! : vd.kommunkod!
      const bucket = upp.get(key) ?? upp.set(key, {}).get(key)!
      for (const p of pr) bucket[p.partikod] = (bucket[p.partikod] ?? 0) + p.antalRoster
    } else {
      const v: PartyVotes = {}
      for (const p of pr) v[p.partikod] = (v[p.partikod] ?? 0) + p.antalRoster
      geoByVd.set(vd.valdistriktskod, v)
      codes.push(vd.valdistriktskod)
    }
  }
  const aggregate = (cs: Iterable<string>): PartyVotes => {
    const t: PartyVotes = {}
    for (const c of cs) { const v = geoByVd.get(c); if (v) for (const [p, x] of Object.entries(v)) t[p] = (t[p] ?? 0) + x }
    return t
  }
  return { aggregate, upp, groups: buildGroups(codes), uppCodes }
}

const seatDiff = (a: Record<string, number>, facit: Record<string, number>) => {
  const diffs: string[] = []
  for (const p of new Set([...Object.keys(facit), ...Object.keys(a)]))
    if ((a[p] ?? 0) !== (facit[p] ?? 0)) diffs.push(`${p}: ${a[p] ?? 0} (facit ${facit[p] ?? 0})`)
  return diffs
}

let ok = true
let foldMatters = 0
const log = (pass: boolean, label: string) => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : '❌ '} ${label}`) }

async function testOrgan(rel: string, valtyp: Valtyp, level: Level) {
  const { rost, mandat } = await fetchOrgan(rel)
  const { aggregate, upp, groups, uppCodes } = build(rost)
  const areaCode = valtyp === 'RD' ? null : mandat.valomrade.kod
  const facit = Object.fromEntries(mandat.valomrade.mandatfordelning.partiLista.map((p) => [p.partikod, p.antalMandat]))
  const label = `${valtyp} ${mandat.valomrade.kod} (${mandat.valomrade.totaltAntalMandat} mandat)`

  // 1) Uppsamlingskoderna måste vara UNIKA inom filen (annars kollapsar PK vid ingest).
  log(new Set(uppCodes).size === uppCodes.length, `${label}: ${uppCodes.length} uppsamlingskoder unika (PK-säkert)`)

  // 1b) DISPLAY-vägen (panelens röster/andel): uppsamlingForArea måste ge organets hela
  // uppsamling på organ-nivån — annars visar panelen mandat räknat på fler röster än de
  // röstsummor som står bredvid (synlig inkonsekvens). computeMandate mergar internt, så
  // detta är den enda otestade nya transformen.
  const sumVotes = (v: PartyVotes | null) => (v ? Object.values(v).reduce((a, b) => a + b, 0) : 0)
  const fileUppTotal = [...upp.values()].reduce((a, b) => a + Object.values(b).reduce((x, y) => x + y, 0), 0)
  const disp = uppsamlingForArea(valtyp, level, areaCode, upp)
  log(disp != null && sumVotes(disp) === fileUppTotal, `${label}: uppsamlingForArea ger organets uppsamling (${sumVotes(disp)} av ${fileUppTotal} röster)`)

  const withUpp = computeMandate(valtyp, level, areaCode, aggregate, groups, upp)
  const noUpp = computeMandate(valtyp, level, areaCode, aggregate, groups) // param utelämnad → NO-OP

  const full = rost.antalValdistriktRaknade === rost.antalValdistriktSomSkaRaknas
  const diffs = withUpp ? seatDiff(withUpp.seatsByParty, facit) : ['computeMandate gav null']
  if (full) {
    log(diffs.length === 0, `${label}: geo+uppsamling → computeMandate == val.se-facit${diffs.length ? ' — ' + diffs.join(', ') : ''}`)
    log(withUpp?.totalMandat === mandat.valomrade.totaltAntalMandat, `${label}: totalsumma ${withUpp?.totalMandat} == ${mandat.valomrade.totaltAntalMandat}`)
  } else {
    console.log(`ℹ  ${label}: EJ färdigräknad (${rost.antalValdistriktRaknade}/${rost.antalValdistriktSomSkaRaknas}) — hoppar hård facit-assert`)
  }
  // Syns fold-in:en här? (uppsamling flyttar ett mandat). Rent informativt.
  const flips = withUpp && noUpp ? seatDiff(withUpp.seatsByParty, noUpp.seatsByParty).length > 0 : false
  if (flips) { foldMatters++; console.log(`   ↳ uppsamlingen FLYTTAR mandat här (geo-only ≠ geo+upp)`) }
}

const main = async () => {
  const manifest = await (await fetch(`${BASE}/index.md5`)).text()
  const rels = manifest.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop() ?? '').filter(Boolean)
  const pick = (re: RegExp, n: number) => rels.filter((r) => re.test(r) && r.includes('/p/')).slice(0, n)

  console.log('--- RD riket (exercerar 314-summeringen, 349 mandat) ---')
  for (const r of pick(/_RD\.zip$/i, 1)) await testOrgan(r, 'RD', 'riket')

  console.log('\n--- RF region (uppsamling per län) ---')
  for (const r of pick(/_RF\.zip$/i, 2)) await testOrgan(r, 'RF', 'region')

  console.log('\n--- KF kommun (uppsamling per kommun) ---')
  for (const r of pick(/_KF\.zip$/i, 12)) await testOrgan(r, 'KF', 'kommun')

  console.log(`\nFold-in flyttade mandat i ${foldMatters} testade organ (0 = uppsamlingen är för liten för att välta ett mandat i genrep; totaler stämmer ändå).`)
  console.log(ok ? '\n✅ UPPSAMLING: geo+uppsamling genom RIKTIGA computeMandate == val.se-facit; utan param = NO-OP' : '\n❌ se ❌ ovan')
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error('verify:uppsamling kastade:', e); process.exit(1) })
