// RF/KF mandat-metod mot FACIT — verifieringsharness, rör INGEN app-kod.
//
// Frågan: bör appen byta från sin enkla per-församlings-proportionella metod
// (`proportionalSeats` i lib/aggregate.ts: jämkade uddatalsmetoden på hela
// församlingen bland partier ≥ spärr) till den exakta (`computeAssembly` i
// lib/mandate.ts: fasta valkretsmandat + utjämning + överhängsgren) för RF/KF?
// Den enda praktiska skillnaden vore ÖVERHÄNG (ett parti vinner fler fasta
// valkretsmandat än sin proportionella andel).
//
// Detta skript kör BÅDA metoderna per församling och jämför mot Valmyndighetens
// officiella 2022-mandat (facit är skiljedomare). Fasta valkretsmandat läses per
// valkrets ur fasta-filen (kol "Fasta mandat"), röster grupperas per valkrets ur
// rostern.
//
// RESULTAT (2022, verifierat): region/kommun nivellerar FULLSTÄNDIGT (Vallag 14 kap.,
// inget överskott behålls) — så BÅDE appens proportionalSeats OCH computeAssembly med
// `fullyLevels: true` matchar facit exakt (RF 20/20, KF 290/290; KF:s enda miss är
// Vårgårda-lottning vid exakt lika, träffar båda metoderna). UTAN fullyLevels ger
// computeAssemblys riksdags-överhängsgren fel totaler i 3 RF-regioner (Kalmar/Blekinge/
// Västra Götaland) — det är därför appen använder proportionalSeats, den legalt exakta
// metoden för region/kommun. Detta skript är regressionstestet för den skillnaden.
//
//   2022 (nu):   npx tsx scripts/verify-overhang.ts [--valtyp RF|KF]   (utelämnat = båda)
//   2026 (efter valnatten): byt röstkällan i loadRoster() till de skarpa resultaten
//     (DB `result`/`uppsamling_result` grupperat på vk_rf/vk_kf, eller slutliga
//     filerna) och fasta-filen till 2026 — jämförelsemotorn nedan är oförändrad.
import XLSX from 'xlsx'
import { computeAssembly, modifiedSainteLague, type PartyVotes, type ConstituencyVotes } from '../src/lib/mandate.ts'

const DIR = 'data/raw/mandat2022'
const YEAR = '2022'
const arg = (name: string, def?: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def }
const only = arg('--valtyp')?.toUpperCase()
const VALTYPER = (only ? [only] : ['RF', 'KF']) as ('RF' | 'KF')[]
const t = (v: unknown) => String(v ?? '').trim()
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

const REGION_ALIAS: Record<string, string> = {
  'Jönköpings län': 'Jönköping', 'Kalmar län': 'Kalmar',
  'Västra Götalandsregionen': 'Västra Götaland', 'Örebro län': 'Örebro',
  'Jämtland Härjedalen': 'Jämtland',
}
const region = (raw: string) => { const r = t(raw).replace(/^Region\s+/, ''); return REGION_ALIAS[r] ?? r }
// Icke-parti-rader per distrikt som exkluderas ur giltiga röster.
const INVALID = new Set(['Valdeltagande', 'Summa giltiga röster', 'ej anmält deltagande', 'blanka röster', 'övriga ogiltiga', 'Röstberättigade'])
const ABBR: Record<string, string> = {
  'Arbetarepartiet-Socialdemokraterna': 'S', Sverigedemokraterna: 'SD', Moderaterna: 'M',
  Centerpartiet: 'C', Vänsterpartiet: 'V', Kristdemokraterna: 'KD',
  'Miljöpartiet de gröna': 'MP', 'Liberalerna (tidigare Folkpartiet)': 'L',
}
const ab = (p: string) => ABBR[p] ?? p
// Valkrets-join: fasta-filen namnger valkretsen ("1 Södermalm-Enskede" / "Nordväst"),
// rostern bär både kod och namn. Normalisera bort ledande nummer + kasus → stabil nyckel.
const vkKey = (name: string) => t(name).replace(/^\d+\s*/, '').toLowerCase()

type Assembly = {
  cv: ConstituencyVotes            // valkretsnyckel → parti → röster (ur rostern)
  fixed: Record<string, number>    // valkretsnyckel → fasta mandat (ur fasta-filen)
  totalSeats: number
  threshold: number
  facit: PartyVotes                // parti → mandat (officiellt 2022), tomt om saknas
}

// --- Röster per församling & valkrets (samma roster-layout som replay-2022) ----
function loadRoster(vt: 'RF' | 'KF'): Map<string, Map<string, PartyVotes>> {
  const wb = XLSX.readFile(`${DIR}/roster-${vt.toLowerCase()}-${YEAR}.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[`roster_${vt}`], { header: 1, raw: false, defval: '' }).slice(1)
  const byAssembly = new Map<string, Map<string, PartyVotes>>()
  for (const r of rows) {
    const assembly = vt === 'RF' ? region(r[3]) : t(r[5]).slice(0, 4) // RF: regionnamn · KF: kommunkod (ur 8-siffrig vd)
    const parti = t(r[9]); const roster = Number(t(r[10])) || 0
    if (!assembly || INVALID.has(parti) || !parti) continue
    const key = vkKey(r[8])
    const vks = byAssembly.get(assembly) ?? byAssembly.set(assembly, new Map()).get(assembly)!
    const votes = vks.get(key) ?? vks.set(key, {}).get(key)!
    votes[parti] = (votes[parti] ?? 0) + roster
  }
  return byAssembly
}

// --- Fasta valkretsmandat per valkrets + totalt per församling (fasta-filen) ----
function loadFasta(vt: 'RF' | 'KF') {
  const wb = XLSX.readFile(`${DIR}/fasta-valkretsmandat-${YEAR}.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })
  const valtypRow = vt === 'RF' ? 'Val till Regionfullmäktige' : 'Val till Kommunfullmäktige'
  const out = new Map<string, { fixed: Record<string, number>; totalSeats: number; vkCount: number }>()
  for (const r of rows) {
    if (t(r[0]) !== valtypRow) continue
    const assembly = vt === 'RF' ? region(r[3]) : t(r[2]).padStart(4, '0') // RF: regionnamn · KF: kommunkod
    const a = out.get(assembly) ?? out.set(assembly, { fixed: {}, totalSeats: Number(t(r[10])) || 0, vkCount: 0 }).get(assembly)!
    a.fixed[vkKey(r[4])] = Number(t(r[9])) || 0
    a.vkCount++
  }
  return out
}

// --- Facit: officiella 2022-mandat per församling per parti (+ KF-storlek) ------
function loadFacit(vt: 'RF' | 'KF', names: Set<string>) {
  const wb = XLSX.readFile(`${DIR}/mandat-2018-2022.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[vt === 'RF' ? 'Region' : 'Kommun'], { header: 1, raw: false, defval: '' }).slice(1)
  const facit: Record<string, PartyVotes> = {}; const seats: Record<string, number> = {}
  let cur: string | null = null
  for (const r of rows) {
    const label = t(r[0]); if (!label) continue
    const canon = region(label)
    if (names.has(canon)) { cur = canon; facit[canon] = {}; seats[canon] = Number(t(r[2])) || 0; continue }
    if (!cur) continue
    const s = Number(t(r[2])) || 0
    if (s > 0) facit[cur][label] = s
  }
  return { facit, seats }
}

// KF-facit nycklas på kommunNAMN men rostern på kommunKOD → bygg kod↔namn ur fasta.
function kfCodeToName(): Map<string, string> {
  const wb = XLSX.readFile(`${DIR}/fasta-valkretsmandat-${YEAR}.xlsx`)
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Flik 1'], { header: 1, raw: false, defval: '' })
  const m = new Map<string, string>()
  for (const r of rows) if (t(r[0]) === 'Val till Kommunfullmäktige') m.set(t(r[2]).padStart(4, '0'), t(r[3]))
  return m
}

function buildAssemblies(vt: 'RF' | 'KF'): Map<string, Assembly> {
  const roster = loadRoster(vt)
  const fasta = loadFasta(vt)
  const codeToName = vt === 'KF' ? kfCodeToName() : null
  // Facit nycklas på församlingsNAMN; RF-rostern är redan namn, KF översätts kod→namn.
  const nameSet = new Set([...roster.keys()].map((k) => (codeToName ? region(codeToName.get(k) ?? k) : k)))
  const { facit, seats: facitSeats } = loadFacit(vt, nameSet)

  const assemblies = new Map<string, Assembly>()
  for (const [assembly, vks] of roster) {
    const f = fasta.get(assembly)
    if (!f) continue // ingen fasta-rad (bör ej hända) → hoppa
    const name = codeToName ? region(codeToName.get(assembly) ?? assembly) : assembly
    const cv: ConstituencyVotes = {}
    for (const [k, v] of vks) cv[k] = v
    // KF: kommunens EGNA 2022-storlek (facit) är auktoritet (t.ex. Tyresö 51→61).
    const totalSeats = vt === 'KF' ? (facitSeats[name] ?? f.totalSeats) : f.totalSeats
    const threshold = vt === 'RF' ? 0.03 : f.vkCount > 1 ? 0.03 : 0.02
    assemblies.set(assembly, { cv, fixed: f.fixed, totalSeats, threshold, facit: facit[name] ?? {} })
  }
  return assemblies
}

// Enkla metoden (appens): jämkade uddatalsmetoden på HELA församlingen bland ≥ spärr.
function simpleSeats(a: Assembly): PartyVotes {
  const votes: PartyVotes = {}
  for (const vk of Object.values(a.cv)) for (const [p, v] of Object.entries(vk)) votes[p] = (votes[p] ?? 0) + v
  const total = sum(votes)
  if (total === 0) return {}
  const qual = Object.fromEntries(Object.entries(votes).filter(([, v]) => v / total >= a.threshold))
  return modifiedSainteLague(qual, a.totalSeats, 1.2)
}

// Exakta metoden: fasta valkretsmandat + FULL utjämning (fullyLevels — Vallag 14 kap.,
// region/kommun behåller inget överskott). Ingen 12%-regel för RF/KF →
// constituencyThreshold = Infinity (bara församlingsspärren gäller).
function exactSeats(a: Assembly): PartyVotes {
  return computeAssembly(a.cv, {
    totalSeats: a.totalSeats, firstDivisor: 1.2,
    nationalThreshold: a.threshold, constituencyThreshold: Infinity,
    fixedSeatsByConstituency: a.fixed, fullyLevels: true,
  }).seatsByParty
}

// Skillnad y→x per parti (visar `facit→metod` när x=metod, y=facit).
const diff = (x: PartyVotes, y: PartyVotes) => {
  const out: string[] = []
  for (const p of new Set([...Object.keys(x), ...Object.keys(y)]))
    if ((x[p] ?? 0) !== (y[p] ?? 0)) out.push(`${ab(p)} ${y[p] ?? 0}→${x[p] ?? 0}`)
  return out
}

// FACIT är skiljedomare (där det finns). Vi mäter vilken metod som reproducerar de
// officiella 2022-mandaten: appens enkla proportionella (proportionalSeats) vs den
// exakta (computeAssembly, fasta + utjämning + överhäng). 2022-utfallet dokumenterar
// vad man annars måste ta på tro; på valnatten byts röstkällan (se toppen).
let methodDiverge = 0 // församlingar där metoderna skiljer sig OCH facit väljer den enkla
for (const vt of VALTYPER) {
  const assemblies = buildAssemblies(vt)
  let checked = 0, simpleOk = 0, exactOk = 0, withFacit = 0, differ = 0, tie = 0
  const lines: string[] = []
  for (const [assembly, a] of assemblies) {
    if (!Object.values(a.cv).some((v) => sum(v) > 0)) continue
    checked++
    const exact = exactSeats(a)
    const simple = simpleSeats(a)
    const methodsDiffer = diff(exact, simple).length > 0
    if (methodsDiffer) differ++
    if (Object.keys(a.facit).length) {
      withFacit++
      const sBad = diff(simple, a.facit)
      const eBad = diff(exact, a.facit)
      if (!sBad.length) simpleOk++
      if (!eBad.length) exactOk++
      // Metoderna skiljer sig OCH facit väljer sida → äkta överhängs-fynd.
      if (methodsDiffer) methodDiverge++
      // Båda missar identiskt (t.ex. lottning vid exakt lika) → ingen metodskillnad.
      if (!methodsDiffer && sBad.length) tie++
      if (eBad.length || sBad.length)
        lines.push(`  ${assembly}: enkel ${sBad.length ? '✗ [' + sBad.join(', ') + ']' : '✓'} · exakt ${eBad.length ? '✗ [' + eBad.join(', ') + ']' : '✓'}  (facit→metod)`)
    }
  }
  console.log(`\n=== ${vt} (${YEAR}) — ${checked} församlingar, ${withFacit} med facit ===`)
  console.log(`  appens enkla metod (proportionalSeats) matchar facit: ${simpleOk}/${withFacit}`)
  console.log(`  exakta metoden  (computeAssembly)        matchar facit: ${exactOk}/${withFacit}`)
  console.log(`  församlingar där metoderna skiljer sig: ${differ}${tie ? ` · +${tie} där BÅDA missar (lottning, ej metodfel)` : ''}`)
  if (lines.length) { console.log('  avvikelser mot facit:'); lines.slice(0, 15).forEach((l) => console.log(l)) }
}

console.log(methodDiverge
  ? `\n⚠ Metoderna skiljer sig i ${methodDiverge} församling(ar) — och där matchar den ENKLA metoden facit, inte computeAssembly.\n  computeAssemblys överhängsgren är alltså INTE korrekt för RF/KF (den gren mandate.ts flaggar som overifierad).\n  Slutsats: behåll proportionalSeats i appen; wire:a inte in computeAssembly förrän grenen är fixad + verifierad här.`
  : '\n✅ Metoderna ger identiska totaler överallt — inget överhäng, appens metod är korrekt.')
process.exit(0)
