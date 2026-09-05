// Teardown: rensa ALLA resultatrader (result + uppsamling_result + turnout) för alla valtyper.
//
//   node --env-file=.env.local scripts/reset-results.mjs [--ingest-state]
//
// ⚠️ KÖR INFÖR VALNATTEN (runbookens N1 — med cronen PAUSAD, N0). Genrep lämnar rader med
// status='slutlig'; no-downgrade-triggrarna (result_/turnout_/uppsamling_result_no_status_downgrade)
// BLOCKAR då de skarpa val2026-PRELIMINÄRA upserterna (samma PK) → kartan/valdeltagandet skulle
// frysa på genrep-testdata. Rensa därför ALLA tre tabellerna så val2026 skriver rent.
// --ingest-state wipar även ingest_state (behövs ej för base-bytet — val2026-nycklar är färska
// ändå — men ger en helt ren start).
//
// STRIKT: varje fel är fatalt (exit 1) och sluttillståndet VERIFIERAS (0 rader i alla tre). Tidigare
// loggades fel på uppsamling/turnout som "ignoreras" och skriptet exit:ade 0 — på natten hade det
// betytt kvarvarande slutliga turnout-rader och fruset valdeltagande utan att någon såg det.
import ws from 'ws'
import { createClient } from '@supabase/supabase-js'

globalThis.WebSocket ??= ws

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Saknar VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (kör med --env-file=.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })
const VALTYPER = ['RD', 'RF', 'KF']
const fail = (msg) => { console.error(`[reset-results] ❌ ${msg}`); process.exit(1) }

for (const table of ['result', 'uppsamling_result', 'turnout']) {
  const r = await db.from(table).delete({ count: 'exact' }).in('valtyp', VALTYPER)
  if (r.error) fail(`${table}: ${r.error.message}`)
  console.log(`[reset-results] raderade ${r.count ?? '?'} rader ur ${table}.`)
}

if (process.argv.includes('--ingest-state')) {
  const r = await db.from('ingest_state').delete({ count: 'exact' }).neq('file_path', '')
  if (r.error) fail(`ingest_state: ${r.error.message}`)
  console.log(`[reset-results] raderade ${r.count ?? '?'} rader ur ingest_state (full omingest nästa cron-varv).`)
}

// Snapshot-blobbarna (Storage `snapshots/{RD,RF,KF}.json`, CDN-cachade) speglar den data som just
// raderades. Låter vi dem ligga kvar seedar varje ny flik GAMMAL data vid mount (och cronen som
// regenererar dem är pausad under N0–N3). Ta bort dem → klienten faller tillbaka på keyset-vägen
// (tom tabell = tom karta, korrekt) tills nästa ingest-körning skriver nya blobbar.
{
  const { error } = await db.storage.from('snapshots').remove(['RD.json', 'RF.json', 'KF.json'])
  if (error) fail(`snapshot-blobbar: ${error.message}`)
  console.log('[reset-results] tog bort snapshot-blobbarna (snapshots/RD|RF|KF.json).')
}

// Verifiera sluttillståndet — det är DETTA som gör N1 säkert att bocka av.
for (const table of ['result', 'uppsamling_result', 'turnout']) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true })
  if (error) fail(`verifiering ${table}: ${error.message}`)
  if ((count ?? -1) !== 0) fail(`${table} har fortfarande ${count} rader efter rensning`)
}
console.log('[reset-results] ✅ verifierat: result / uppsamling_result / turnout = 0 rader.')
process.exit(0)
