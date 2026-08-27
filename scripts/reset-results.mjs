// Teardown: rensa ALLA resultatrader (result + uppsamling_result) för alla valtyper.
//
//   node --env-file=.env.local scripts/reset-results.mjs [--ingest-state]
//
// ⚠️ KÖR INFÖR VALNATTEN. Genrep lämnar rader med status='slutlig'; no-downgrade-triggern
// (result_no_status_downgrade) BLOCKAR då de skarpa val2026-PRELIMINÄRA upserterna (samma
// (valtyp, valdistriktskod, partikod)-nyckel) → kartan skulle frysa på genrep-testdata.
// Rensa därför BÅDA tabellerna så val2026 skriver rent. --ingest-state wipar även ingest_state
// (behövs ej för base-bytet — val2026-nycklar är färska ändå — men ger en helt ren start).
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

const r1 = await db.from('result').delete({ count: 'exact' }).in('valtyp', ['RD', 'RF', 'KF'])
if (r1.error) throw new Error('result: ' + r1.error.message)
console.log(`[reset-results] raderade ${r1.count ?? '?'} rader ur result.`)

// uppsamling_result kan saknas i ett gammalt schema → fall tyst tillbaka.
const r2 = await db.from('uppsamling_result').delete({ count: 'exact' }).in('valtyp', ['RD', 'RF', 'KF'])
if (r2.error) console.warn(`[reset-results] uppsamling_result: ${r2.error.message} (ignoreras)`)
else console.log(`[reset-results] raderade ${r2.count ?? '?'} rader ur uppsamling_result.`)

if (process.argv.includes('--ingest-state')) {
  const r3 = await db.from('ingest_state').delete({ count: 'exact' }).neq('file_path', '')
  if (r3.error) console.warn(`[reset-results] ingest_state: ${r3.error.message} (ignoreras)`)
  else console.log(`[reset-results] raderade ${r3.count ?? '?'} rader ur ingest_state (full omingest nästa cron-varv).`)
}
process.exit(0)
