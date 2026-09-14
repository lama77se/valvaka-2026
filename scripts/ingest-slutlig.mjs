// LOKALT skript — ALLA SLUTLIGA resultatfiler (/s/), som edge-funktionen med flit INTE tar.
//
// Rollfördelning (sedan PR #37): edge tar bara de PRELIMINÄRA filerna (/p/) — det är allt som
// finns på valnatten och de ryms i edge:ns CPU-tak. Slutliga filer (/s/) bär personröster och är
// tunga att parsa; en KLUNGA medelstora slutliga i EN edge-invokering summerar >2 s CPU →
// WORKER_RESOURCE_LIMIT (546), och den odelade riks-RD:n (~260 MB uppackad) spränger taket ensam.
// Därför tar detta skript HELA den slutliga räkningen: riks-RD + alla 21 RF + alla ~290 KF.
// Node har inget CPU-/minnestak likt edge (uppmätt ~1,1 GB RSS på 260 MB-filen) → load-all funkar.
//
// KÖR under SLUTRÄKNINGEN (ons–fre efter valet), när de definitiva filerna dyker upp/uppdateras:
//   npm run ingest:slutlig            # tar bara filer som ändrats sedan sist (md5)
//   npm run ingest:slutlig -- --force # kör om alla slutliga filer
//
// Kräver service-role i .env.local (kringgår RLS, skriver result). Egna ingest_state-nycklar
// (STATE_PREFIX) → krockar aldrig med edge:ns state för samma fil.
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
import { unzipSync } from 'fflate'
// Node <22 saknar native WebSocket; supabase-js konstruerar RealtimeClient eagerly och kraschar
// annars redan i createClient (samma polyfill som monitor-flow.mjs). Ingesten använder inte Realtime.
globalThis.WebSocket ??= ws

// VALNATT-BYTE (2026-09-13): pekar nu på den SKARPA katalogen. Lockstep med ingest-result RESULT_BASE_DEFAULT.
// (Backa till '…/genrep2026' om du kör en genrep-sim efter bytet.)
const RESULT_BASE_DEFAULT = 'https://resultat.val.se/resultatfiler/val2026'

const STATE_PREFIX = 'slutlig-local:' // eget nyckelrum (ingen krock med edge:ns url-nycklar)

const hasFlag = (n) => process.argv.includes(n)
const flagVal = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const FORCE = hasFlag('--force')
const BASE = String(flagVal('--base', process.env.RESULT_BASE ?? RESULT_BASE_DEFAULT)).replace(/\/+$/, '')

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const keyKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !keyKey) {
  console.error('Saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — kör med --env-file=.env.local.')
  process.exit(1)
}
const db = createClient(url, keyKey, { auth: { persistSession: false } })
const log = (m) => console.log(`[slutlig-lokalt] ${m}`)

// Bygger mandat_valse-rader ur EN partiLista (organ- eller valkretsnivå) — SPEGLAR
// mandatRowsFromPartiLista i ingest-result/index.ts (PR #166) exakt, bara utan TS-typer.
// Ren, defensiv (kastar ALDRIG: ogiltiga/okända fält hoppas bara över).
function mandatRowsFromPartiLista(partiLista, valtyp, niva, omradeskod, status, partySet) {
  if (!Array.isArray(partiLista)) return []
  const out = []
  for (const p of partiLista) {
    if (!p || typeof p.partikod !== 'string' || !partySet.has(p.partikod)) continue
    if (typeof p.antalMandat !== 'number') continue
    out.push({
      valtyp,
      niva,
      omradeskod,
      partikod: p.partikod,
      antal_mandat: p.antalMandat,
      antal_fasta_mandat: typeof p.antalFastaMandat === 'number' ? p.antalFastaMandat : null,
      antal_utjamningsmandat: typeof p.antalUtjamningsmandat === 'number' ? p.antalUtjamningsmandat : null,
      status,
    })
  }
  return out
}

// FK-set (result→district / →party). En gång, delas av alla filer.
async function loadFkSets() {
  const districtSet = new Set()
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('district').select('valdistriktskod').range(from, from + 999)
    if (!data || data.length === 0) break
    for (const d of data) districtSet.add(d.valdistriktskod)
    if (data.length < 1000) break
  }
  const { data: parties } = await db.from('party').select('partikod')
  return { districtSet, partySet: new Set((parties ?? []).map((p) => p.partikod)) }
}

// Bygg + skriv EN organfil (load-all). Parsning/routing EXAKT som ingest-result.
async function processFile(f, sets) {
  const buf = new Uint8Array(await (await fetch(f.url)).arrayBuffer())
  log(`hämtar ${f.rel} (${(buf.length / 1048576).toFixed(1)} MB zip)`)
  const unz = unzipSync(buf)
  const name = Object.keys(unz).find((n) => /rostfordelning.*\.json$/i.test(n))
  if (!name) { console.error(`  ingen rostfordelning i ${f.rel} — hoppar (markerar EJ done).`); return false }
  const j = JSON.parse(new TextDecoder().decode(unz[name]))
  // Mandatfilens RÅA text (ingen JSON.parse än) — ur SAMMA redan uppackade zip, ingen extra
  // nedladdning. Speglar ingest-result/index.ts (PR #166); handover 14 sep (Val ANALYSIS) —
  // detta skript saknade helt mandat_valse-fångst, vilket gjorde mandat_kalla='aktiv' verkningslöst
  // för sluträkningen (ingen färsk data skulle någonsin nå tabellen). Parsas/upsertas LÄNGRE NER
  // i EGET try/catch — fångas ovillkorligt HÄR (till skillnad från edge, som gate:ar bakom
  // mandat_kalla för att spara CPU på den LIVE, frekvent körda funktionen; det skälet gäller
  // inte detta manuellt körda Node-skript, se handoverns motivering).
  const mandatName = Object.keys(unz).find((n) => /mandatfordelning.*\.json$/i.test(n))
  const mandatText = mandatName ? new TextDecoder().decode(unz[mandatName]) : null
  // Skiftlägesokänslig (val.se kan skriva "Preliminär"); detta skript tar bara /s/ → default slutlig är rätt här.
  const rakstatus = /^prelimin/i.test(String(j.rakningstillfalle ?? '')) ? 'preliminar' : 'slutlig'
  log(`  ${j.valtyp} · räkning "${j.rakningstillfalle}" → status ${rakstatus} · uppackad ${(unz[name].byteLength / 1048576).toFixed(0)} MB · ${j.valdistrikt?.length} distrikt`)

  const rows = []
  const uppRows = []
  const turnoutRows = []
  const registryRows = []
  const personrosterRows = []
  const uppPersonrosterRows = []
  for (const vd of j.valdistrikt ?? []) {
    const kod = vd.valdistriktskod
    if (vd.valdistriktstyp === 'uppsamlingsdistrikt') {
      const kommunkod = typeof vd.kommunkod === 'string' ? vd.kommunkod : null
      const lankod = typeof vd.lankod === 'string' ? vd.lankod : null
      if (typeof kod !== 'string' || !kommunkod || !lankod) continue
      // Sena röster löses ofta till sin RIKTIGA valkrets (kretskod) — samma syskon-fält/logik
      // som edge (ingest-result/index.ts). Null = olöst → organ-vid hink (aggregate.ts UppsamlingBuckets).
      const kretskod = typeof vd.kretskod === 'string' ? vd.kretskod : null
      // Uppsamlingsdistrikt-registret (lockstegat med ingest-result/index.ts, handover 13
      // sep) — ovillkorligt, oavsett om partier-arrayen är tom.
      const namn = typeof vd.namn === 'string' ? vd.namn : null
      registryRows.push({ valtyp: j.valtyp, kod, kommunkod, lankod, kretskod, namn })
      for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
        if (!sets.partySet.has(p.partikod)) continue
        uppRows.push({ valtyp: j.valtyp, kod, kommunkod, lankod, kretskod, partikod: p.partikod, roster: p.antalRoster, status: rakstatus })
        // Personröster för uppsamlingsdistrikt (Beslut 0, handover 14 sep) — EGEN tabell
        // (uppsamling_personroster), inte samma rad-form som personroster nedan: ingen
        // giltig district-FK för uppsamlingskoder, men SAMMA partiRoster[].summeradePersonroster-
        // form (bekräftat samma JSON-schema som geografiska distrikt). kretskod följer med här
        // av samma skäl som uppRows ovan (framtida kryssspärr-/RPC-upplösning).
        for (const kp of p.summeradePersonroster ?? []) {
          if (typeof kp.kandidatnummer !== 'number' || typeof kp.namn !== 'string' || typeof kp.antalPersonroster !== 'number') continue
          uppPersonrosterRows.push({
            valtyp: j.valtyp,
            kod,
            kommunkod,
            lankod,
            kretskod,
            partikod: p.partikod,
            kandidatnummer: kp.kandidatnummer,
            namn: kp.namn,
            antal_personroster: kp.antalPersonroster,
            status: rakstatus,
          })
        }
      }
      continue
    }
    if (typeof kod !== 'string' || kod.length !== 8 || !sets.districtSet.has(kod)) continue
    const rapporteringstid = typeof vd.rapporteringsTid === 'string' ? vd.rapporteringsTid : null
    // Valdeltagande per distrikt: bara RAPPORTERADE (totaltAntalRoster > 0) med giltig nämnare, så
    // nämnaren = röstberättigade i räknade distrikt (som val.se:s aggregat) och orapporterade inte
    // blåser upp den. (Slutliga filer har allt rapporterat, men gaten håller även vid partiell.)
    if (typeof vd.totaltAntalRoster === 'number' && vd.totaltAntalRoster > 0 && typeof vd.antalRostberattigade === 'number' && vd.antalRostberattigade > 0) {
      // Ogiltiga röster — samma syskon-nyckel/logik som edge (ingest-result/index.ts), läst
      // defensivt så en oväntad form aldrig stoppar upserten av röster/valdeltagande ovan.
      const ejPaverka = vd.rostfordelning?.rosterEjPaverkaMandat
      const asInt = (v) => (typeof v === 'number' ? v : null)
      // Distriktets EGEN deklarerade mandatrelevanta totalsumma — samma redan-öppnade
      // rostfordelning-objekt, inget nytt uppslag. "Övriga partier"-källan (handover 13 sep,
      // se PR #170/#171): gapet mot summan av itemiserade partiRoster nedan är giltiga,
      // ALDRIG individuellt itemiserade röster. Lockstegad med ingest-result/index.ts.
      const rosterPaverkarMandat = asInt(vd.rostfordelning?.rosterPaverkaMandat?.antalRoster)
      turnoutRows.push({
        valtyp: j.valtyp,
        valdistriktskod: kod,
        totalt_antal_roster: vd.totaltAntalRoster,
        antal_rostberattigade: vd.antalRostberattigade,
        status: rakstatus,
        blanka: asInt(ejPaverka?.blankaRoster?.antalRoster),
        ej_anmalda_partier: asInt(ejPaverka?.rosterEjAnmaltDeltagande?.antalRoster),
        ovriga_ogiltiga: asInt(ejPaverka?.ovrigaOgiltiga?.antalRoster),
        roster_paverkar_mandat: rosterPaverkarMandat,
      })
    }
    for (const p of vd.rostfordelning?.rosterPaverkaMandat?.partiRoster ?? []) {
      if (!sets.partySet.has(p.partikod)) continue
      rows.push({ valtyp: j.valtyp, valdistriktskod: kod, partikod: p.partikod, roster: p.antalRoster, status: rakstatus, rapporteringstid })
      // Personröster (handover 14 sep, Lars/Val ANALYSIS) — REDAN i samma rostfordelning-JSON,
      // ingen extra fil. Bara summeradePersonroster (redan summerat över partiets ev. flera
      // listor i distriktet) — ingen listRoster[].personroster[]-sublistedetalj, se
      // migrationens kommentar. kandidatnummer är den enda stabila nyckeln (namnstavning kan
      // skilja mellan sublistor/summering inom SAMMA fil) — namn är ren visningstext här.
      for (const kp of p.summeradePersonroster ?? []) {
        if (typeof kp.kandidatnummer !== 'number' || typeof kp.namn !== 'string' || typeof kp.antalPersonroster !== 'number') continue
        personrosterRows.push({
          valtyp: j.valtyp,
          valdistriktskod: kod,
          partikod: p.partikod,
          kandidatnummer: kp.kandidatnummer,
          namn: kp.namn,
          antal_personroster: kp.antalPersonroster,
          status: rakstatus,
        })
      }
    }
  }
  const geoDistricts = new Set(rows.map((r) => r.valdistriktskod)).size
  log(`  byggt: ${rows.length} result-rader (${geoDistricts} distrikt) · ${uppRows.length} uppsamling-rader · ${turnoutRows.length} valdeltagande-rader · ${personrosterRows.length} personröst-rader · ${uppPersonrosterRows.length} uppsamling-personröst-rader — upsertar…`)

  // Slutligt → 1000 rader/upsert (Realtime behövs ej ons–fre; klienten läser via snapshot).
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from('result').upsert(rows.slice(i, i + 1000), { onConflict: 'valtyp,valdistriktskod,partikod' })
    if (error) { console.error(`  result upsert: ${error.message}`); return false }
  }
  for (let i = 0; i < uppRows.length; i += 1000) {
    const { error } = await db.from('uppsamling_result').upsert(uppRows.slice(i, i + 1000), { onConflict: 'valtyp,kod,partikod' })
    if (error) { console.error(`  uppsamling_result upsert: ${error.message}`); return false }
  }
  for (let i = 0; i < turnoutRows.length; i += 1000) {
    const { error } = await db.from('turnout').upsert(turnoutRows.slice(i, i + 1000), { onConflict: 'valtyp,valdistriktskod' })
    if (error) { console.error(`  turnout upsert: ${error.message}`); return false }
  }
  // Registret är ren referensdata (ingen röstsiffra) — ett fel här ska aldrig blockera en
  // annars lyckad sluträkning, bara loggas (samma isoleringsprincip som ingest-result/index.ts).
  for (let i = 0; i < registryRows.length; i += 1000) {
    const { error } = await db.from('uppsamlingsdistrikt_registry').upsert(registryRows.slice(i, i + 1000), { onConflict: 'valtyp,kod' })
    if (error) console.error(`  uppsamlingsdistrikt_registry upsert (icke-kritiskt): ${error.message}`)
  }
  // Personröster — samma isoleringsprincip (icke-kritiskt, kan aldrig göra en annars lyckad
  // sluträkning "misslyckad"): röster/turnout/uppsamling/register är redan upserterade ovan.
  // `break` (till skillnad från registret ovan, som loggar per chunk och fortsätter) — denna
  // tabell kan växa till tiotusentals rader/kandidater i den fulla riks-RD-filen, ett strukturellt
  // fel (t.ex. tabellen saknas än) skulle annars spamma samma felrad hundratals gånger.
  for (let i = 0; i < personrosterRows.length; i += 2000) {
    const { error } = await db.from('personroster').upsert(personrosterRows.slice(i, i + 2000), { onConflict: 'valtyp,valdistriktskod,partikod,kandidatnummer' })
    if (error) { console.error(`  personroster upsert (icke-kritiskt): ${error.message}`); break }
  }
  // Personröster för uppsamlingsdistrikt (Beslut 0, handover 14 sep) — EGEN tabell
  // (uppsamling_personroster, ingen district-FK), samma isolering/break-motivering som ovan.
  for (let i = 0; i < uppPersonrosterRows.length; i += 2000) {
    const { error } = await db.from('uppsamling_personroster').upsert(uppPersonrosterRows.slice(i, i + 2000), { onConflict: 'valtyp,kod,partikod,kandidatnummer' })
    if (error) { console.error(`  uppsamling_personroster upsert (icke-kritiskt): ${error.message}`); break }
  }
  // --- MANDAT (Valmyndighetens EGEN mandatfördelning, handover 13/14 sep) -----------------
  // 🔴 ISOLERINGSKRAV: röster/turnout/uppsamling/register är REDAN upserterade ovan. Ett fel
  // här (JSON.parse, oväntad form, DB-fel) fångas och loggas HÄR och kan ALDRIG göra att en
  // annars lyckad sluträkning räknas som misslyckad (se `return false`-vägarna ovan, som denna
  // sektion aldrig når).
  let mandatUp = 0
  if (mandatText) {
    try {
      const m = JSON.parse(mandatText)
      const vo = m.valomrade
      const mandatRows = []
      if (vo) {
        // RD:s organnivå (riket) har ingen meningsfull områdeskod i filen → fast sentinel,
        // symmetrisk med edge-versionen och klientens egen 'riket'-nivå (areaView.ts MANDAT_LEVELS).
        const organKod = j.valtyp === 'RD' ? 'riket' : (typeof vo.kod === 'string' ? vo.kod : null)
        if (organKod) mandatRows.push(...mandatRowsFromPartiLista(vo.mandatfordelning?.partiLista, j.valtyp, 'organ', organKod, rakstatus, sets.partySet))
        for (const vk of (Array.isArray(vo.valkretsLista) ? vo.valkretsLista : [])) {
          if (vk && typeof vk.kod === 'string') {
            mandatRows.push(...mandatRowsFromPartiLista(vk.mandatfordelning?.partiLista, j.valtyp, 'valkrets', vk.kod, rakstatus, sets.partySet))
          }
        }
      }
      for (let i = 0; i < mandatRows.length; i += 2000) {
        const { error } = await db.from('mandat_valse').upsert(mandatRows.slice(i, i + 2000), { onConflict: 'valtyp,niva,omradeskod,partikod' })
        if (error) throw new Error(error.message)
      }
      mandatUp = mandatRows.length
    } catch (e) {
      console.error(`  mandat_valse upsert (isolerat — resultatet ovan OPÅVERKAT): ${e.message}`)
    }
  }
  log(`  klart: ${rows.length} result · ${uppRows.length} uppsamling · ${turnoutRows.length} valdeltagande · ${registryRows.length} uppsamlingsdistrikt-register · ${mandatUp} mandat_valse · ${personrosterRows.length} personroster · ${uppPersonrosterRows.length} uppsamling_personroster`)
  return true
}

// 1. Manifest → ALLA slutliga (/s/) RD/RF/KF-filer.
const idx = await fetch(`${BASE}/index.md5`)
if (!idx.ok) { log(`manifest ${idx.status} @ ${BASE} — inga slutliga filer att hämta, avslutar.`); process.exit(0) }
const all = (await idx.text())
  .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  .map((l) => { const p = l.split(/\s+/); return { md5: p[0], rel: p[p.length - 1] } })
  .filter((e) => /\/s\/.*_(RD|RF|KF)\.zip$/i.test(e.rel))
  .map((e) => ({ ...e, url: BASE + e.rel.replace(/^\./, '') }))
if (all.length === 0) { log('inga slutliga filer i manifestet än — avslutar.'); process.exit(0) }

// 2. Vilka har ändrats sedan sist? (eget state-prefix). --force kör om alla.
const { data: states } = await db.from('ingest_state').select('file_path,etag').like('file_path', `${STATE_PREFIX}%`)
const seen = new Map((states ?? []).map((s) => [s.file_path, s.etag]))
const changed = FORCE ? all : all.filter((e) => seen.get(STATE_PREFIX + e.url) !== e.md5)
if (changed.length === 0) { log(`alla ${all.length} slutliga filer oförändrade sedan sist — inget att göra.`); process.exit(0) }
// RD (den tunga 260 MB-filen) sist → minnestoppen kommer en gång, efter att småfilerna GC:ats.
changed.sort((a, b) => (/_RD\.zip$/i.test(a.rel) ? 1 : 0) - (/_RD\.zip$/i.test(b.rel) ? 1 : 0))
log(`att behandla: ${changed.length}/${all.length} slutliga filer${FORCE ? ' (--force)' : ''}`)

// 3. FK-set en gång, behandla filerna (frigör minne mellan varje).
const sets = await loadFkSets()
let done = 0
for (const f of changed) {
  const ok = await processFile(f, sets)
  if (ok) {
    await db.from('ingest_state').upsert(
      { file_path: STATE_PREFIX + f.url, etag: f.md5, last_ok: new Date().toISOString(), last_status: 200 },
      { onConflict: 'file_path' },
    )
    done++
  }
}
log(`KLART — ${done}/${changed.length} slutliga filer behandlade.`)
process.exit(0)
