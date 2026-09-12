// Fristående, READ-ONLY jämförelse: hämtar samma organ-zip:ar edge/ingest:slutlig redan
// hämtar (…_<kod>_<RD|RF|KF>.zip), packar upp och läser BÅDA JSON-filerna som redan ligger
// där — röstfordelning (som vi ingest:ar) och mandatfordelning (som vi hittills IGNORERAT) —
// och jämför Valmyndighetens EGNA beräknade mandat mot VÅR beräkning. Beräkningen körs på
// EXAKT samma röster som filen själv innehåller (inte via vår, kanske efterslävande, DB) för
// att isolera beräkningskorrekthet från ingest-timing.
//
// Generalisering av scripts/verify-uppsamling.ts (samma fetchOrgan/build-mönster, bevisat
// mot genrep tidigare i höst): `--base` konfigurerbar (default val2026 — genrep2026 är
// riven, se nedan) i stället för hårdkodad genrep-URL, samt täcker ÄVEN valkretsnivån
// (RD:s 29 + RF/KF:s 11/17 delade organ, tillagt PR #129 och utökat 12 sep) — jämfört mot
// filens FULLA antalMandat (fasta+utjämning) för alla tre valtyper sedan
// computeRegionOrKommunValkretsMandate/computeRdValkretsMandate båda numera placerar
// utjämningen geografiskt (se scripts/verify-mandate-leveling.ts /-rfkf.ts).
//
// Skriver ALDRIG till DB:n. Kräver nätverk mot BASE (val.se) + Supabase (bara för att läsa
// `district`, för samma vk_rd/vk_rf/vk_kf-index som klienten bygger klientsidan, se
// ResultsProvider.tsx) — manuellt körd diagnostik, INTE i CI, inte del av ingest-kedjan.
//
// ⚠️ Kan INTE köras mot riktig data förrän val2026 börjar publicera filer (genrep2026 är
// riven — 404 på både manifest och enskilda filer, verifierat 11 sep; val2026:s manifest
// svarade 200 men TOMT samma dag). Förberedd inför valnatten, körs första gången då:
//
//   node --env-file=.env.local scripts/verify-mandatfordelning-live.ts
//   node --env-file=.env.local scripts/verify-mandatfordelning-live.ts --status s --limit-kf 40
//   node --env-file=.env.local scripts/verify-mandatfordelning-live.ts --base https://resultat.val.se/resultatfiler/genrep2026
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
import { unzipSync } from 'fflate'
import {
  buildGroups,
  computeMandate,
  computeRdValkretsMandate,
  computeRegionOrKommunValkretsMandate,
  type UppsamlingBuckets,
} from '../src/lib/aggregate.ts'
import { SEAT_CONFIG_2026 } from '../src/lib/seatConfig2026.ts'
import type { PartyVotes } from '../src/lib/mandate.ts'
import type { Level, Valtyp } from '../src/lib/results.ts'

// Node < 22 saknar inbyggd WebSocket; supabase-js konstruerar RealtimeClient eagerly
// (samma polyfill som monitor-flow.mjs/ingest-slutlig.mjs). Vi använder bara REST här.
globalThis.WebSocket ??= ws

const flagVal = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const BASE = flagVal('--base', 'https://resultat.val.se/resultatfiler/val2026').replace(/\/+$/, '')
const STATUS = flagVal('--status', 'p') // 'p' (preliminär, default — det enda som finns på valnatten) eller 's' (slutlig)
const LIMIT_KF = Number(flagVal('--limit-kf', '20')) // 290 KF-filer är mycket — testa ett urval om inget annat sägs
const ONLY_VALTYP = flagVal('--valtyp', '') as Valtyp | ''

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — kör med --env-file=.env.local.')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

// ---- val.se-filformat (se docs/arkitektur.md §5b + val.se "Teknisk beskrivning av
// resultatfiler" / prel-mandatfordelning.md, slut-mandatfordelning.md, verifierat 11 sep) ----
interface RostVd {
  valdistriktskod: string
  valdistriktstyp?: string
  kommunkod?: string
  lankod?: string
  kretskod?: string
  rostfordelning?: { rosterPaverkaMandat?: { partiRoster?: { partikod: string; antalRoster: number }[] } }
}
interface RostFile {
  valtyp: Valtyp
  antalValdistriktRaknade: number
  antalValdistriktSomSkaRaknas: number
  valdistrikt: RostVd[]
}
interface PartiMandat { partikod: string; antalMandat: number; antalFastaMandat?: number; antalUtjamningsmandat?: number }
interface Mandatfordelning { partiLista: PartiMandat[] }
interface ValkretsEntry { namnValkrets: string; kod: string; totaltAntalFastaMandat?: number; mandatfordelning?: Mandatfordelning | null }
interface MandatFile {
  valomrade: {
    kod: string
    totaltAntalMandat: number
    mandatfordelning?: Mandatfordelning | null // bara /p/ hittills sett bära per-parti-mandatlista (verifierat mot genrep)
    rostfordelning?: { rosterPaverkaMandat?: { partiRoster?: { partikod: string; deltaMandatfordelning?: string }[] } } // /s/: spärr-flagga i stället, se nedan
    valkretsLista?: ValkretsEntry[] | null // NYTT här (11 sep) — fasta mandat per valkrets, bara delade valområden
  }
}

async function fetchOrgan(rel: string): Promise<{ rost: RostFile; mandat: MandatFile }> {
  const buf = new Uint8Array(await (await fetch(BASE + rel.replace(/^\./, ''))).arrayBuffer())
  const unz = unzipSync(buf)
  const rostName = Object.keys(unz).find((n) => /rostfordelning.*\.json$/i.test(n))!
  const mandatName = Object.keys(unz).find((n) => /mandatfordelning.*\.json$/i.test(n))!
  const dec = new TextDecoder()
  return { rost: JSON.parse(dec.decode(unz[rostName])), mandat: JSON.parse(dec.decode(unz[mandatName])) }
}

// Geografiskt röstindex + uppsamlings-hinkar ur en organfil — samma routing som ingest/
// klienten (se verify-uppsamling.ts): organ-hink PLUS kretskod-attribuerad valkrets-hink
// när Valmyndigheten löst den (se aggregate.ts UppsamlingBuckets, tillagt 12 sep).
function build(rost: RostFile) {
  const geoByVd = new Map<string, PartyVotes>()
  const upp: UppsamlingBuckets = { byOrgan: new Map(), byValkrets: new Map(), unresolvedByOrgan: new Map() }
  const codes: string[] = []
  const add = (m: Map<string, PartyVotes>, key: string, pr: { partikod: string; antalRoster: number }[]) => {
    const bucket = m.get(key) ?? m.set(key, {}).get(key)!
    for (const p of pr) bucket[p.partikod] = (bucket[p.partikod] ?? 0) + p.antalRoster
  }
  for (const vd of rost.valdistrikt ?? []) {
    const pr = vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []
    if (vd.valdistriktstyp === 'uppsamlingsdistrikt') {
      const organKey = rost.valtyp === 'RD' ? '' : rost.valtyp === 'RF' ? vd.lankod! : vd.kommunkod!
      add(upp.byOrgan, organKey, pr)
      if (vd.kretskod) add(upp.byValkrets, vd.kretskod, pr)
      else add(upp.unresolvedByOrgan, organKey, pr)
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
  return { aggregate, upp, groups: buildGroups(codes) }
}

const seatDiff = (a: Record<string, number>, facit: Record<string, number>) => {
  const diffs: string[] = []
  for (const p of new Set([...Object.keys(facit), ...Object.keys(a)]))
    if ((a[p] ?? 0) !== (facit[p] ?? 0)) diffs.push(`${p}: ${a[p] ?? 0} (facit ${facit[p] ?? 0})`)
  return diffs
}

let ok = true
let checkedValkretsar = 0
const log = (pass: boolean, label: string) => { if (!pass) ok = false; console.log(`${pass ? 'OK ' : '❌ '} ${label}`) }

// Valkrets → distrikt-index, EN gång, ur `district` (samma referensdata + kolumner klienten
// bygger areaIndexRef ur, se ResultsProvider.tsx — vi återanvänder DEN källan i stället för
// att gissa oss till valkrets-medlemskap ur mandatfordelning-filens egen nästling).
//
// ⚠️ Koderna i DB:n är OPADDADE ("160" inte "0160", "16001" inte "016001", vk_rd "1" inte
// "01") — SAMMA padStart-konvention som ResultsProvider.tsx måste upprepas här, annars
// matchar valkretsnycklarna varken SEAT_CONFIG_2026 eller varandra. Fel hittad + fixad 11
// sep innan första riktiga körningen (verifierad mot Täby: DB "160"/"16001" → "0160"/"016001").
const padRd = (v: unknown) => (v != null && String(v).trim() !== '' ? String(v).padStart(2, '0') : null)
const padRf = (v: unknown) => (v != null && String(v).trim() !== '' ? String(v).padStart(4, '0') : null)
const padKf = (v: unknown) => (v != null && String(v).trim() !== '' ? String(v).padStart(6, '0') : null)

async function loadVkIndex() {
  const idx: Record<Valtyp, Map<string, string[]>> = { RD: new Map(), RF: new Map(), KF: new Map() }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('district').select('valdistriktskod,vk_rd,vk_rf,vk_kf').range(from, from + 999)
    if (error) throw new Error(`district: ${error.message}`)
    if (!data || data.length === 0) break
    for (const d of data) {
      for (const [vt, vk] of [['RD', padRd(d.vk_rd)], ['RF', padRf(d.vk_rf)], ['KF', padKf(d.vk_kf)]] as const) {
        if (!vk) continue
        const m = idx[vt]
        ;(m.get(vk) ?? m.set(vk, []).get(vk)!).push(d.valdistriktskod)
      }
    }
    if (data.length < 1000) break
  }
  return idx
}

// Valkretsmandat: jämför vår beräkning mot filens valkretsLista.
//
// RD (sedan 12 sep, se aggregate.ts computeRdValkretsMandate + mandate.ts
// placeLevelingSeats): vi beräknar numera den RIKTIGA totalen — fasta OCH geografiskt
// placerad utjämning — verifierad exakt mot 2022-facit (scripts/verify-mandate-leveling.ts,
// 232/232). Jämförs därför mot filens FULLA antalMandat, inte bara antalFastaMandat.
//
// RF/KF: sedan 12 sep också fasta+geografiskt placerad utjämning (samma som RD), jämförs
// mot filens FULLA antalMandat. Uppsamling: den LÖSTA delen (kretskod känd, `upp.byValkrets`)
// läggs i sin valkrets av computeRdValkretsMandate/computeRegionOrKommunValkretsMandate
// själva (aggregate.ts) — den här funktionen skickar bara med hela `upp`-objektet, precis
// som live-koden gör. Verifierat mot 2022-facit (scripts/verify-mandate-leveling-rfkf.ts +
// -rd-uppsamling.ts) att detta ger exakt match; denna körning bekräftar samma sak mot den
// LEVANDE 2026-filen.
function testValkretsar(
  valtyp: Valtyp,
  organKod: string,
  mandat: MandatFile,
  vkIndex: Record<Valtyp, Map<string, string[]>>,
  aggregate: (cs: Iterable<string>) => PartyVotes,
  uppsamling: UppsamlingBuckets,
) {
  const list = mandat.valomrade.valkretsLista
  if (!list || list.length === 0) return // odelat valområde — ingen egen valkrets-nivå (som väntat)
  for (const vk of list) {
    const facitParti = vk.mandatfordelning?.partiLista
    if (!facitParti || vk.totaltAntalFastaMandat == null) {
      console.log(`ℹ  ${valtyp} ${organKod}/${vk.namnValkrets} (${vk.kod}): filen saknar per-parti fasta-mandat-lista här — hoppar (samma kända /s/-begränsning som verify:uppsamling, se skriptets header).`)
      continue
    }
    checkedValkretsar++

    const facitTotal = Object.fromEntries(facitParti.map((p) => [p.partikod, p.antalMandat ?? 0]))
    const ours =
      valtyp === 'RD'
        ? computeRdValkretsMandate(vk.kod, vkIndex.RD, aggregate, uppsamling)
        : computeRegionOrKommunValkretsMandate(
            valtyp,
            organKod,
            vk.kod,
            vkIndex[valtyp],
            aggregate,
            valtyp === 'KF' ? (SEAT_CONFIG_2026.KF[organKod]?.threshold ?? 0.02) : 0.03,
            uppsamling,
          )
    const label = `${valtyp} ${vk.namnValkrets} (${vk.kod})`
    if (!ours) { log(false, `${label}: vår beräkning gav null (saknas i SEAT_CONFIG_2026?)`); continue }
    const diffs = seatDiff(ours.seatsByParty, facitTotal)
    log(diffs.length === 0, `${label}: TOTALT mandat (fasta+utjämning) per parti == fil${diffs.length ? ' — ' + diffs.join(', ') : ''}`)
    const facitTotalSum = Object.values(facitTotal).reduce((a, b) => a + b, 0)
    log(ours.totalSeats === facitTotalSum, `${label}: totalsumma ${ours.totalSeats} == ${facitTotalSum} (${ours.totalFixed} fasta + ${ours.totalSeats - ours.totalFixed} placerad utjämning)`)
  }
}

let testedOrgans = 0

async function testOrgan(rel: string, valtyp: Valtyp, level: Level, vkIndex: Record<Valtyp, Map<string, string[]>>) {
  testedOrgans++
  const { rost, mandat } = await fetchOrgan(rel)
  const { aggregate, upp, groups } = build(rost)
  const areaCode = valtyp === 'RD' ? null : mandat.valomrade.kod
  const partiLista = mandat.valomrade.mandatfordelning?.partiLista
  const full = rost.antalValdistriktRaknade === rost.antalValdistriktSomSkaRaknas
  const label = `${valtyp} ${mandat.valomrade.kod} (${mandat.valomrade.totaltAntalMandat} mandat)`

  const result = computeMandate(valtyp, level, areaCode, aggregate, groups, upp)
  const facitTotal = mandat.valomrade.totaltAntalMandat

  if (partiLista) {
    const facit = Object.fromEntries(partiLista.map((p) => [p.partikod, p.antalMandat]))
    const diffs = result ? seatDiff(result.seatsByParty, facit) : ['computeMandate gav null']
    if (full) {
      log(diffs.length === 0, `${label}: computeMandate == val.se-facit${diffs.length ? ' — ' + diffs.join(', ') : ''}`)
      log(result?.totalMandat === facitTotal, `${label}: totalsumma ${result?.totalMandat} == ${facitTotal}`)
    } else {
      console.log(`ℹ  ${label}: EJ färdigräknad (${rost.antalValdistriktRaknade}/${rost.antalValdistriktSomSkaRaknas}) — hoppar hård facit-assert på totalen`)
    }
  } else {
    // /s/ har (per verify-uppsamling.ts fynd mot genrep) ingen per-parti-mandatlista — bara
    // en spärr-flagga per parti i rostfordelning. Samma facit-fallback som där.
    const overSparr = new Set(
      (mandat.valomrade.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? [])
        .filter((p) => p.deltaMandatfordelning === 'ja').map((p) => p.partikod))
    const seated = new Set(Object.entries(result?.seatsByParty ?? {}).filter(([, n]) => n > 0).map(([k]) => k))
    const setOk = [...seated].every((k) => overSparr.has(k)) && [...overSparr].every((k) => seated.has(k))
    if (full) {
      log(result?.totalMandat === facitTotal, `${label}: computeMandate totalsumma ${result?.totalMandat} == ${facitTotal}`)
      log(setOk, `${label}: mandatbärande partier == spärr-passerade (deltaMandatfordelning)`)
    } else {
      console.log(`ℹ  ${label}: EJ färdigräknad (${rost.antalValdistriktRaknade}/${rost.antalValdistriktSomSkaRaknas}) — hoppar hård facit-assert`)
    }
  }

  // Valkrets-nivån är oberoende av "full" — fasta mandat är kända från Valmyndighetens
  // BESLUTSFIL redan innan valet, filen speglar dem oavsett räkningsläge.
  testValkretsar(valtyp, mandat.valomrade.kod, mandat, vkIndex, aggregate, upp)
}

const main = async () => {
  const idxRes = await fetch(`${BASE}/index.md5`)
  if (!idxRes.ok) { console.error(`manifest ${idxRes.status} @ ${BASE} — inga filer att jämföra ännu.`); process.exit(1) }
  const text = await idxRes.text()
  // Ett TOMT manifest är INTE tom text — val.se svarar med md5-checksumman av tom sträng
  // ("d41d8cd9…  -", ett vanligt md5sum-formats sätt att representera "inget innehåll").
  // Räkna riktiga filer (.zip i sista token), inte rader — annars ser ett tomt manifest ut
  // som "1 rad" och glider förbi en enkel längd-check (hänt här 11 sep, gav en falsk ✅).
  const rels = text.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop() ?? '').filter(Boolean)
  const zipRels = rels.filter((r) => r.endsWith('.zip'))
  if (zipRels.length === 0) { console.error(`manifest @ ${BASE} innehåller inga filer ännu (${rels.length} rad(er), 0 .zip) — väntat innan valnatten.`); process.exit(1) }
  const dir = STATUS === 's' ? '/s/' : '/p/'
  const pick = (re: RegExp, n: number) => zipRels.filter((r) => re.test(r) && r.includes(dir)).slice(0, n)

  console.log(`Bas: ${BASE} · status: ${STATUS === 's' ? 'slutlig' : 'preliminär'}\n`)
  const vkIndex = await loadVkIndex()
  console.log(`Valkrets-index (ur district): RD ${vkIndex.RD.size} · RF ${vkIndex.RF.size} · KF ${vkIndex.KF.size}\n`)

  if (!ONLY_VALTYP || ONLY_VALTYP === 'RD') {
    console.log('--- RD riket (349 mandat, 310 fasta + 39 utjämning, 29 valkretsar) ---')
    for (const r of pick(/_RD\.zip$/i, 1)) await testOrgan(r, 'RD', 'riket', vkIndex)
  }
  if (!ONLY_VALTYP || ONLY_VALTYP === 'RF') {
    console.log('\n--- RF regioner (alla 20 — 11 delade i valkretsar) ---')
    for (const r of pick(/_RF\.zip$/i, 20)) await testOrgan(r, 'RF', 'region', vkIndex)
  }
  if (!ONLY_VALTYP || ONLY_VALTYP === 'KF') {
    console.log(`\n--- KF kommuner (urval ${LIMIT_KF} av 290 — höj med --limit-kf 290 för alla) ---`)
    for (const r of pick(/_KF\.zip$/i, LIMIT_KF)) await testOrgan(r, 'KF', 'kommun', vkIndex)
  }

  if (testedOrgans === 0) {
    console.error(`\n❌ 0 organ testade — inga ${STATUS === 's' ? 'slutliga (/s/)' : 'preliminära (/p/)'} RD/RF/KF-filer i manifestet ännu (${zipRels.length} .zip totalt). Prova --status ${STATUS === 's' ? 'p' : 's'} eller vänta.`)
    process.exit(1)
  }
  console.log(`\n${testedOrgans} organ · ${checkedValkretsar} valkretsar med per-parti fasta-mandat-jämförelse genomförda.`)
  console.log(ok ? '\n✅ MANDATFÖRDELNING: vår computeMandate/computeFixedValkretsMandate == val.se-facit' : '\n❌ se ❌ ovan')
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error('verify-mandatfordelning-live kastade:', e); process.exit(1) })
